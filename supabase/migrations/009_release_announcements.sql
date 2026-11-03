-- Server-only delivery ledger. This does not change personal-message notifications.
begin;
create table if not exists public.chat_release_deliveries (
  release_id text not null check(release_id ~ '^[a-f0-9]{64}$'),
  telegram_id bigint not null check(telegram_id>0),
  state text not null check(state in('sending','sent','failed','uncertain')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(release_id,telegram_id)
);
alter table public.chat_release_deliveries enable row level security;
revoke all on public.chat_release_deliveries from public,anon,authenticated;
grant all on public.chat_release_deliveries to service_role;
commit;
