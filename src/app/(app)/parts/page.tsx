import { Percent, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { requireUser } from "@/server/auth";
import { cachedBrands, cachedCategories, cachedVehicleModels } from "@/server/cached";
import { searchParts } from "@/server/services/catalog";

type SearchParams = Promise<{ q?: string; category?: string; brand?: string; vehicle?: string }>;

export default async function PartsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const { q = "", category = "", brand = "", vehicle = "" } = await searchParams;
  const [rows, categories, brands, vehicles] = await Promise.all([
    searchParts(q, {
      categoryId: category || undefined,
      brandId: brand || undefined,
      vehicleModelId: vehicle || undefined,
      limit: 200,
    }),
    cachedCategories(),
    cachedBrands(),
    cachedVehicleModels(),
  ]);
  const filtered = Boolean(q || category || brand || vehicle);

  return (
    <div>
      <PageHeader
        title="Parts"
        description="Search by SKU, OEM number, barcode or name."
        actions={
          user.role === "admin" && (
            <>
              <Link href="/parts/settings" className={buttonVariants({ variant: "outline" })}>
                <SlidersHorizontal /> Categories, brands, models
              </Link>
              <Link href="/parts/prices" className={buttonVariants({ variant: "outline" })}>
                <Percent /> Change prices
              </Link>
              <Link href="/parts/new" className={buttonVariants()}>
                <Plus /> New part
              </Link>
            </>
          )
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="SKU, OEM no, barcode or name"
          aria-label="Search parts"
          className="w-full sm:w-72"
          autoFocus
        />
        <NativeSelect name="category" defaultValue={category} aria-label="Category">
          <NativeSelectOption value="">All categories</NativeSelectOption>
          {categories.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>
              {c.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="brand" defaultValue={brand} aria-label="Brand">
          <NativeSelectOption value="">All brands</NativeSelectOption>
          {brands.map((b) => (
            <NativeSelectOption key={b.id} value={b.id}>
              {b.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="vehicle" defaultValue={vehicle} aria-label="Bike model">
          <NativeSelectOption value="">All bike models</NativeSelectOption>
          {vehicles.map((v) => (
            <NativeSelectOption key={v.id} value={v.id}>
              {v.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {filtered && (
          <Link href="/parts" className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        )}
      </form>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">OEM no</TableHead>
              <TableHead className="hidden lg:table-cell">Brand</TableHead>
              <TableHead className="hidden lg:table-cell">Bin</TableHead>
              <TableHead className="text-right">On hand</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {filtered
                    ? "No parts match. Try fewer words or another filter."
                    : user.role === "admin"
                      ? "No parts yet. Add the first one with New part."
                      : "No parts yet."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => {
              const low = p.reorderLevel > 0 && p.qtyOnHand <= p.reorderLevel;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <Link href={`/parts/${p.id}`} className="hover:underline">
                      {p.sku}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/parts/${p.id}`} className="hover:underline">
                      {p.name}
                    </Link>
                    {!p.isActive && (
                      <Badge variant="outline" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{p.oemPartNo}</TableCell>
                  <TableCell className="hidden lg:table-cell">{p.brandName}</TableCell>
                  <TableCell className="hidden lg:table-cell">{p.binLocation}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={low ? "rounded bg-warning/25 px-1.5 py-0.5 font-medium" : ""}>
                      {p.qtyOnHand}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {rows.length === 200 && (
        <p className="mt-2 text-sm text-muted-foreground">Showing the first 200. Narrow the search to see more.</p>
      )}
    </div>
  );
}
