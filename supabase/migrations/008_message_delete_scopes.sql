-- Run AFTER 007. Personal hiding never erases the other participant's copy.
begin;
create table if not exists public.chat_message_hides (
  user_id uuid not null references public.chat_profiles(id) on delete cascade,
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  revision bigint not null,
  primary key(user_id,message_id)
);
alter table public.chat_message_hides enable row level security;
revoke all on public.chat_message_hides from public,anon,authenticated;
grant all on public.chat_message_hides to service_role;

create or replace function public.chat_message_view(p_user_id uuid,p_message_id bigint)
returns jsonb language sql security invoker set search_path=public as $$
  select case when m.deleted_revision is not null or h.message_id is not null
    then jsonb_build_object('id',m.id::text,'senderID',m.sender_id,'text','Сообщение удалено',
      'createdAt',m.created_at,'clientID',m.client_id,'deleted',true,'hidden',true)
    else chat_message_json(m.id) || jsonb_build_object('reply',case when r.id is null then null
      when r.deleted_revision is not null or rh.message_id is not null then jsonb_build_object(
        'id',r.id::text,'senderID',r.sender_id,'name',p.display_name,'text','Сообщение удалено','deleted',true)
      else chat_message_json(m.id)->'reply' end) end
  from chat_messages m join chat_conversations c on c.id=m.conversation_id
  left join chat_message_hides h on h.user_id=p_user_id and h.message_id=m.id
  left join chat_messages r on r.id=m.reply_to and r.conversation_id=m.conversation_id
  left join chat_message_hides rh on rh.user_id=p_user_id and rh.message_id=r.id
  left join chat_profiles p on p.id=r.sender_id
  where m.id=p_message_id and p_user_id in(c.user_a,c.user_b);
$$;

create or replace function public.chat_read_messages_v3(p_user_id uuid,p_conversation_id uuid,
  p_before bigint default null,p_after bigint default null,p_revision bigint default 0)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; revision bigint; page_size integer;
begin
  select message_revision into revision from chat_conversations where id=p_conversation_id
    and p_user_id in(user_a,user_b) for update;
  if not found then raise exception 'not_a_participant' using errcode='42501'; end if;
  if p_before is not null and p_after is not null then raise exception 'invalid_cursor' using errcode='22023'; end if;
  page_size:=case when p_after is null then 50 else 100 end;
  -- Apply visibility before pagination: a page of removed messages must not hide older history.
  with page as (
    select m.id from chat_messages m where m.conversation_id=p_conversation_id
      and m.deleted_revision is null and not exists(select 1 from chat_message_hides h where h.user_id=p_user_id and h.message_id=m.id)
      and (p_before is null or m.id<p_before) and (p_after is null or m.id>p_after)
      order by case when p_after is not null then m.id end asc,m.id desc limit page_size+1
  ), visible as (select id from page order by case when p_after is not null then id end asc,id desc limit page_size)
  select jsonb_build_object('messages',coalesce(jsonb_agg(chat_message_view(p_user_id,id) order by id),'[]'::jsonb),
    'hasMore',(select count(*)>page_size from page)) into result from visible;
  return result || jsonb_build_object('deleteScopes',true,'revision',revision::text,
    'deletedIDs',coalesce((select jsonb_agg(id::text) from chat_messages where conversation_id=p_conversation_id
      and deleted_revision>coalesce(p_revision,0)),'[]'::jsonb),
    'hiddenIDs',coalesce((select jsonb_agg(h.message_id::text) from chat_message_hides h
      join chat_messages m on m.id=h.message_id where h.user_id=p_user_id
      and m.conversation_id=p_conversation_id and h.revision>coalesce(p_revision,0)),'[]'::jsonb));
end;
$$;

