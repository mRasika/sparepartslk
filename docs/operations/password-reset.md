# Password reset

**Status (2026-11-07):** built and tested. Email is **not switched on yet**, so "Forgot password?" stays hidden until the steps in "Switching email on" are done. The admin's **Set password** button works now.

## What it does

There are two ways to get back into a login when the password is forgotten:

1. **Admin sets a new password.** On **Users**, click **Set password** next to the person, type a new password and give it to them. This works for every login, with or without email.
2. **The person resets it by email.** On the sign-in page they click **Forgot password?**, get a 6-digit code by email and choose a new password. This only works for logins where the admin ticked **Can get emails**.

Either way, that login is **signed out on every device** (phones, other PCs), and the person signs in again with the new password.

## How a person resets their password by email

1. On the sign-in page, click **Forgot password?**
2. Type the email you sign in with and click **Send code**.
3. Open the email "Your Sparepartslk password code" and read the 6-digit code. It works for 15 minutes.
4. Back on the page, type the code, then the new password twice, and click **Save new password**.
5. You're back on the sign-in page with "Password changed". Sign in with the new password.

**No email?** Look in junk mail and wait a minute. Then click **Send a new code**. If still nothing comes, ask the admin to set a new password on the Users page.

After the change, the person also gets an email "Your Sparepartslk password was changed". If they didn't do it, they must tell the admin at once.

## For the admin: the "Can get emails" tick

On **Users**, each person has a **Can get emails** tick (also in **Add user**). It's off for new logins.

- **Tick it** only when the email is read by **that person alone**, for example their own Gmail with a good password.
- **Leave it off** for a shared or shop email that other people can read. Anyone who reads that inbox could reset the password and use the login.
- Tick it for the **owner/admins first**. They are the ones who would otherwise be locked out with no one to help.
- Turning the tick off also cancels any code that was already sent.

## The rules it follows

| Rule | Why |
|---|---|
| The page always says "If this email can get codes, we sent a 6-digit code", even for unknown emails | No one can use it to find out who has a login |
| The code only goes to the email already on the login | No one can redirect it to their own inbox |
| A code works for **15 minutes**, **once**, with **5 tries** | Guessing a 6-digit code is hopeless in 5 tries |
| Asking for a new code cancels the old one | Only one live code per login |
| At most **3 codes an hour and 10 a day** per email, **10 requests and 10 tries an hour** per device | Stops email flooding and slow guessing |
| Every wrong, old or used code gets the same message: "The code is wrong or too old. Ask for a new code." | Gives nothing away |
| The account is **never locked** by wrong codes; only the code is thrown away | A stranger can't lock someone out |
| The database keeps only a scrambled copy (HMAC) of the code | A database leak doesn't hand out working codes |
| After the change, every device is signed out and a "password changed" email is sent | A stolen phone or old password stops working |

## Switching email on

Email goes through **Resend** (free for about 100 emails a day). Do this once, with the shop's own domain (for example `sparepartslk.lk`):

1. Create a Resend account **in the business's name** at resend.com.
2. **Domains → Add domain**, and type the shop's domain. Resend shows some DNS records (TXT for SPF and DKIM, an MX, and maybe DMARC).
3. Add those records at the domain provider, copying the values exactly. Wait until Resend shows **Verified**. This can take from minutes to a day.
4. **API Keys → Create**, with **Sending access** only. Copy the key.
5. In Vercel (project settings → Environment Variables), add these for **Production** and **Preview**:
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM` = `Sparepartslk <noreply@your-domain>` (the sender must be on the verified domain)
6. Redeploy. "Forgot password?" now appears on the sign-in page.
7. Test it with the admin's own login (tick **Can get emails** for it first): sign out, then **Forgot password?**. The code must land in the **inbox**, not junk.

Until both variables are set, no email is ever sent and the sign-in page says "Forgot your password? Ask the admin to reset it."

## For developers

- **Code:** `src/server/services/password-reset.ts` (steps 1 and 2), `src/lib/reset-code.ts` (code rules), `src/server/rate-limit.ts` (shared counters), `src/server/email.ts` (Resend sender), and `src/app/(auth)/forgot-password/`. Admin side: `setUserPassword` and `setCanGetEmails` in `src/server/services/users.ts`.
- **Tables** (migration `0011_password_reset`): `password_reset_codes` (one row per email), `rate_limits`, and `profiles.can_get_emails` and `profiles.signed_out_at`. RLS is on with no policies, like every other table.
- **Signing out every device:** a password change sets `profiles.signed_out_at`. `getSessionUser` turns away any session whose sign-in time is earlier. The sign-in time comes from the token's `amr` timestamp, which Supabase keeps when it refreshes a token. Supabase's refresh tokens for the old sessions still exist, but every session they make is refused.
- **Supabase's own reset** (`resetPasswordForEmail`) isn't used. It can't check the tick, its limits are per project, and it doesn't sign other devices out.
- **Local and test email:** set `EMAIL_OUTBOX_DIR=some-folder` and emails are written there as JSON files instead of sent. This setting is ignored on Vercel Production. The e2e server uses `.e2e-outbox`.
- **The code's secret** is derived from `SUPABASE_SERVICE_ROLE_KEY`. Rotating that key only cancels codes that are live at that moment.
