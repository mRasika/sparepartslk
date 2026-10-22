-- Nightly stock reconciliation (spec §5.8).
-- Run once in the Supabase SQL editor after migrations (pg_cron must be enabled:
-- Database → Extensions → pg_cron). 20:30 UTC = 02:00 Asia/Colombo.
create extension if not exists pg_cron;

select cron.schedule('reconcile-stock', '30 20 * * *', $$select public.reconcile_stock()$$);

-- To check:   select * from cron.job;
-- To remove:  select cron.unschedule('reconcile-stock');
