-- Phase B: your own edits get their own tables, apart from the Sheet's synced ones, so a full sync never undoes them.
-- The app applies them when it loads: a note on a transaction beats a payee rule, and a payee rule beats the Sheet.

-- "Always use this category for <payee>". pattern is the payee as the app keys it: lower case, the part before " · ".
create table if not exists payee_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users,
  pattern     text not null check (length(pattern) between 1 and 200),
  category    text not null check (length(category) between 1 and 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, pattern)
);

-- One row per transaction you've edited: its category, "spent for someone else", "a friend paying me back", a note.
-- txn_ref is the transaction's source_ref (the id the app shows), or the id of a payment added in the app.
create table if not exists txn_notes (
  user_id          uuid not null default auth.uid() references auth.users,
  txn_ref          text not null check (length(txn_ref) between 1 and 120),
  category         text check (category is null or length(category) between 1 and 60),
  for_someone_else boolean not null default false,
  paid_back        boolean not null default false,
  note             text not null default '' check (length(note) <= 500),
  updated_at       timestamptz not null default now(),
  primary key (user_id, txn_ref)
);

drop trigger if exists payee_rules_touch on payee_rules;
create trigger payee_rules_touch before update on payee_rules for each row execute function touch_updated_at();
drop trigger if exists txn_notes_touch on txn_notes;
create trigger txn_notes_touch before update on txn_notes for each row execute function touch_updated_at();

alter table payee_rules enable row level security;
alter table txn_notes enable row level security;
drop policy if exists own_rows on payee_rules;
create policy own_rows on payee_rules for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_rows on txn_notes;
create policy own_rows on txn_notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Copy what the app kept inside its saved settings until now: payee rules (catRules) and "paid back" ticks
-- (overrides["paidback|<id>"]). Safe to run again: existing rows are left alone.
insert into payee_rules (user_id, pattern, category)
select s.user_id, r.key, r.value #>> '{}'
from settings s, jsonb_each(s.value -> 'data' -> 'catRules') r
where s.key = 'app.state' and jsonb_typeof(s.value -> 'data' -> 'catRules') = 'object' and length(r.key) between 1 and 200
on conflict (user_id, pattern) do nothing;

insert into txn_notes (user_id, txn_ref, paid_back)
select s.user_id, substring(o.key from 10), true
from settings s, jsonb_each(s.value -> 'data' -> 'overrides') o
where s.key = 'app.state' and jsonb_typeof(s.value -> 'data' -> 'overrides') = 'object'
  and o.key like 'paidback|%' and o.value = 'true'::jsonb
on conflict (user_id, txn_ref) do update set paid_back = true;
