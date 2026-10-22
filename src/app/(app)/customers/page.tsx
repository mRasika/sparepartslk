import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { listCustomers } from "@/server/services/customers";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const { q = "" } = await searchParams;
  const rows = await listCustomers({ q });

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Price tier and credit terms decide what each customer pays and owes."
        actions={
          <Link href="/customers/new" className={buttonVariants()}>
            <Plus /> Add customer
          </Link>
        }
      />
      <form className="mb-4 flex gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Name, business or phone" aria-label="Search customers" className="w-full sm:w-72" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right">Credit limit (Rs)</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No customers match.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id} className={c.isActive ? "" : "text-muted-foreground"}>
                <TableCell>
                  <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.businessName && <div className="text-xs text-muted-foreground">{c.businessName}</div>}
                  {!c.isActive && (
                    <Badge variant="outline" className="mt-1">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">{c.phone}</TableCell>
                <TableCell>{c.tierName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.creditLimit === "0.00" ? <span className="text-muted-foreground">Cash only</span> : formatMoney(c.creditLimit)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {c.creditLimit === "0.00" ? "–" : c.creditDays}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
