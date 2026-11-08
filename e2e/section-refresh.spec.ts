import { expect, type Locator, type Page, test } from "@playwright/test";
import { login } from "./users";

// A search or filter must reload only the part of the page it changes: no full browser reload, and
// what it doesn't change stays on screen as the same elements. Runs after full-flow (name order).

/** Tags the page and some elements, so a full reload or a re-mount drops the tag. */
async function tag(page: Page, ...keep: Locator[]) {
  await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
  for (const l of keep) await l.evaluate((el) => el.setAttribute("data-kept", "1"));
}

async function expectNoFullReload(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
}

const kept = (l: Locator) => expect(l).toHaveAttribute("data-kept", "1");
const notKept = (l: Locator) => expect(l).not.toHaveAttribute("data-kept", "1");

test("dashboard: a top-sellers tab reloads only the table; a new period reloads the figures", async ({ page }) => {
  await login(page, "admin");
  const netSales = page.getByRole("term").filter({ hasText: /^Net sales$/ });
  const heading = page.getByRole("heading", { name: "Sales & profit" });
  const table = page.getByRole("navigation", { name: "Top sellers by" });
  await tag(page, netSales, heading, table);

  await page.getByRole("link", { name: "Brands" }).click();
  await expect(page).toHaveURL(/top=brands/);
  await expect(page.getByRole("link", { name: "Brands" })).toHaveAttribute("aria-current", "page");
  await expectNoFullReload(page);
  await kept(netSales);
  await kept(heading);

  await page.getByRole("button", { name: /^Period:/ }).click();
  await page.getByRole("link", { name: /Last month/ }).click();
  await expect(page).toHaveURL(/period=last-month/);
  await expect(page).toHaveURL(/top=brands/);
  await expectNoFullReload(page);
  await kept(heading);
  await notKept(page.getByRole("term").filter({ hasText: /^Net sales$/ }));
});

const searches = [
  { path: "/invoices", label: "Search invoices", text: "INV", button: "Search", clear: true },
  { path: "/quotations", label: "Search quotations", text: "QUO", button: "Search", clear: true },
  { path: "/parts", label: "Search parts", text: "BRK", button: "Search", clear: true },
  { path: "/customers", label: "Search customers", text: "Nimal", button: "Search", clear: false },
  { path: "/grn", label: "Search GRNs", text: "GRN", button: "Search", clear: false },
  { path: "/payments", label: "Search payments", text: "PAY", button: "Search", clear: false },
  { path: "/stock", label: "Search stock", text: "BRK", button: "Show", clear: false },
  { path: "/returns/new", label: "Find the invoice", text: "INV", button: "Find invoice", clear: false },
];

for (const s of searches) {
  test(`${s.path}: searching stays in the app and keeps the header and form`, async ({ page }) => {
    await login(page, "admin");
    await page.goto(s.path);
    const h1 = page.getByRole("heading", { level: 1 });
    await tag(page, h1);

    await page.getByLabel(s.label, { exact: true }).fill(s.text);
    await page.getByRole("button", { name: s.button, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`q=${s.text}`));
    await expect(page.getByRole("status")).toHaveCount(0); // the list has loaded
    await expectNoFullReload(page);
    await kept(h1);
    await expect(page.getByLabel(s.label, { exact: true })).toHaveValue(s.text);

    if (s.clear) {
      await page.getByRole("link", { name: "Clear" }).click();
      await expect(page).not.toHaveURL(/q=/);
      await expect(page.getByLabel(s.label, { exact: true })).toHaveValue(""); // the box empties too
      await expectNoFullReload(page);
    }
  });
}

test("returns: the date filter stays in the app and Clear empties the dates", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/returns");
  await tag(page, page.getByRole("heading", { level: 1 }));
  await page.getByLabel("From date").fill("2026-01-01");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/from=2026-01-01/);
  await expectNoFullReload(page);
  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page).not.toHaveURL(/from=/);
  await expect(page.getByLabel("From date")).toHaveValue("");
  await expectNoFullReload(page);
});

test("stock: an age filter reloads only the list, not the health summary", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/stock");
  const summary = page.getByRole("heading", { name: "How long since it sold" });
  await expect(summary).toBeVisible();
  await tag(page, summary);
  await page.getByRole("link", { name: /0–90 days/ }).first().click();
  await expect(page).toHaveURL(/age=0-90/);
  await expect(page.getByText(/Showing 0–90 days/)).toBeVisible();
  await expectNoFullReload(page);
  await kept(summary);
});

test("payments: an aging group reloads only the unpaid list, not the summary", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/payments?view=outstanding");
  const howLate = page.getByRole("heading", { name: "How late" });
  await expect(howLate).toBeVisible();
  await tag(page, howLate);
  await page.getByRole("link", { name: /^Not due/ }).click();
  await expect(page).toHaveURL(/late=not-due/);
  await expect(page.getByText(/Showing Not due/)).toBeVisible();
  await expectNoFullReload(page);
  await kept(howLate);
});
