-- Phase 4b: run the notify function every hour at :05 (pg_cron runs in UTC; quiet hours are handled in the function).
-- The cron secret is set when this is applied (it is not committed): replace __CRON_SECRET__.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'money-notify';
select cron.schedule('money-notify', '5 * * * *', $job$
  select net.http_post(
    url := 'https://ftnxpufopkosqrtjtkhi.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '__CRON_SECRET__'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
