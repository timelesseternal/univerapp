-- Run once in Supabase SQL Editor. No Platonus credentials or grades are stored here.
begin;

create table if not exists public.chat_profiles (
  id uuid primary key default gen_random_uuid(),
  student_id bigint not null unique check (student_id > 0),
  display_name text not null check (char_length(display_name) between 1 and 160),
  created_at timestamptz not null default now()
);
create table if not exists public.chat_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.chat_profiles(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '8 hours')
);
create index if not exists chat_sessions_expiry on public.chat_sessions(expires_at);
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.chat_profiles(id),
  user_b uuid not null references public.chat_profiles(id),
  read_a timestamptz,
  read_b timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists chat_conversations_a on public.chat_conversations(user_a, updated_at desc);
create index if not exists chat_conversations_b on public.chat_conversations(user_b, updated_at desc);
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null references public.chat_profiles(id),
  client_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  unique (conversation_id, sender_id, client_id)
);
create index if not exists chat_messages_history on public.chat_messages(conversation_id, id desc);
create index if not exists chat_messages_sender_time on public.chat_messages(sender_id, created_at desc);

-- This version accesses the database through the verified server API only.
-- Public/anon/authenticated keys cannot read tables or impersonate RPC users.
alter table public.chat_profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_profiles, public.chat_sessions, public.chat_conversations, public.chat_messages from public, anon, authenticated;
revoke all on sequence public.chat_messages_id_seq from public, anon, authenticated;
grant all on public.chat_profiles, public.chat_sessions, public.chat_conversations, public.chat_messages to service_role;
grant usage, select on sequence public.chat_messages_id_seq to service_role;

create or replace function public.chat_bootstrap(p_student_id bigint, p_display_name text, p_token_hash text, p_previous_hash text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare profile public.chat_profiles;
begin
  insert into public.chat_profiles(student_id, display_name) values (p_student_id, p_display_name)
  on conflict (student_id) do update set display_name = excluded.display_name
  returning * into profile;
  delete from public.chat_sessions where expires_at <= now() or token_hash = p_previous_hash;
  insert into public.chat_sessions(token_hash, user_id) values (p_token_hash, profile.id);
  return jsonb_build_object('id', profile.id, 'name', profile.display_name);
end;
$$;

create or replace function public.chat_find_users(p_user_id uuid, p_query text)
returns jsonb language sql security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.display_name), '[]'::jsonb)
  from (select id, display_name from public.chat_profiles
    where id <> p_user_id and char_length(btrim(p_query)) between 2 and 60
      and strpos(lower(display_name), lower(btrim(p_query))) > 0
    order by display_name, id limit 20) p;
$$;

