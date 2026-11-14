-- Money app · table design v0.1 (Phase 0, for approval) · 16 Oct 2026
-- Postgres on Supabase. Every table: user_id + row-level security, amounts in paise (bigint),
-- soft delete via deleted_at, created_at/updated_at maintained by trigger.
-- Nothing here is live yet: this file is the design to approve before Phase 1.

create extension if not exists pgcrypto;

-- ---------- shared helpers ----------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- =====================================================================
-- MONEY
-- =====================================================================

-- A card group shares one limit and one bill (a Visa and a RuPay card on one account, say).
create table card_groups (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users,
  name            text not null,                       -- 'Lotus Orbit'
  issuer          text not null,                       -- 'ICICI'
  statement_day   smallint check (statement_day between 1 and 31),
  due_days_after  smallint,                            -- due date = statement date + n
  credit_limit    bigint,                              -- paise, optional
  closed_on       date,                                -- the day you closed it
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

-- A bank account, card or wallet. Sheet: the Account column ("Lotus Credit Card XX2222").
create table accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users,
  kind            text not null check (kind in ('bank','card','wallet')),
  issuer          text not null,                       -- 'Axis', 'ICICI', 'SBI'
  name            text not null,                       -- 'Axis Bank Savings', 'Amazon Pay ICICI'
  last4           char(4),                             -- never the full number
  card_group_id   uuid references card_groups,         -- cards only
  is_addon        boolean not null default false,      -- an add-on card
  aliases         text[] not null default '{}',        -- labels: 'Lotus Credit Card XX3333', 'shopper'
  opened_on date, closed_on date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create unique index accounts_last4 on accounts (user_id, kind, last4) where deleted_at is null;

-- Category names in one place, so renames are one edit. Sheet: Category column.
create table categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users,
  name       text not null,                            -- 'Food & dining'
  counted_by_default boolean not null default true,    -- 'Investments', 'Money in' → false
  sort       smallint not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (user_id, name)
);

-- One debit or credit. Sheet: Transactions tab.
create table transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users,
  account_id    uuid not null references accounts,
  occurred_at   timestamptz not null,                  -- Sheet: Date (IST); Day/Month are derived, not stored
  amount        bigint not null check (amount > 0),    -- paise. Sheet: Amount "1,354.05" → 135405
  direction     text not null check (direction in ('in','out')),
  description   text not null,                         -- cleaned merchant/payee
  category_id   uuid references categories,
  counted       boolean not null,                      -- Sheet: Counted as spending
  status        text not null default 'posted' check (status in ('posted','scheduled','reversed')),
  source        text not null check (source in ('email','manual','import','claude')),
  source_ref    text not null,                         -- Gmail message id, or 'manual-20261012-flipkart-emi-1'
  snippet       text check (length(snippet) <= 240),   -- trimmed raw line; never whole emails
  emi_instalment_id  uuid,                             -- set when this row is an EMI instalment
  planned_payment_id uuid,                             -- set when this debit pays a planned item
  note          text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (user_id, source_ref)                         -- resend-safe: one row per email
);
create index transactions_by_time on transactions (user_id, occurred_at desc) where deleted_at is null;

-- Every statement/payment email kept as evidence (ICICI and CRED both send one). Sheet: Card events tab.
create table card_emails (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users,
  message_id     text not null,                        -- Sheet: Message ID
  received_at    timestamptz not null,                 -- Sheet: Email date
  account_id     uuid not null references accounts,    -- Sheet: Card (last 4)
  kind           text not null check (kind in ('statement','payment')),
  sender         text not null,                        -- Sheet: Source ('ICICI','CRED')
  amount         bigint not null,                      -- paise
  minimum_due    bigint,
  due_date       date,
  statement_date date,                                 -- CRED's is often a day off ICICI's
  statement_id   uuid,                                 -- the bill it was folded into
  payment_id     uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (user_id, message_id)
);

-- One bill per card group per cycle (two emails → one row).
create table card_statements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users,
  card_group_id  uuid references card_groups,
  account_id     uuid references accounts,             -- for cards without a group
  statement_date date not null,
  due_date       date not null,
  billed         bigint not null,                      -- paise; the email total beats summed alerts
  minimum_due    bigint,
  billed_override bigint,                              -- Sheet: overrides "orbit|2026-09-30"
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  check (card_group_id is not null or account_id is not null)
);
create unique index card_statements_cycle on card_statements (user_id, coalesce(card_group_id, account_id), statement_date) where deleted_at is null;

-- A payment towards a card bill. Sheet: App data "payments" + payment rows in Card events.
create table card_payments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users,
  account_id     uuid not null references accounts,
  statement_id   uuid references card_statements,
  paid_on        date not null,
  amount         bigint not null check (amount > 0),
  bank_txn_id    uuid references transactions,         -- the Axis/CRED debit it matched
  matched_by     text check (matched_by in ('email','issuer','amount','only_open_bill','manual')),
  source_ref     text,                                 -- old id 'p1791463305112' or the email id
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

-- A purchase converted to EMIs, or an EMI on someone else's card.
create table emi_plans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users,
  name           text not null,                        -- 'Phone 9,450', 'Washing machine'
  account_id     uuid references accounts,             -- null = paid on someone else's card
  principal      bigint not null,
  months         smallint not null,
  processing_fee bigint not null default 0,            -- incl. GST
  paid_from      text not null default 'savings' check (paid_from in ('pay','savings')),
  goal_id        uuid,                                 -- the goal it pays for
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table emi_instalments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users,
  plan_id        uuid not null references emi_plans,
  n              smallint not null,
  due_on         date not null,
  principal      bigint not null,
  interest       bigint not null default 0,
  gst            bigint not null default 0,
  transaction_id uuid references transactions,         -- the row that paid it
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (plan_id, n)
);

