import { auth } from "@/server/better-auth";

/** Signs in through Better Auth and returns request headers carrying the session cookie. */
export async function signedInHeaders(email: string, password: string): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({ body: { email, password }, headers: new Headers(), returnHeaders: true });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}
