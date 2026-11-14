-- Phase 4b: phone notifications.

-- one row per alert sent, so each one goes out once
create table if not exists notifications_log (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users,
  key       text not null,                    -- e.g. 'bill-due-3|<statement id>', 'salary|<transaction id>'
  title     text not null,
  body      text not null,
  sent_at   timestamptz not null default now(),
  devices   int not null default 0,           -- how many devices accepted it
  unique (user_id, key)
);
alter table notifications_log enable row level security;
create policy own_rows on notifications_log for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- a device's subscription can go stale (app uninstalled, permission revoked); count failures and drop it at 3
alter table push_subscriptions add column if not exists failures int not null default 0;