-- Money you plan to send out. Dashboard code: PLANNED list; Sheet: Plan tab fixed rows.
create table planned_payments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users,
  name           text not null,                        -- 'Money to family'
  amount         bigint not null,
  first_due      date not null,
  repeat         text not null default 'once' check (repeat in ('once','monthly')),
  ends_on        date,
  paid_from      text not null check (paid_from in ('pay','savings')),
  match_pattern  text,                                 -- how to spot the bank debit
  tolerance_pct  numeric(4,2) not null default 2,      -- today: 2% or ₹50
  tolerance_min  bigint not null default 5000,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
-- Which debit settled which occurrence of a planned payment.
create table planned_payment_matches (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users,
  planned_payment_id uuid not null references planned_payments,
  due_on             date not null,
  transaction_id     uuid not null references transactions,
  created_at timestamptz not null default now(),
  unique (planned_payment_id, due_on)
);

-- One pay cycle and your planner choices for it. Sheet: overrides "plan|2026-10-30".
create table salary_cycles (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users,
  payday         date not null,
  expected       bigint not null,                      -- from the offer letter maths
  credited       bigint,
  credited_txn_id uuid references transactions,
  plan_salary    bigint,                               -- slider values; null = use the rule
  plan_family    bigint,
  plan_sip       bigint,
  plan_ef        bigint,
  plan_set_at    timestamptz,                          -- today's salAt rule
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (user_id, payday)
);

-- Payee rules. Sheet: App data "catRules".
create table rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users,
  pattern     text not null,                           -- 'motilal oswal'
  match_kind  text not null default 'contains' check (match_kind in ('contains','exact','regex')),
  category_id uuid references categories,
  counted     boolean,                                 -- null = leave as the category says
  priority    smallint not null default 100,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

-- Sheet: App data "goals" and "contribs".
create table goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users,
  name       text not null,
  target     bigint not null,
  start_amount bigint not null default 0,
  target_date date,
  priority   smallint,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table goal_contributions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users,
  goal_id    uuid not null references goals,
  amount     bigint not null,
  on_date    date not null,
  source     text,                                     -- 'sip share', 'manual', 'emi'
  transaction_id uuid references transactions,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

-- Sheet: App data key/json rows (ob, payDay, buffer, joined, inc) and the offer-letter numbers.
create table settings (
  user_id    uuid not null default auth.uid() references auth.users,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- One call from the collector. Sheet: Run log tab.
create table ingest_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users,
  received_at timestamptz not null default now(),
  kind        text not null check (kind in ('alert','heartbeat','import')),
  result      text not null check (result in ('saved','duplicate','ignored','failed')),
  message_id  text,
  took_ms     integer,
  detail      text
);

-- =====================================================================
-- SHARED (used by future areas; money writes to them too)
-- =====================================================================
create table events (                                  -- one feed for the Today screen
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users,
  module      text not null,                           -- 'money', 'travel', 'health', 'learning', 'tasks'
  kind        text not null,                           -- 'salary_credited', 'bill_paid', 'habit_done'
  occurred_at timestamptz not null,
  title       text not null,
  ref_table   text, ref_id uuid,
  created_at timestamptz not null default now()
);
create table reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users,
  module      text not null,
  title       text not null,
  due_at      timestamptz not null,
  repeat      text,                                    -- null, 'daily', 'weekly', 'monthly'
  ref_table   text, ref_id uuid,
  sent_at     timestamptz, done_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  name text not null, unique (user_id, name)
);
create table taggings (
  user_id uuid not null default auth.uid() references auth.users,
  tag_id uuid not null references tags, ref_table text not null, ref_id uuid not null,
  primary key (tag_id, ref_table, ref_id)
);
create table attachments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users,
  ref_table   text not null, ref_id uuid not null,
  storage_path text not null, mime text, bytes integer,
  created_at timestamptz not null default now(), deleted_at timestamptz
);
create table push_subscriptions (                      -- one per installed device
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users,
  endpoint    text not null unique, p256dh text not null, auth text not null,
  device_name text, created_at timestamptz not null default now(), last_ok_at timestamptz
);

-- =====================================================================
-- Late foreign keys, triggers, row-level security
-- =====================================================================
alter table transactions add foreign key (emi_instalment_id) references emi_instalments;
alter table transactions add foreign key (planned_payment_id) references planned_payments;
alter table card_emails  add foreign key (statement_id) references card_statements;
alter table card_emails  add foreign key (payment_id) references card_payments;
alter table emi_plans    add foreign key (goal_id) references goals;

do $$
declare t text;
begin
  foreach t in array array['card_groups','accounts','categories','transactions','card_emails','card_statements',
    'card_payments','emi_plans','emi_instalments','planned_payments','salary_cycles','rules','goals',
    'goal_contributions','reminders']
  loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
  foreach t in array array['card_groups','accounts','categories','transactions','card_emails','card_statements',
    'card_payments','emi_plans','emi_instalments','planned_payments','planned_payment_matches','salary_cycles',
    'rules','goals','goal_contributions','settings','ingest_log','events','reminders','tags','taggings',
    'attachments','push_subscriptions']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy own_rows on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- What "counts" today: posted rows plus scheduled rows whose date has arrived; deleted rows never.
create view live_transactions with (security_invoker = true) as
  select * from transactions
  where deleted_at is null and status <> 'reversed'
    and (status = 'posted' or occurred_at <= now());
