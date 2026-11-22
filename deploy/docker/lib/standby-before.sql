-- Runs on the Neon standby at the start of every load (standby-load), in the SAME transaction as the
-- load itself. Sets up the standby's own bookkeeping (schema standby_meta, never part of a backup),
-- then refuses to go on if the standby has been used since the last load.

create schema if not exists standby_meta;

-- One row: when the last load ran, which app version it came from, and when the standby was first
-- written to after that load (empty = not used).
create table if not exists standby_meta.sync (
  id int primary key default 1 check (id = 1),
  loaded_at timestamptz,
  source_version text,
  used_at timestamptz
);

-- Fired by the guard triggers (standby-after.sql) on the first write of any kind to any app table:
-- a sale, an edit, even a sign-in (a session row).
create or replace function standby_meta.mark_used() returns trigger
language plpgsql as $$
begin
  update standby_meta.sync set used_at = now() where id = 1 and used_at is null;
  return null;
end;
$$;

-- The part search needs pg_trgm (backups hold only the app's own schemas, not extensions).
create extension if not exists pg_trgm;

-- The guard. "for update" holds the row until this load commits, so nobody can mark the standby
-- used in between.
do $$
declare
  used timestamptz;
begin
  select s.used_at into used from standby_meta.sync s where s.id = 1 for update;
  if used is not null then
    raise exception 'STANDBY_USED %', to_char(used at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI');
  end if;
end;
$$;
