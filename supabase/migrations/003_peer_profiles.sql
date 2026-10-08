-- Run after 001_chat.sql and 002_telegram_notifications.sql.
begin;
alter table public.chat_profiles add column if not exists academic_gpa numeric;
alter table public.chat_profiles add column if not exists study_group text;
alter table public.chat_profiles add column if not exists study_course integer;
alter table public.chat_profiles add column if not exists study_updated_at timestamptz;

create or replace function public.chat_sync_student_profile(p_user_id uuid, p_academic_gpa numeric, p_group text, p_course integer)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_academic_gpa < 0 or p_academic_gpa > 4 or p_course < 1 or p_course > 8 or char_length(p_group) > 120 then
    raise exception 'invalid_student_profile' using errcode = '22023';
  end if;
  update public.chat_profiles set academic_gpa = p_academic_gpa, study_group = p_group,
    study_course = p_course, study_updated_at = now() where id = p_user_id;
end;
$$;

create or replace function public.chat_peer_profile(p_user_id uuid, p_conversation_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare peer_id uuid; result jsonb;
begin
  select case when user_a = p_user_id then user_b else user_a end into peer_id
    from public.chat_conversations where id = p_conversation_id and p_user_id in (user_a, user_b);
  if peer_id is null then raise exception 'chat_forbidden' using errcode = '42501'; end if;
  select jsonb_build_object('id', id, 'name', display_name, 'studentID', student_id,
    'academicGpa', academic_gpa, 'group', study_group, 'course', study_course, 'updatedAt', study_updated_at)
    into result from public.chat_profiles where id = peer_id;
  return result;
end;
$$;
revoke execute on function public.chat_sync_student_profile(uuid,numeric,text,integer), public.chat_peer_profile(uuid,uuid) from public, anon, authenticated;
grant execute on function public.chat_sync_student_profile(uuid,numeric,text,integer), public.chat_peer_profile(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
