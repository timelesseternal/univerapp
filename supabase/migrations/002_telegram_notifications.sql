-- Run AFTER 001_chat.sql. Only the server can link users and operate the queue.
begin;
create table if not exists public.chat_telegram_links (
  user_id uuid primary key references public.chat_profiles(id) on delete cascade,
  telegram_id bigint not null unique check (telegram_id > 0),
  linked_at timestamptz not null default now()
);
create table if not exists public.chat_notifications (
  message_id bigint primary key references public.chat_messages(id) on delete cascade,
  recipient_id uuid not null references public.chat_profiles(id),
  telegram_id bigint not null,
  telegram_message_id bigint,
  state text not null default 'queued' check (state in ('queued','sending','sent','deleting','deleted','failed','suppressed')),
  lease uuid,
  leased_until timestamptz,
  sent_at timestamptz,
  attempts integer not null default 0
);
create index if not exists chat_notifications_recipient on public.chat_notifications(recipient_id, state);
alter table public.chat_telegram_links enable row level security;
alter table public.chat_notifications enable row level security;
revoke all on public.chat_telegram_links, public.chat_notifications from public, anon, authenticated;
grant all on public.chat_telegram_links, public.chat_notifications to service_role;

create or replace function public.chat_link_telegram(p_user_id uuid, p_telegram_id bigint)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  -- One Telegram account follows one currently selected Platonus account.
  perform pg_advisory_xact_lock(p_telegram_id);
  delete from chat_telegram_links where telegram_id=p_telegram_id and user_id<>p_user_id;
  insert into chat_telegram_links(user_id,telegram_id) values(p_user_id,p_telegram_id)
  on conflict(user_id) do update set telegram_id=excluded.telegram_id, linked_at=now();
  return true;
end;
$$;

create or replace function public.chat_queue_notification()
returns trigger language plpgsql security invoker set search_path=public as $$
declare recipient uuid;
begin
  select case when user_a=new.sender_id then user_b else user_a end into recipient
  from chat_conversations where id=new.conversation_id;
  insert into chat_notifications(message_id,recipient_id,telegram_id)
  select new.id,recipient,telegram_id from chat_telegram_links where user_id=recipient
  on conflict(message_id) do nothing;
  return new;
end;
$$;
drop trigger if exists chat_notification_created on public.chat_messages;
create trigger chat_notification_created after insert on public.chat_messages
for each row execute function public.chat_queue_notification();

create or replace function public.chat_claim_notifications(p_user_id uuid, p_mode text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
  if p_mode not in ('send','delete') then raise exception 'invalid_mode' using errcode='22023'; end if;
  -- Do not deliver queued notifications that have already been read, or to a stale link.
  update chat_notifications n set state='suppressed'
  from chat_messages m, chat_conversations c
  where n.message_id=m.id and c.id=m.conversation_id and m.sender_id=p_user_id
    and n.state='queued' and (
      m.created_at<=coalesce(case when c.user_a=n.recipient_id then c.read_a else c.read_b end,'epoch'::timestamptz)
      or not exists(select 1 from chat_telegram_links l where l.user_id=n.recipient_id and l.telegram_id=n.telegram_id)
    );
  with candidates as (
    select n.message_id from chat_notifications n
    join chat_messages m on m.id=n.message_id
    join chat_conversations c on c.id=m.conversation_id
    where (
      p_mode='send' and m.sender_id=p_user_id and n.attempts<5
      and (n.state='queued' or (n.state='sending' and n.leased_until<now()))
      and m.created_at>coalesce(case when c.user_a=n.recipient_id then c.read_a else c.read_b end,'epoch'::timestamptz)
      and exists(select 1 from chat_telegram_links l where l.user_id=n.recipient_id and l.telegram_id=n.telegram_id)
    ) or (
      p_mode='delete' and n.recipient_id=p_user_id
      and (n.state='sent' or (n.state='deleting' and n.leased_until<now()))
      and m.created_at<=coalesce(case when c.user_a=p_user_id then c.read_a else c.read_b end,'epoch'::timestamptz)
    ) order by n.message_id limit 5 for update of n skip locked
  ), claimed as (
    update chat_notifications n set state=case when p_mode='send' then 'sending' else 'deleting' end,
      lease=gen_random_uuid(), leased_until=now()+interval '90 seconds', attempts=attempts+1
    from candidates where n.message_id=candidates.message_id returning n.*
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'id',n.message_id::text,'lease',n.lease,'telegramID',n.telegram_id::text,
    'telegramMessageID',n.telegram_message_id,'sentAt',n.sent_at,
    'conversationID',m.conversation_id,'name',p.display_name,'text',m.body
  )), '[]'::jsonb) into result
  from claimed n join chat_messages m on m.id=n.message_id join chat_profiles p on p.id=m.sender_id;
  return result;
end;
$$;

