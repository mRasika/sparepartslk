import { FilePlus, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { getCustomer, type CustomerRow } from "@/server/services/customers";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  let customer: CustomerRow;
  try {
    customer = await getCustomer(id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {customer.name}
            {!customer.isActive && <Badge variant="outline">Inactive</Badge>}
          </span>
        }
        description={customer.businessName ?? undefined}
        actions={
          <>
            <Link href={`/customers/${customer.id}/edit`} className={buttonVariants({ variant: "outline" })}>
              <Pencil /> Edit
            </Link>
            {customer.isActive && (
              <Link href={`/invoices/new?customerId=${customer.id}`} className={buttonVariants()}>
                <FilePlus /> New invoice
              </Link>
            )}
          </>
        }
      />
      <dl className="mb-8 grid grid-cols-2 gap-4 rounded-lg border bg-card p-5 sm:grid-cols-4">
        <Fact label="Phone">{customer.phone || "None"}</Fact>
        <Fact label="Price tier">{customer.tierName}</Fact>
        <Fact label="Credit limit">
          {customer.creditLimit === "0.00" ? "Cash only" : `Rs ${formatMoney(customer.creditLimit)}`}
        </Fact>
        <Fact label="Credit days">{customer.creditLimit === "0.00" ? "–" : customer.creditDays}</Fact>
        <Fact label="TIN">{customer.tin || "None"}</Fact>
        <div className="col-span-2 sm:col-span-3">
          <Fact label="Address">{customer.address || "None"}</Fact>
        </div>
      </dl>

      <section>
        <h2 className="mb-2 text-base font-semibold">Account statement</h2>
        {/* Filled in by Task 13 (payments and statements). */}
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          The balance and statement appear here once payments are set up.
        </p>
      </section>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums">{children}</dd>
    </div>
  );
}
