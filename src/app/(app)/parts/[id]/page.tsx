import { Pencil } from "lucide-react";
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
import { formatDateTime, formatMoney } from "@/lib/format";
import { describeRule, rulePrice } from "@/lib/tier-rule";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth";
import { cachedPriceTiers } from "@/server/cached";
import { NotFound } from "@/server/errors";
import { getPart, type PartDetail } from "@/server/services/catalog";

const MOVEMENT_LABELS: Record<PartDetail["movements"][number]["type"], string> = {
  GRN: "Received",
  SALE: "Sold",
  SALE_CANCEL: "Sale cancelled",
  RETURN: "Returned",
  ADJUST: "Adjusted",
};

export default async function PartPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let part: PartDetail;
  try {
    part = await getPart(user, id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const low = part.reorderLevel > 0 && part.qtyOnHand <= part.reorderLevel;

  // Every tier's price: typed on the part, else the tier's rule on the default price.
  const tiers = await cachedPriceTiers();
  const defaultTier = tiers.find((t) => t.isDefault);
  const basePrice = part.prices.find((p) => p.tierId === defaultTier?.id)?.price;
  const tierPrices = tiers.flatMap((t) => {
    const typed = part.prices.find((p) => p.tierId === t.id)?.price;
    const price = typed ?? (basePrice && !t.isDefault ? rulePrice(basePrice, t.discountPct, t.roundTo) : undefined);
    if (!price) return [];
    const rule = typed ? undefined : describeRule(defaultTier!.name, t.discountPct, t.roundTo);
    const belowCost = part.avgCost !== undefined && Number(part.avgCost) > 0 && Number(price) < Number(part.avgCost);
    return [{ tierId: t.id, tierName: t.name, price, rule, belowCost }];
  });

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {part.name}
            {!part.isActive && <Badge variant="outline">Inactive</Badge>}
          </span>
        }
        description={`${part.sku}${part.oemPartNo ? `, OEM ${part.oemPartNo}` : ""}`}
        actions={
          user.role === "admin" && (
            <Link href={`/parts/${part.id}/edit`} className={buttonVariants({ variant: "outline" })}>
              <Pencil /> Edit part
            </Link>
          )
        }
      />

      <dl className="mb-8 grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border bg-card p-5 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="On hand">
          <span className={low ? "rounded bg-warning/30 px-1.5 font-semibold" : "font-semibold"}>
            {part.qtyOnHand} {part.unit}
          </span>
        </Fact>
        <Fact label="Reorder at">{part.reorderLevel > 0 ? part.reorderLevel : "Not set"}</Fact>
        <Fact label="Reorder qty">{part.reorderQty || "Auto"}</Fact>
        {part.avgCost !== undefined && <Fact label="Avg cost">Rs {formatMoney(part.avgCost)}</Fact>}
        <Fact label="Bin">{part.binLocation || "None"}</Fact>
        <Fact label="Barcode">{part.barcode || "None"}</Fact>
        <Fact label="Category">{part.categoryName || "None"}</Fact>
        <Fact label="Brand">{part.brandName || "None"}</Fact>
        {part.keywords && <Fact label="Keywords">{part.keywords}</Fact>}
      </dl>

      <div className="mb-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-base font-semibold">Selling prices</h2>
          {tierPrices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No prices set. This part can’t be invoiced yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {tierPrices.map((p) => (
                <li key={p.tierId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span>
                    {p.tierName}
                    {p.rule && <span className="ml-2 text-xs text-muted-foreground">{p.rule}</span>}
                  </span>
                  <span
                    className={cn("tabular-nums font-medium", p.belowCost && "text-destructive")}
                    title={p.belowCost ? "Below average cost" : undefined}
                  >
                    Rs {formatMoney(p.price)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="mb-2 text-base font-semibold">Fits</h2>
          {part.fitments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bike models linked.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {part.fitments.map((f) => (
                <li key={f.vehicleModelId}>
                  <Badge variant="secondary">{f.label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section>
        <h2 className="mb-2 text-base font-semibold">Stock history</h2>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                {part.avgCost !== undefined && <TableHead className="text-right">Unit cost</TableHead>}
                <TableHead className="hidden md:table-cell">By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {part.movements.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No stock movements yet.
                  </TableCell>
                </TableRow>
              )}
              {part.movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(m.createdAt)}</TableCell>
                  <TableCell>{MOVEMENT_LABELS[m.type]}</TableCell>
                  <TableCell className={`text-right tabular-nums ${m.qtyChange < 0 ? "text-destructive" : ""}`}>
                    {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.balanceAfter}</TableCell>
                  {part.avgCost !== undefined && (
                    <TableCell className="text-right tabular-nums">{formatMoney(m.unitCost)}</TableCell>
                  )}
                  <TableCell className="hidden md:table-cell">{m.createdByName}</TableCell>
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