create or replace function public.chat_finish_notification(p_message_id bigint,p_lease uuid,p_outcome text,p_telegram_message_id bigint default null)
returns boolean language plpgsql security invoker set search_path=public as $$
declare notification chat_notifications; already_read boolean;
begin
  select * into notification from chat_notifications where message_id=p_message_id and lease=p_lease for update;
  if notification.message_id is null then return false; end if;
  if p_outcome='sent' and notification.state='sending' then
    if p_telegram_message_id is null then raise exception 'missing_message_id' using errcode='22023'; end if;
    update chat_notifications set state='sent',telegram_message_id=p_telegram_message_id,sent_at=clock_timestamp() where message_id=p_message_id;
    select m.created_at<=coalesce(case when c.user_a=notification.recipient_id then c.read_a else c.read_b end,'epoch'::timestamptz)
    into already_read from chat_messages m join chat_conversations c on c.id=m.conversation_id where m.id=p_message_id;
    return already_read;
  elsif p_outcome='deleted' and notification.state in ('sent','deleting') then
    update chat_notifications set state='deleted',leased_until=null where message_id=p_message_id;
  elsif p_outcome='retry' and notification.state in ('sending','deleting') then
    update chat_notifications set state=case when notification.state='sending' then 'queued' else 'sent' end,leased_until=null where message_id=p_message_id;
  elsif p_outcome='failed' then
    update chat_notifications set state='failed',leased_until=null where message_id=p_message_id;
  else raise exception 'invalid_outcome' using errcode='22023';
  end if;
  return false;
end;
$$;
-- Loading data does not mean the recipient has seen it. The browser acknowledges
-- only after rendering a visible conversation, with the highest displayed message ID.
create or replace function public.chat_read_messages(p_user_id uuid,p_conversation_id uuid,p_before bigint default null,p_after bigint default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; page_size integer;
begin
  if not exists(select 1 from chat_conversations where id=p_conversation_id and p_user_id in(user_a,user_b)) then
    raise exception 'not_a_participant' using errcode='42501';
  end if;
  if p_before is not null and p_after is not null then raise exception 'invalid_cursor' using errcode='22023'; end if;
  page_size:=case when p_after is null then 50 else 100 end;
  with page as (
    select * from chat_messages where conversation_id=p_conversation_id and (p_before is null or id<p_before) and (p_after is null or id>p_after)
    order by case when p_after is not null then id end asc,id desc limit page_size+1
  ), visible as (select * from page order by case when p_after is not null then id end asc,id desc limit page_size)
  select jsonb_build_object('messages',coalesce(jsonb_agg(jsonb_build_object(
    'id',id::text,'senderID',sender_id,'text',body,'createdAt',created_at,'clientID',client_id) order by id),'[]'::jsonb),
    'hasMore',(select count(*)>page_size from page)) into result from visible;
  return result;
end;
$$;
create or replace function public.chat_mark_read(p_user_id uuid,p_conversation_id uuid,p_through_id bigint)
returns boolean language plpgsql security invoker set search_path=public as $$
declare read_at timestamptz;
begin
  if not exists(select 1 from chat_conversations where id=p_conversation_id and p_user_id in(user_a,user_b)) then
    raise exception 'not_a_participant' using errcode='42501';
  end if;
  select max(created_at) into read_at from chat_messages where conversation_id=p_conversation_id and id<=p_through_id;
  if read_at is not null then
    update chat_conversations set
      read_a=case when user_a=p_user_id then greatest(coalesce(read_a,'epoch'::timestamptz),read_at) else read_a end,
      read_b=case when user_b=p_user_id then greatest(coalesce(read_b,'epoch'::timestamptz),read_at) else read_b end
    where id=p_conversation_id;
  end if;
  return true;
end;
$$;
create or replace function public.chat_get_conversation(p_user_id uuid,p_conversation_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
  select jsonb_build_object('id',c.id,'peer',jsonb_build_object('id',p.id,'name',p.display_name)) into result
  from chat_conversations c join chat_profiles p on p.id=case when c.user_a=p_user_id then c.user_b else c.user_a end
  where c.id=p_conversation_id and p_user_id in(c.user_a,c.user_b);
  if result is null then raise exception 'not_a_participant' using errcode='42501'; end if;
  return result;
end;
$$;
revoke execute on function public.chat_get_conversation(uuid,uuid),public.chat_mark_read(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.chat_get_conversation(uuid,uuid),public.chat_mark_read(uuid,uuid,bigint) to service_role;
revoke execute on function public.chat_link_telegram(uuid,bigint),public.chat_queue_notification(),
 public.chat_claim_notifications(uuid,text),public.chat_finish_notification(bigint,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.chat_link_telegram(uuid,bigint),public.chat_queue_notification(),
 public.chat_claim_notifications(uuid,text),public.chat_finish_notification(bigint,uuid,text,bigint) to service_role;
commit;
