import { FilePlus, Pencil, Wallet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { D } from "@/lib/money";
import { requireUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { customerStatement, getCustomer, type CustomerRow } from "@/server/services/customers";

const STATEMENT_LABELS = {
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  CREDIT_NOTE: "Credit note",
  REFUND: "Refund",
} as const;

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
  const statement = await customerStatement(customer.id);

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
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Account statement</h2>
            <p className="text-sm">
              {D(statement.closing).greaterThan(0)
                ? `Owes Rs ${formatMoney(statement.closing)}`
                : D(statement.closing).lessThan(0)
                  ? `Has Rs ${formatMoney(statement.closing.replace("-", ""))} credit`
                  : "Owes nothing"}
            </p>
          </div>
          {!customer.isWalkIn && (
            <Link href={`/payments/new?customerId=${customer.id}`} className={buttonVariants({ variant: "outline" })}>
              <Wallet /> Receive payment
            </Link>
          )}
        </div>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Document</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statement.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No invoices or payments yet.
                  </TableCell>
                </TableRow>
              )}
              {statement.rows.map((r) => (
                <TableRow key={`${r.type}-${r.refId}`}>
                  <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                  <TableCell>
                    {r.type === "INVOICE" ? (
                      <Link href={`/invoices/${r.refId}`} className="font-medium hover:underline">
                        {r.number}
                      </Link>
                    ) : r.type === "CREDIT_NOTE" ? (
                      <Link href={`/returns/${r.refId}`} className="font-medium hover:underline">
                        {r.number}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.number}</span>
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">{STATEMENT_LABELS[r.type]}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.debit === "0.00" ? "" : formatMoney(r.debit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.credit === "0.00" ? "" : formatMoney(r.credit)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(r.balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
