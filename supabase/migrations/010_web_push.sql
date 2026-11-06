begin;
create table if not exists public.chat_push_keyring (
  id boolean primary key default true check(id),
  public_key text not null,
  private_encrypted text not null
);
create table if not exists public.chat_notification_preferences (
  user_id uuid primary key references public.chat_profiles(id) on delete cascade,
  telegram_enabled boolean not null default true
);
create table if not exists public.chat_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.chat_profiles(id) on delete cascade,
  endpoint text not null unique check(length(endpoint) between 20 and 4096),
  p256dh text not null,
  auth text not null,
  session_hash text not null check(session_hash ~ '^[a-f0-9]{64}$'),
  last_test_at timestamptz not null default 'epoch',
  expires_at timestamptz not null default(now()+interval '180 days'),
  updated_at timestamptz not null default now()
);
create index if not exists chat_push_owner on public.chat_push_subscriptions(user_id);
create index if not exists chat_push_session on public.chat_push_subscriptions(session_hash);
create table if not exists public.chat_push_jobs (
  message_id bigint not null references public.chat_messages(id) on delete cascade,
  subscription_id uuid not null references public.chat_push_subscriptions(id) on delete cascade,
  recipient_id uuid not null references public.chat_profiles(id) on delete cascade,
  state text not null default 'queued' check(state in('queued','sending','sent','failed','suppressed')),
  lease uuid,
  leased_until timestamptz,
  attempts integer not null default 0,
  primary key(message_id,subscription_id)
);
create index if not exists chat_push_pending on public.chat_push_jobs(state,message_id);
alter table public.chat_push_keyring enable row level security;
alter table public.chat_notification_preferences enable row level security;
alter table public.chat_push_subscriptions enable row level security;
alter table public.chat_push_jobs enable row level security;
revoke all on public.chat_push_keyring,public.chat_notification_preferences,public.chat_push_subscriptions,public.chat_push_jobs from public,anon,authenticated;
grant all on public.chat_push_keyring,public.chat_notification_preferences,public.chat_push_subscriptions,public.chat_push_jobs to service_role;

create or replace function public.chat_save_push(p_user_id uuid,p_session_hash text,p_endpoint text,p_p256dh text,p_auth text,p_disable_telegram boolean)
returns boolean language plpgsql security invoker set search_path=public as $$
declare existing chat_push_subscriptions;
begin
  perform 1 from chat_profiles where id=p_user_id for update;
  if not found then raise exception 'invalid_user' using errcode='42501'; end if;
  perform 1 from chat_sessions where user_id=p_user_id and token_hash=p_session_hash and expires_at>now() for share;
  if not found then raise exception 'expired_session' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
  select * into existing from chat_push_subscriptions where endpoint=p_endpoint for update;
  if found and (existing.auth<>p_auth or existing.p256dh<>p_p256dh) then raise exception 'invalid_subscription' using errcode='42501'; end if;
  if (existing.id is null or existing.user_id<>p_user_id) and (select count(*) from chat_push_subscriptions where user_id=p_user_id and expires_at>now())>=10 then
    raise exception 'too_many_devices' using errcode='22023'; end if;
  if existing.id is not null and existing.user_id<>p_user_id then
    delete from chat_push_jobs where subscription_id=existing.id;
  end if;
  insert into chat_push_subscriptions(user_id,endpoint,p256dh,auth,session_hash)
    values(p_user_id,p_endpoint,p_p256dh,p_auth,p_session_hash)
    on conflict(endpoint) do update set user_id=excluded.user_id,session_hash=excluded.session_hash,expires_at=now()+interval '180 days',updated_at=now();
  if p_disable_telegram then
    insert into chat_notification_preferences(user_id,telegram_enabled) values(p_user_id,false)
      on conflict(user_id) do update set telegram_enabled=false;
    update chat_notifications set state='suppressed' where recipient_id=p_user_id and state='queued';
  end if;
  return true;
end;
$$;

