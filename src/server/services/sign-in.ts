import { APIError } from "better-auth/api";
import { normaliseEmail } from "@/lib/reset-code";
import { loadActiveUser } from "@/server/auth";
import { endSessions } from "@/server/auth-admin";
import { auth } from "@/server/better-auth";
import { giveBack, HOUR, takeLimit } from "@/server/rate-limit";

export const LOGIN_TRIES_PER_EMAIL = 10;
export const LOGIN_TRIES_PER_DEVICE = 30;

const INCORRECT = "Email or password is incorrect";

export type SignInResult = { ok: true; headers: Headers } | { ok: false; error: string };

/**
 * Checks the password and starts a session (Better Auth sets the cookie). Each try is counted per
 * email and per device first, and a success hands both counts back, so only failed tries use up the
 * limit and tries arriving at the same moment are all counted.
 */
export async function signIn(input: { email: string; password: string; ip: string; headers: Headers }): Promise<SignInResult> {
  const email = normaliseEmail(input.email);
  const emailKey = `login-email/${email}`;
  const ipKey = `login-ip/${input.ip}`;
  const [emailOk, ipOk] = await Promise.all([
    takeLimit(emailKey, LOGIN_TRIES_PER_EMAIL, HOUR),
    takeLimit(ipKey, LOGIN_TRIES_PER_DEVICE, HOUR),
  ]);
  if (!emailOk || !ipOk) return { ok: false, error: "Too many tries. Wait a while and try again." };

  let result: { headers: Headers; response: { user: { id: string } } };
  try {
    result = await auth.api.signInEmail({
      body: { email, password: input.password },
      headers: input.headers,
      returnHeaders: true,
    });
  } catch (e) {
    // A wrong email or password is expected; anything else (database down, bad config) must reach the logs.
    if (!(e instanceof APIError && e.statusCode === 401)) console.error("Sign-in failed", e);
    return { ok: false, error: INCORRECT };
  }

  const user = await loadActiveUser(result.response.user.id);
  if (!user) {
    await endSessions(result.response.user.id);
    return { ok: false, error: "This account is turned off. Ask the owner to turn it back on." };
  }

  await Promise.all([giveBack(emailKey), giveBack(ipKey)]);
  return { ok: true, headers: result.headers };
}