create or replace function public.chat_open_conversation(p_user_id uuid, p_peer_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare conversation_id uuid; peer_name text;
begin
  if p_user_id = p_peer_id or p_user_id is null or p_peer_id is null then
    raise exception 'invalid_peer' using errcode = '22023';
  end if;
  select display_name into peer_name from public.chat_profiles where id = p_peer_id;
  if peer_name is null then raise exception 'invalid_peer' using errcode = '22023'; end if;
  insert into public.chat_conversations(user_a, user_b) values (least(p_user_id, p_peer_id), greatest(p_user_id, p_peer_id))
  on conflict (user_a, user_b) do update set updated_at = chat_conversations.updated_at
  returning id into conversation_id;
  return jsonb_build_object('id', conversation_id, 'peer', jsonb_build_object('id', p_peer_id, 'name', peer_name));
end;
$$;

create or replace function public.chat_inbox(p_user_id uuid)
returns jsonb language sql security invoker set search_path = public as $$
  select coalesce(jsonb_agg(entry order by updated_at desc, id), '[]'::jsonb)
  from (
    select c.id, c.updated_at, jsonb_build_object(
      'id', c.id, 'peer', jsonb_build_object('id', p.id, 'name', p.display_name),
      'lastMessage', case when last.id is null then null else jsonb_build_object(
        'text', last.body, 'createdAt', last.created_at, 'senderID', last.sender_id) end,
      'unread', (select count(*) from public.chat_messages m where m.conversation_id = c.id
        and m.sender_id <> p_user_id and m.created_at > coalesce(case when c.user_a = p_user_id then c.read_a else c.read_b end, 'epoch'::timestamptz))
    ) as entry
    from public.chat_conversations c
    join public.chat_profiles p on p.id = case when c.user_a = p_user_id then c.user_b else c.user_a end
    left join lateral (select id, body, created_at, sender_id from public.chat_messages
      where conversation_id = c.id order by id desc limit 1) last on true
    where p_user_id in (c.user_a, c.user_b)
    order by c.updated_at desc, c.id limit 100
  ) inbox;
$$;

create or replace function public.chat_read_messages(p_user_id uuid, p_conversation_id uuid, p_before bigint default null, p_after bigint default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare result jsonb; read_at timestamptz; page_size integer;
begin
  if not exists (select 1 from public.chat_conversations where id = p_conversation_id and p_user_id in (user_a, user_b)) then
    raise exception 'not_a_participant' using errcode = '42501';
  end if;
  if p_before is not null and p_after is not null then raise exception 'invalid_cursor' using errcode = '22023'; end if;
  page_size := case when p_after is null then 50 else 100 end;
  with page as (
    select * from public.chat_messages where conversation_id = p_conversation_id
      and (p_before is null or id < p_before) and (p_after is null or id > p_after)
      order by case when p_after is not null then id end asc, id desc limit page_size + 1
  ), visible as (select * from page order by case when p_after is not null then id end asc, id desc limit page_size)
  select jsonb_build_object(
    'messages', coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'senderID', sender_id,
      'text', body, 'createdAt', created_at, 'clientID', client_id) order by id), '[]'::jsonb),
    'hasMore', (select count(*) > page_size from page)
  ), max(created_at) into result, read_at from visible;
  if read_at is not null then
    update public.chat_conversations set
      read_a = case when user_a = p_user_id then greatest(coalesce(read_a, 'epoch'::timestamptz), read_at) else read_a end,
      read_b = case when user_b = p_user_id then greatest(coalesce(read_b, 'epoch'::timestamptz), read_at) else read_b end
    where id = p_conversation_id;
  end if;
  return result;
end;
$$;

create or replace function public.chat_send_message(p_user_id uuid, p_conversation_id uuid, p_body text, p_client_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare message public.chat_messages;
begin
  if not exists (select 1 from public.chat_conversations where id = p_conversation_id and p_user_id in (user_a, user_b)) then
    raise exception 'not_a_participant' using errcode = '42501';
  end if;
  if char_length(btrim(p_body)) not between 1 and 2000 or p_body is null then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  -- Serialize sends by one account so simultaneous requests cannot bypass the limit.
  perform 1 from public.chat_profiles where id = p_user_id for update;
  select * into message from public.chat_messages where conversation_id = p_conversation_id
    and sender_id = p_user_id and client_id = p_client_id;
  if message.id is null then
    if (select count(*) from public.chat_messages where sender_id = p_user_id
      and created_at > clock_timestamp() - interval '1 minute') >= 30 then
      raise exception 'chat_rate_limit';
    end if;
    insert into public.chat_messages(conversation_id, sender_id, body, client_id)
      values (p_conversation_id, p_user_id, btrim(p_body), p_client_id) returning * into message;
    update public.chat_conversations set updated_at = message.created_at where id = p_conversation_id;
  end if;
  return jsonb_build_object('id', message.id::text, 'senderID', message.sender_id,
    'text', message.body, 'createdAt', message.created_at, 'clientID', message.client_id);
end;
$$;

revoke execute on function public.chat_bootstrap(bigint, text, text, text),
  public.chat_find_users(uuid, text), public.chat_open_conversation(uuid, uuid),
  public.chat_inbox(uuid), public.chat_read_messages(uuid, uuid, bigint, bigint),
  public.chat_send_message(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.chat_bootstrap(bigint, text, text, text),
  public.chat_find_users(uuid, text), public.chat_open_conversation(uuid, uuid),
  public.chat_inbox(uuid), public.chat_read_messages(uuid, uuid, bigint, bigint),
  public.chat_send_message(uuid, uuid, text, uuid) to service_role;

commit;
