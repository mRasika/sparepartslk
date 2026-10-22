import { expect, test } from "@playwright/test";
import { colomboYear } from "../src/lib/dates";
import { login } from "./users";

const year = colomboYear();

test("part → GRN → credit invoice → print → low stock → payment → return", async ({ browser }) => {
  // Dev mode compiles each page on first visit, so the whole flow needs more than the default.
  test.setTimeout(300_000);
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, "admin");

  await test.step("admin creates a part with tier prices", async () => {
    await admin.goto("/parts/new");
    await admin.getByLabel("SKU").fill("BRK-001");
    await admin.getByLabel("Name", { exact: true }).fill("Brake Shoe Pulsar 150");
    await admin.getByLabel("Reorder level").fill("5");
    await admin.getByLabel("Retail price (Rs)").fill("1000");
    await admin.getByLabel("Dealer price (Rs)").fill("900");
    await admin.getByRole("button", { name: "Create part" }).click();
    await expect(admin.getByRole("heading", { name: "Brake Shoe Pulsar 150" })).toBeVisible();
  });

  await test.step("admin creates a Dealer customer with credit", async () => {
    await admin.goto("/customers/new");
    await admin.getByLabel("Name", { exact: true }).fill("Nimal Perera");
    await admin.getByLabel("Price tier").selectOption({ label: "Dealer" });
    await admin.getByLabel("Credit limit (Rs)").fill("50000");
    await admin.getByRole("button", { name: "Add customer" }).click();
    await expect(admin.getByRole("heading", { name: "Nimal Perera" })).toBeVisible();
  });

  await test.step("admin receives 10 @ 600 on a GRN", async () => {
    await admin.goto("/suppliers");
    await admin.getByRole("button", { name: "Add supplier" }).click();
    await admin.getByLabel("Name").fill("Lanka Moto Parts");
    await admin.getByRole("button", { name: "Save" }).click();
    await expect(admin.getByText("Lanka Moto Parts")).toBeVisible();

    await admin.goto("/grn/new");
    await admin.getByLabel("Supplier", { exact: true }).selectOption({ label: "Lanka Moto Parts" });
    await admin.getByLabel("Find a part").fill("BRK-001");
    await admin.getByRole("option", { name: /BRK-001/ }).click();
    await admin.getByLabel("Qty for BRK-001").fill("10");
    await admin.getByLabel("Unit cost (Rs) for BRK-001").fill("600");
    await admin.getByRole("button", { name: "Save GRN and add stock" }).click();
    await expect(admin.getByRole("heading", { name: `GRN-${year}-000001` })).toBeVisible();
  });

  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await login(staff, "staff");
  let invoiceUrl = "";

  await test.step("staff issues a credit invoice for 6 at the Dealer price", async () => {
    await staff.goto("/invoices/new");
    await staff.getByLabel("Customer").fill("Nimal");
    await staff.getByRole("option", { name: /Nimal Perera/ }).click();
    await staff.getByRole("radio", { name: "Credit" }).click();
    await staff.getByLabel("Find a part").fill("BRK-001");
    await staff.getByRole("option", { name: /BRK-001/ }).click();
    await staff.getByLabel("Qty for BRK-001").fill("6");
    await expect(staff.getByText("Rs 5,400.00")).toBeVisible();
    await staff.getByRole("button", { name: "Save invoice" }).click();
    await expect(staff.getByRole("heading", { name: new RegExp(`INV-${year}-000001`) })).toBeVisible();
    await expect(staff.getByText("Rs 5,400.00").first()).toBeVisible();
    invoiceUrl = staff.url();
  });

  const invoiceId = invoiceUrl.split("/").pop()!;

  await test.step("A4 and receipt print pages render", async () => {
    await staff.goto(`/print/invoice/${invoiceId}?format=a4`);
    await expect(staff.getByRole("heading", { name: "INVOICE", exact: true })).toBeVisible();
    await expect(staff.getByText("5,400.00").last()).toBeVisible();
    await staff.goto(`/print/invoice/${invoiceId}?format=thermal`);
    await expect(staff.getByText("TOTAL Rs")).toBeVisible();
  });

  await test.step("low stock lists BRK-001 at 4 of 5", async () => {
    await staff.goto("/low-stock");
    await expect(staff.getByRole("link", { name: "BRK-001" })).toBeVisible();
  });

  await test.step("a 3,000 cash payment leaves 2,400 owed", async () => {
    await staff.goto(invoiceUrl);
    await staff.getByRole("link", { name: "Receive payment" }).click();
    await staff.getByLabel("Amount (Rs)").fill("3000");
    await staff.getByRole("button", { name: "Save payment" }).click();
    await expect(staff.getByRole("heading", { name: "Nimal Perera" })).toBeVisible();
    await staff.goto(invoiceUrl);
    await expect(staff.getByText("Rs 2,400.00")).toBeVisible();
  });

  await test.step("returning 1 restocks to 5, still low", async () => {
    await staff.getByRole("link", { name: "Return items" }).click();
    await staff.getByLabel("Return qty for BRK-001").fill("1");
    await staff.getByLabel("Reason").fill("Ordered one too many");
    await staff.getByRole("button", { name: "Save return" }).click();
    await expect(staff.getByRole("heading", { name: `Credit note CRN-${year}-000001` })).toBeVisible();

    await staff.goto("/parts?q=BRK-001");
    await staff.getByRole("link", { name: "BRK-001" }).click();
    await expect(staff.getByText("5 pcs", { exact: true })).toBeVisible();
    await staff.goto("/low-stock");
    await expect(staff.getByRole("link", { name: "BRK-001" })).toBeVisible();
  });

  await adminCtx.close();
  await staffCtx.close();
});
