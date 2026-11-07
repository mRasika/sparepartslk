import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { E2E_USERS, login } from "./users";

const testDb = () => postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });

test.describe("sign in and out", () => {
  test("a signed-out visitor is sent to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("staff signs in, signs out, and is signed out", async ({ page }) => {
    await login(page, "staff");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a wrong password says so", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(E2E_USERS.staff.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  });

  test("an old Supabase cookie lands on /login without errors", async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addCookies([{ name: "sb-127-auth-token", value: "base64-eyJ4IjoxfQ", url: baseURL! }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a cookie for a deleted session lands on /login", async ({ page }) => {
    await login(page, "staff");
    const sql = testDb();
    try {
      await sql`delete from session`;
    } finally {
      await sql.end();
    }
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("Set password signs the login out in another browser", async ({ browser }) => {
    const staffContext = await browser.newContext();
    const adminContext = await browser.newContext();
    try {
      const staff = await staffContext.newPage();
      await login(staff, "staff");

      const admin = await adminContext.newPage();
      await login(admin, "admin");
      await admin.goto("/users");
      const row = admin.getByRole("row").filter({ hasText: E2E_USERS.staff.email });
      await row.getByRole("button", { name: "Set password" }).click();
      const dialog = admin.getByRole("dialog");
      // The same password, so the other specs can still sign in as staff.
      await dialog.getByLabel("New password").fill(E2E_USERS.staff.password);
      await dialog.getByRole("button", { name: "Set password" }).click();
      await expect(admin.getByText(`New password set for ${E2E_USERS.staff.fullName}`)).toBeVisible();

      await staff.goto("/invoices");
      await expect(staff).toHaveURL(/\/login$/);
    } finally {
      await staffContext.close();
      await adminContext.close();
    }
  });

  test("a turned-off login can't sign in", async ({ page, browser }) => {
    const email = `off-${Date.now()}@test.local`;
    const password = "turned-off-pass-1";
    await login(page, "admin");
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Turned Off");
    await dialog.getByLabel("Email", { exact: true }).fill(email);
    await dialog.getByLabel("Password", { exact: true }).fill(password);
    await dialog.getByRole("button", { name: "Add user" }).click();
    const row = page.getByRole("row").filter({ hasText: email });
    await row.getByRole("button", { name: "Turn off" }).click();
    await expect(row.getByText("Turned off")).toBeVisible();

    const other = await browser.newContext();
    try {
      const p = await other.newPage();
      await p.goto("/login");
      await p.getByLabel("Email").fill(email);
      await p.getByLabel("Password").fill(password);
      await p.getByRole("button", { name: "Sign in" }).click();
      await expect(p.getByText("This account is turned off. Ask the owner to turn it back on.")).toBeVisible();
    } finally {
      await other.close();
    }
  });
});