create or replace function public.chat_touch_push(p_user_id uuid,p_session_hash text,p_endpoint text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  perform 1 from chat_sessions where user_id=p_user_id and token_hash=p_session_hash and expires_at>now() for share;
  if not found then raise exception 'expired_session' using errcode='42501'; end if;
  update chat_push_subscriptions set session_hash=p_session_hash,updated_at=now()
    where user_id=p_user_id and endpoint=p_endpoint and expires_at>now();
  return found;
end;
$$;

create or replace function public.chat_push_created()
returns trigger language plpgsql security invoker set search_path=public as $$
declare recipient uuid;
begin
  select case when user_a=new.sender_id then user_b else user_a end into recipient from chat_conversations where id=new.conversation_id;
  insert into chat_push_jobs(message_id,subscription_id,recipient_id)
    select new.id,s.id,recipient from chat_push_subscriptions s where s.user_id=recipient and s.expires_at>now()
    on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists chat_push_created on public.chat_messages;
create trigger chat_push_created after insert on public.chat_messages for each row execute function public.chat_push_created();

create or replace function public.chat_claim_push(p_sender_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
  update chat_push_jobs j set state='suppressed' from chat_messages m,chat_conversations c,chat_push_subscriptions s
    where j.message_id=m.id and m.conversation_id=c.id and s.id=j.subscription_id and m.sender_id=p_sender_id
      and j.state in('queued','sending') and (m.deleted_revision is not null or s.user_id<>j.recipient_id or s.expires_at<=now()
        or m.created_at<=coalesce(case when c.user_a=j.recipient_id then c.read_a else c.read_b end,'epoch'::timestamptz)
        or exists(select 1 from chat_message_hides h where h.user_id=j.recipient_id and h.message_id=m.id));
  with candidates as (
    select j.message_id,j.subscription_id from chat_push_jobs j join chat_messages m on m.id=j.message_id
    where m.sender_id=p_sender_id and j.attempts<4 and m.created_at>now()-interval '1 day'
      and (j.state='queued' or(j.state='sending' and j.leased_until<now()))
    order by j.message_id limit 8 for update of j skip locked
  ), claimed as (
    update chat_push_jobs j set state='sending',lease=gen_random_uuid(),leased_until=now()+interval '60 seconds',attempts=attempts+1
    from candidates c where j.message_id=c.message_id and j.subscription_id=c.subscription_id returning j.*
  ) select coalesce(jsonb_agg(jsonb_build_object('messageID',j.message_id::text,'subscriptionID',j.subscription_id,
    'lease',j.lease,'owner',j.recipient_id,'conversationID',m.conversation_id,'name',p.display_name,'text',left(m.body,200),
    'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth)))),'[]'::jsonb)
    into result from claimed j join chat_push_subscriptions s on s.id=j.subscription_id
    join chat_messages m on m.id=j.message_id join chat_profiles p on p.id=m.sender_id;
  return result;
end;
$$;
create or replace function public.chat_finish_push(p_message_id bigint,p_subscription_id uuid,p_lease uuid,p_state text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  if p_state not in('sent','queued','failed') then raise exception 'invalid_state' using errcode='22023'; end if;
  update chat_push_jobs set state=p_state,leased_until=null where message_id=p_message_id and subscription_id=p_subscription_id and lease=p_lease and state='sending';
  return found;
end;
$$;

-- Keep Telegram's existing delivery/read logic, but filter opted-out recipients.
do $$ begin
  if to_regprocedure('public.chat_claim_notifications_legacy(uuid,text)') is null then
    alter function public.chat_claim_notifications(uuid,text) rename to chat_claim_notifications_legacy;
  end if;
end $$;
create or replace function public.chat_claim_notifications(p_user_id uuid,p_mode text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare jobs jsonb; job jsonb; result jsonb:='[]'; allowed boolean;
begin
  jobs:=chat_claim_notifications_legacy(p_user_id,p_mode);
  if p_mode='delete' then return jobs; end if;
  for job in select * from jsonb_array_elements(jobs) loop
    select coalesce(p.telegram_enabled,true) into allowed from chat_notifications n
      left join chat_notification_preferences p on p.user_id=n.recipient_id where n.message_id=(job->>'id')::bigint;
    if allowed then result:=result||jsonb_build_array(job);
    else update chat_notifications set state='suppressed',leased_until=null where message_id=(job->>'id')::bigint; end if;
  end loop;
  return result;
end;
$$;
revoke execute on function public.chat_save_push(uuid,text,text,text,text,boolean),public.chat_push_created(),
  public.chat_claim_push(uuid),public.chat_finish_push(bigint,uuid,uuid,text),public.chat_claim_notifications(uuid,text),public.chat_touch_push(uuid,text,text) from public,anon,authenticated;
grant execute on function public.chat_save_push(uuid,text,text,text,text,boolean),public.chat_push_created(),
  public.chat_claim_push(uuid),public.chat_finish_push(bigint,uuid,uuid,text),public.chat_claim_notifications(uuid,text),public.chat_touch_push(uuid,text,text) to service_role;
commit;
