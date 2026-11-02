-- Run after 001–006. Existing messages and client IDs are preserved.
begin;
alter table public.chat_messages add column if not exists reply_to bigint references public.chat_messages(id);
alter table public.chat_messages add column if not exists forwarded_name text;
alter table public.chat_messages add column if not exists deleted_revision bigint;
alter table public.chat_conversations add column if not exists message_revision bigint not null default 0;
create index if not exists chat_messages_deleted on public.chat_messages(conversation_id, deleted_revision) where deleted_revision is not null;

create or replace function public.chat_inbox(p_user_id uuid)
returns jsonb language sql security invoker set search_path=public as $$
  select coalesce(jsonb_agg(entry order by updated_at desc,id),'[]'::jsonb) from (
    select c.id,c.updated_at,jsonb_build_object('id',c.id,'peer',jsonb_build_object('id',p.id,'name',p.display_name),
      'lastMessage',case when last.id is null then null else jsonb_build_object('text',last.body,'createdAt',last.created_at,'senderID',last.sender_id) end,
      'unread',(select count(*) from chat_messages m where m.conversation_id=c.id and m.sender_id<>p_user_id
        and m.deleted_revision is null and m.created_at>coalesce(case when c.user_a=p_user_id then c.read_a else c.read_b end,'epoch'::timestamptz))) as entry
    from chat_conversations c join chat_profiles p on p.id=case when c.user_a=p_user_id then c.user_b else c.user_a end
    left join lateral(select id,body,created_at,sender_id from chat_messages where conversation_id=c.id order by id desc limit 1) last on true
    where p_user_id in(c.user_a,c.user_b) order by c.updated_at desc,c.id limit 100
  ) inbox;
$$;

create or replace function public.chat_message_json(p_message_id bigint)
returns jsonb language sql security invoker set search_path=public as $$
  select jsonb_build_object('id',m.id::text,'senderID',m.sender_id,'text',m.body,
    'createdAt',m.created_at,'clientID',m.client_id,'deleted',m.deleted_revision is not null,
    'forwardedName',m.forwarded_name,
    'reply',case when r.id is null then null else jsonb_build_object('id',r.id::text,
      'senderID',r.sender_id,'name',p.display_name,'deleted',r.deleted_revision is not null,
      'text',case when r.deleted_revision is not null then 'Сообщение удалено' else r.body end) end)
  from chat_messages m left join chat_messages r on r.id=m.reply_to and r.conversation_id=m.conversation_id
  left join chat_profiles p on p.id=r.sender_id where m.id=p_message_id;
$$;

create or replace function public.chat_read_messages_v2(p_user_id uuid,p_conversation_id uuid,
  p_before bigint default null,p_after bigint default null,p_revision bigint default 0)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; revision bigint;
begin
  -- Serialize deletion revisions with reads so an uncommitted delete cannot be skipped.
  select message_revision into revision from chat_conversations where id=p_conversation_id
    and p_user_id in(user_a,user_b) for update;
  if not found then raise exception 'not_a_participant' using errcode='42501'; end if;
  result:=chat_read_messages(p_user_id,p_conversation_id,p_before,p_after);
  return result || jsonb_build_object('revision',revision::text,
    'messages',coalesce((select jsonb_agg(chat_message_json((entry->>'id')::bigint) order by (entry->>'id')::bigint)
      from jsonb_array_elements(result->'messages') entry),'[]'::jsonb),
    'deletedIDs',coalesce((select jsonb_agg(id::text) from chat_messages where conversation_id=p_conversation_id
      and deleted_revision>coalesce(p_revision,0)),'[]'::jsonb));
end;
$$;

create or replace function public.chat_send_message_v2(p_user_id uuid,p_conversation_id uuid,p_body text,
  p_client_id uuid,p_reply_to bigint default null,p_forward_id bigint default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare source chat_messages; existing chat_messages; sent jsonb; author text;
begin
  if not exists(select 1 from chat_conversations where id=p_conversation_id and p_user_id in(user_a,user_b)) then
    raise exception 'not_a_participant' using errcode='42501'; end if;
  perform 1 from chat_profiles where id=p_user_id for update;
  select * into existing from chat_messages where conversation_id=p_conversation_id and sender_id=p_user_id and client_id=p_client_id;
  if found then return chat_message_json(existing.id); end if;
  if p_reply_to is not null and p_forward_id is not null then raise exception 'invalid_message' using errcode='22023'; end if;
  if p_reply_to is not null then
    perform 1 from chat_messages where id=p_reply_to and conversation_id=p_conversation_id and deleted_revision is null;
    if not found then raise exception 'message_unavailable' using errcode='22023'; end if;
  end if;
  if p_forward_id is not null then
    select m.* into source from chat_messages m join chat_conversations c on c.id=m.conversation_id
      where m.id=p_forward_id and p_user_id in(c.user_a,c.user_b) and m.deleted_revision is null;
    if not found then raise exception 'message_unavailable' using errcode='42501'; end if;
    select coalesce(source.forwarded_name,display_name) into author from chat_profiles where id=source.sender_id;
    p_body:=source.body;
  end if;
  sent:=chat_send_message(p_user_id,p_conversation_id,p_body,p_client_id);
  update chat_messages set reply_to=p_reply_to,forwarded_name=author where id=(sent->>'id')::bigint;
  return chat_message_json((sent->>'id')::bigint);
end;
$$;

create or replace function public.chat_delete_message(p_user_id uuid,p_conversation_id uuid,p_message_id bigint)
returns boolean language plpgsql security invoker set search_path=public as $$
declare revision bigint;
begin
  perform 1 from chat_profiles where id=p_user_id for update;
  perform 1 from chat_conversations where id=p_conversation_id and p_user_id in(user_a,user_b) for update;
  if not found then raise exception 'not_a_participant' using errcode='42501'; end if;
  perform 1 from chat_messages where id=p_message_id and conversation_id=p_conversation_id and sender_id=p_user_id for update;
  if not found then raise exception 'not_the_sender' using errcode='42501'; end if;
  if exists(select 1 from chat_messages where id=p_message_id and deleted_revision is not null) then return true; end if;
  update chat_conversations set message_revision=message_revision+1 where id=p_conversation_id returning message_revision into revision;
  update chat_messages set body='Сообщение удалено',reply_to=null,forwarded_name=null,deleted_revision=revision where id=p_message_id;
  update chat_notifications set state='suppressed' where message_id=p_message_id and state='queued';
  -- The original text is erased. Existing independent forwarded copies remain.
  return true;
end;
$$;
revoke execute on function public.chat_message_json(bigint),
  public.chat_read_messages_v2(uuid,uuid,bigint,bigint,bigint),
  public.chat_send_message_v2(uuid,uuid,text,uuid,bigint,bigint),
  public.chat_delete_message(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.chat_message_json(bigint),
  public.chat_read_messages_v2(uuid,uuid,bigint,bigint,bigint),
  public.chat_send_message_v2(uuid,uuid,text,uuid,bigint,bigint),
  public.chat_delete_message(uuid,uuid,bigint) to service_role;
commit;
