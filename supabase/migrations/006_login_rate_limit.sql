-- Shared login limits work across Vercel instances. No logins, passwords or IPs are stored.
begin;
create table if not exists public.security_login_limits (
  key text primary key,
  started_at timestamptz not null,
  attempts integer not null
);
alter table public.security_login_limits enable row level security;
revoke all on public.security_login_limits from public,anon,authenticated;
grant all on public.security_login_limits to service_role;
create or replace function public.security_login_attempt(p_ip_key text,p_account_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item record; count_now integer; started timestamptz; allowed boolean:=true; retry integer:=0;
begin
  if p_ip_key !~ '^[a-f0-9]{64}$' or p_account_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid_key' using errcode='22023'; end if;
  delete from security_login_limits where started_at < clock_timestamp()-interval '1 hour';
  -- Fixed order prevents conflicting account/IP locks between concurrent requests.
  for item in select * from (values ('account:'||p_account_key,8),('ip:'||p_ip_key,30)) as limits(k,maximum) order by k loop
    insert into security_login_limits(key,started_at,attempts) values(item.k,clock_timestamp(),1)
    on conflict(key) do update set
      attempts=case when security_login_limits.started_at<clock_timestamp()-interval '10 minutes' then 1 else security_login_limits.attempts+1 end,
      started_at=case when security_login_limits.started_at<clock_timestamp()-interval '10 minutes' then clock_timestamp() else security_login_limits.started_at end
    returning attempts,started_at into count_now,started;
    if count_now>item.maximum then allowed:=false;retry:=greatest(retry,ceil(extract(epoch from started+interval '10 minutes'-clock_timestamp()))::integer);end if;
  end loop;
  return jsonb_build_object('allowed',allowed,'retryAfter',greatest(1,retry));
end $$;
revoke all on function public.security_login_attempt(text,text) from public,anon,authenticated;
grant execute on function public.security_login_attempt(text,text) to service_role;
commit;
