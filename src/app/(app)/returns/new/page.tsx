import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { getInvoice, listInvoices } from "@/server/services/invoicing";
import { returnableItems } from "@/server/services/returns";
import { ReturnForm } from "./return-form";

type SearchParams = Promise<{ invoiceId?: string; q?: string }>;

export default async function NewReturnPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const { invoiceId, q = "" } = await searchParams;

  if (!invoiceId) {
    const matches = q ? await listInvoices({ q, status: "issued", limit: 20 }) : [];
    return (
      <div className="max-w-3xl">
        <PageHeader title="Return items" description="Returns are made against the original invoice." />
        <form className="mb-4 flex gap-2" role="search">
          <Input name="q" defaultValue={q} placeholder="Invoice no or customer" aria-label="Find the invoice" autoFocus className="w-full sm:w-72" />
          <Button type="submit" variant="secondary">
            Find invoice
          </Button>
        </form>
        {q && matches.length === 0 && <p className="text-sm text-muted-foreground">No issued invoice matches.</p>}
        <ul className="divide-y rounded-lg border bg-card empty:hidden">
          {matches.map((m) => (
            <li key={m.id}>
              <Link href={`/returns/new?invoiceId=${m.id}`} className="flex justify-between px-4 py-3 text-sm hover:bg-muted">
                <span className="font-medium">{m.number}</span>
                <span>
                  {m.customerName}, {formatDate(m.invoiceDate)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const [invoice, items] = await Promise.all([getInvoice(user, invoiceId), returnableItems(invoiceId)]);
  if (invoice.status !== "issued") {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Return items" />
        <p role="alert" className="rounded-lg border bg-card p-6 text-sm">
          {invoice.number} is cancelled, so nothing can be returned against it.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`Return items from ${invoice.number}`}
        description={`${invoice.customer.name}, invoiced ${formatDate(invoice.invoiceDate)}`}
      />
      <ReturnForm
        invoiceId={invoice.id}
        items={items}
        isWalkIn={invoice.customer.isWalkIn}
        invoiceSubtotal={invoice.subtotal}
        invoiceTotal={invoice.total}
      />
    </div>
  );
}