create or replace function public.chat_delete_message_v2(p_user_id uuid,p_conversation_id uuid,p_message_id bigint,p_scope text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare revision bigint;
begin
  if p_scope is null or p_scope not in('self','everyone') then raise exception 'invalid_scope' using errcode='22023'; end if;
  perform 1 from chat_profiles where id=p_user_id for update;
  perform 1 from chat_conversations where id=p_conversation_id and p_user_id in(user_a,user_b) for update;
  if not found then raise exception 'not_a_participant' using errcode='42501'; end if;
  perform 1 from chat_messages where id=p_message_id and conversation_id=p_conversation_id for update;
  if not found then raise exception 'invalid_message' using errcode='42501'; end if;
  if p_scope='self' then
    if exists(select 1 from chat_message_hides where user_id=p_user_id and message_id=p_message_id) then return true; end if;
    update chat_conversations set message_revision=message_revision+1 where id=p_conversation_id returning message_revision into revision;
    insert into chat_message_hides(user_id,message_id,revision) values(p_user_id,p_message_id,revision);
  else
    -- Like a private Telegram conversation, either participant can delete for both.
    if exists(select 1 from chat_messages where id=p_message_id and deleted_revision is not null) then return true; end if;
    update chat_conversations set message_revision=message_revision+1 where id=p_conversation_id returning message_revision into revision;
    update chat_messages set body='Сообщение удалено',reply_to=null,forwarded_name=null,deleted_revision=revision where id=p_message_id;
    update chat_notifications set state='suppressed' where message_id=p_message_id and state='queued';
  end if;
  return true;
end;
$$;

create or replace function public.chat_send_message_v3(p_user_id uuid,p_conversation_id uuid,p_body text,
  p_client_id uuid,p_reply_to bigint default null,p_forward_id bigint default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare sent jsonb;
begin
  if exists(select 1 from chat_message_hides where user_id=p_user_id and message_id in(p_reply_to,p_forward_id)) then
    raise exception 'message_unavailable' using errcode='42501'; end if;
  sent:=chat_send_message_v2(p_user_id,p_conversation_id,p_body,p_client_id,p_reply_to,p_forward_id);
  return chat_message_view(p_user_id,(sent->>'id')::bigint);
end;
$$;

create or replace function public.chat_inbox(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(entry order by updated_at desc,id),'[]'::jsonb) from (
    select c.id,c.updated_at,jsonb_build_object('id',c.id,'peer',jsonb_build_object('id',p.id,'name',p.display_name),
      'lastMessage',case when last.id is null then null else jsonb_build_object('text',last.body,'createdAt',last.created_at,'senderID',last.sender_id) end,
      'unread',(select count(*) from chat_messages m where m.conversation_id=c.id and m.sender_id<>p_user_id
        and m.deleted_revision is null and not exists(select 1 from chat_message_hides h where h.user_id=p_user_id and h.message_id=m.id)
        and m.created_at>coalesce(case when c.user_a=p_user_id then c.read_a else c.read_b end,'epoch'::timestamptz))) as entry
    from chat_conversations c join chat_profiles p on p.id=case when c.user_a=p_user_id then c.user_b else c.user_a end
    left join lateral(select m.id,m.body,m.created_at,m.sender_id from chat_messages m where m.conversation_id=c.id
      and m.deleted_revision is null and not exists(select 1 from chat_message_hides h where h.user_id=p_user_id and h.message_id=m.id)
      order by m.id desc limit 1) last on true
    where p_user_id in(c.user_a,c.user_b) order by c.updated_at desc,c.id limit 100
  ) inbox;
$$;
revoke execute on function public.chat_message_view(uuid,bigint),public.chat_read_messages_v3(uuid,uuid,bigint,bigint,bigint),
  public.chat_delete_message_v2(uuid,uuid,bigint,text),public.chat_send_message_v3(uuid,uuid,text,uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.chat_message_view(uuid,bigint),public.chat_read_messages_v3(uuid,uuid,bigint,bigint,bigint),
  public.chat_delete_message_v2(uuid,uuid,bigint,text),public.chat_send_message_v3(uuid,uuid,text,uuid,bigint,bigint) to service_role;
commit;
