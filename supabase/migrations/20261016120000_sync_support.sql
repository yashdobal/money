-- Phase 1: support for the hourly Sheet sync.

-- the collector's hourly sync is logged as kind 'sync'
alter table ingest_log drop constraint ingest_log_kind_check;
alter table ingest_log add constraint ingest_log_kind_check check (kind in ('alert','heartbeat','import','sync'));

-- Soft-delete what the Sheet no longer has. Takes arrays in the body, so a long Sheet never hits URL limits.
-- Only the ingest function (service role) may call it.
create or replace function sync_retire(p_user uuid, p_tx text[], p_emails text[], p_payments uuid[], p_rules uuid[], p_goals uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_tx int; n_em int; n_pay int; n_rule int; n_goal int;
begin
  update transactions set deleted_at = now()
   where user_id = p_user and deleted_at is null and source in ('email','manual') and not (source_ref = any(p_tx));
  get diagnostics n_tx = row_count;
  update card_emails set deleted_at = now()
   where user_id = p_user and deleted_at is null and not (message_id = any(p_emails));
  get diagnostics n_em = row_count;
  update card_payments set deleted_at = now()
   where user_id = p_user and deleted_at is null and matched_by = 'manual' and not (id = any(p_payments));
  get diagnostics n_pay = row_count;
  update rules set deleted_at = now() where user_id = p_user and deleted_at is null and not (id = any(p_rules));
  get diagnostics n_rule = row_count;
  update goals set deleted_at = now() where user_id = p_user and deleted_at is null and not (id = any(p_goals));
  get diagnostics n_goal = row_count;
  return jsonb_build_object('transactions', n_tx, 'card_emails', n_em, 'card_payments', n_pay, 'rules', n_rule, 'goals', n_goal);
end $$;
revoke all on function sync_retire(uuid, text[], text[], uuid[], uuid[], uuid[]) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function sync_retire(uuid, text[], text[], uuid[], uuid[], uuid[]) from anon, authenticated';
    execute 'grant execute on function sync_retire(uuid, text[], text[], uuid[], uuid[], uuid[]) to service_role';
  end if;
end $$;

-- A quick health line for the status page: last sync and row counts, for the signed-in user only.
create or replace view sync_status with (security_invoker = true) as
select
  (select max(received_at) from ingest_log where kind = 'sync' and result = 'saved') as last_sync,
  (select result from ingest_log where kind = 'sync' order by received_at desc limit 1) as last_result,
  (select count(*) from transactions where deleted_at is null) as transactions,
  (select count(*) from card_statements where deleted_at is null) as bills,
  (select count(*) from transactions where deleted_at is null and status = 'scheduled') as scheduled;
