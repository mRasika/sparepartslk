import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { listGrns, listSuppliers } from "@/server/services/grn";

type SearchParams = Promise<{ q?: string; supplier?: string }>;

export default async function GrnListPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const { q = "", supplier = "" } = await searchParams;
  const [rows, suppliers] = await Promise.all([
    listGrns({ q, supplierId: supplier || undefined }),
    listSuppliers(),
  ]);

  return (
    <div>
      <PageHeader
        title="Goods received"
        description="Each GRN adds stock from a supplier delivery."
        actions={
          <Link href="/grn/new" className={buttonVariants()}>
            <Plus /> Receive goods
          </Link>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="GRN or supplier invoice no" aria-label="Search GRNs" className="w-full sm:w-64" />
        <NativeSelect name="supplier" defaultValue={supplier} aria-label="Supplier">
          <NativeSelectOption value="">All suppliers</NativeSelectOption>
          {suppliers.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {s.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>GRN</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="hidden md:table-cell">Supplier invoice</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total (Rs)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {q || supplier ? "No GRNs match." : "No goods received yet. Record a delivery with Receive goods."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">
                  <Link href={`/grn/${g.id}`} className="hover:underline">
                    {g.number}
                  </Link>
                </TableCell>
                <TableCell>{formatDate(g.receivedDate)}</TableCell>
                <TableCell>{g.supplierName}</TableCell>
                <TableCell className="hidden md:table-cell">{g.supplierInvoiceNo}</TableCell>
                <TableCell className="text-right tabular-nums">{g.itemCount}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(g.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
