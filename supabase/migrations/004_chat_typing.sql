-- Run after 001_chat.sql. Only verified participants can publish/read typing.
begin;
alter table public.chat_conversations add column if not exists typing_a_until timestamptz;
alter table public.chat_conversations add column if not exists typing_b_until timestamptz;

create or replace function public.chat_set_typing(p_user_id uuid, p_conversation_id uuid, p_typing boolean)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.chat_conversations set
    typing_a_until = case when user_a = p_user_id then case when p_typing then clock_timestamp() + interval '6 seconds' else null end else typing_a_until end,
    typing_b_until = case when user_b = p_user_id then case when p_typing then clock_timestamp() + interval '6 seconds' else null end else typing_b_until end
  where id = p_conversation_id and p_user_id in (user_a, user_b);
  if not found then raise exception 'chat_forbidden' using errcode = '42501'; end if;
  return true;
end;
$$;
create or replace function public.chat_peer_typing(p_user_id uuid, p_conversation_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
declare deadline timestamptz;
begin
  select case when user_a = p_user_id then typing_b_until else typing_a_until end into deadline
  from public.chat_conversations where id = p_conversation_id and p_user_id in (user_a, user_b);
  if not found then raise exception 'chat_forbidden' using errcode = '42501'; end if;
  return coalesce(deadline > clock_timestamp(), false);
end;
$$;
revoke all on function public.chat_set_typing(uuid, uuid, boolean), public.chat_peer_typing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_set_typing(uuid, uuid, boolean), public.chat_peer_typing(uuid, uuid) to service_role;
commit;
