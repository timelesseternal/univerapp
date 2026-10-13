-- Run after 001_chat.sql. Presence is private to verified conversation participants.
begin;
alter table public.chat_profiles add column if not exists last_seen_at timestamptz;
create table if not exists public.chat_presence (
  token_hash text not null references public.chat_sessions(token_hash) on delete cascade,
  client_id uuid not null,
  online_until timestamptz not null,
  sequence integer not null,
  primary key (token_hash, client_id)
);
alter table public.chat_presence enable row level security;
revoke all on public.chat_presence from public, anon, authenticated;
grant all on public.chat_presence to service_role;
create index if not exists chat_sessions_user_presence on public.chat_sessions(user_id,expires_at);

create or replace function public.chat_touch_presence(p_user_id uuid, p_token_hash text, p_client_id uuid, p_active boolean, p_sequence integer)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from chat_sessions where token_hash=p_token_hash and user_id=p_user_id and expires_at>clock_timestamp())
    then raise exception 'not_allowed' using errcode='42501'; end if;
  if p_sequence < 1 then raise exception 'invalid_sequence' using errcode='22023'; end if;
  insert into chat_presence(token_hash,client_id,online_until,sequence)
    values(p_token_hash,p_client_id,case when p_active then clock_timestamp()+interval '45 seconds' else clock_timestamp() end,p_sequence)
    on conflict(token_hash,client_id) do update set online_until=excluded.online_until,sequence=excluded.sequence
    where chat_presence.sequence < excluded.sequence;
  if found then update chat_profiles set last_seen_at=clock_timestamp() where id=p_user_id; end if;
end $$;

create or replace function public.chat_peer_presence(p_user_id uuid, p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare peer uuid; seen timestamptz;
begin
  select case when user_a=p_user_id then user_b else user_a end into peer from chat_conversations
    where id=p_conversation_id and p_user_id in (user_a,user_b);
  if peer is null then raise exception 'not_allowed' using errcode='42501'; end if;
  select last_seen_at into seen from chat_profiles where id=peer;
  return jsonb_build_object('lastSeen',seen,'online',exists(
    select 1 from chat_presence p join chat_sessions s using(token_hash)
      where s.user_id=peer and s.expires_at>clock_timestamp() and p.online_until>clock_timestamp()));
end $$;
revoke all on function public.chat_touch_presence(uuid,text,uuid,boolean,integer), public.chat_peer_presence(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_touch_presence(uuid,text,uuid,boolean,integer), public.chat_peer_presence(uuid,uuid) to service_role;
commit;
