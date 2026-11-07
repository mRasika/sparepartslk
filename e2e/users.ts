import { expect, type Page } from "@playwright/test";

/** Test-only logins, created through createLogin by global-setup. */
export const E2E_USERS = {
  admin: { email: "admin@test.local", password: "e2e-admin-pass-1", fullName: "Test Admin", role: "admin" as const },
  staff: { email: "staff@test.local", password: "e2e-staff-pass-1", fullName: "Test Staff", role: "staff" as const },
  // Ticked "Can get emails"; only the password reset spec signs in with it (it changes the password).
  reset: { email: "reset@test.local", password: "e2e-reset-pass-1", fullName: "Test Reset", role: "staff" as const },
};

export const E2E_OUTBOX = ".e2e-outbox";

export async function login(page: Page, who: keyof typeof E2E_USERS) {
  const u = E2E_USERS[who];
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The dev server compiles the dashboard (and its chart library) on the first sign-in of a run.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
}
