-- Runs on the Neon standby at the start of every load (standby-load), in the SAME transaction as the
-- load itself. Sets up the standby's own bookkeeping (schema standby_meta, never part of a backup),
-- then refuses to go on when overwriting would lose data:
--   STANDBY_NOT_EMPTY      the address points at a database with app tables but no standby marker
--                          (e.g. a live database pasted by mistake)
--   STANDBY_OTHER_COMPANY  the standby belongs to another company (a settings file copied over)
--   STANDBY_USED           the standby has been written to since the last load (the shop worked on it)
-- psql variable: company (COMPANY_SLUG).

-- Before anything is created: is this a database that already holds app data without being a standby?
select set_config('standby.company', :'company', true);
do $$
begin
  if to_regclass('standby_meta.sync') is null
     and exists (select 1 from pg_tables where schemaname = 'public') then
    raise exception 'STANDBY_NOT_EMPTY';
  end if;
end;
$$;

create schema if not exists standby_meta;

-- One row: when the last load ran, from which app version and company; when the standby was first
-- and last written to after that load (empty = not used); when restore-from-standby last copied it.
create table if not exists standby_meta.sync (
  id int primary key default 1 check (id = 1),
  loaded_at timestamptz,
  source_version text,
  used_at timestamptz
);
alter table standby_meta.sync add column if not exists company text;
alter table standby_meta.sync add column if not exists last_write_at timestamptz;
alter table standby_meta.sync add column if not exists copied_at timestamptz;

-- Fired by the guard triggers (standby-after.sql) on every write of any kind to any app table: a
-- sale, an edit, even a sign-in (a session row). Keeps the first and the latest write time.
create or replace function standby_meta.mark_used() returns trigger
language plpgsql as $$
begin
  update standby_meta.sync set used_at = coalesce(used_at, now()), last_write_at = now() where id = 1;
  return null;
end;
$$;

-- The part search needs pg_trgm (backups hold only the app's own schemas, not extensions).
create extension if not exists pg_trgm;

-- The guard. "for update" holds the row until this load commits, so nobody can mark the standby
-- used in between.
do $$
declare
  s standby_meta.sync%rowtype;
begin
  select * into s from standby_meta.sync where id = 1 for update;
  if found and s.company is not null and s.company <> current_setting('standby.company') then
    raise exception 'STANDBY_OTHER_COMPANY %', s.company;
  end if;
  if found and s.used_at is not null then
    raise exception 'STANDBY_USED %', to_char(s.used_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI');
  end if;
end;
$$;
