-- Runs on the Neon standby at the end of every load (standby-load), in the SAME transaction.
-- Puts a guard trigger on every app table (any write marks the standby as used), then records the
-- load. psql variable: app_version.

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop trigger if exists %I on public.%I', 'standby_used_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete or truncate on public.%I '
      'for each statement execute function standby_meta.mark_used()',
      'standby_used_' || t, t);
  end loop;
end;
$$;

insert into standby_meta.sync (id, loaded_at, source_version, used_at)
values (1, now(), :'app_version', null)
on conflict (id) do update
  set loaded_at = excluded.loaded_at, source_version = excluded.source_version, used_at = null;
