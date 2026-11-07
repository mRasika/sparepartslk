-- Copies the existing logins from Supabase Auth into Better Auth's tables (migration 0012).
--
-- For every profile that has a Supabase login: a "user" row with the same id, and a "credential"
-- account holding the same bcrypt password hash, so people sign in with their current password.
--
-- It only READS auth.users; Supabase Auth is left exactly as it was (so a rollback still works).
-- Safe to run again: it updates rows already copied (run it once more just before the release, to
-- carry over any password changed in the meantime).
--
-- Check row at the end: profiles = users = accounts.

begin;

insert into "user" (id, email, name, email_verified, created_at, updated_at)
select p.user_id, lower(trim(p.email)), p.full_name, true, p.created_at, now()
from profiles p
join auth.users u on u.id = p.user_id
on conflict (id) do update
  set email = excluded.email, name = excluded.name, updated_at = now();

insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
select gen_random_uuid(), p.user_id::text, 'credential', p.user_id, u.encrypted_password, now(), now()
from profiles p
join auth.users u on u.id = p.user_id
where u.encrypted_password like '$2%'
on conflict (user_id, provider_id) do update
  set password = excluded.password, updated_at = now();

commit;

select
  (select count(*) from profiles) as profiles,
  (select count(*) from "user") as users,
  (select count(*) from account where provider_id = 'credential' and password like '$2%') as accounts;
