import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LabelSheet } from "@/components/print/label-sheet";
import { renderSkuBarcode } from "@/server/barcode";
import { getSessionUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { getLabelParts, type LabelPart } from "@/server/services/labels";

export const metadata: Metadata = { title: "Labels" };

type Props = { searchParams: Promise<{ part?: string; grn?: string }> };

/** SKU labels for one part (`?part=`) or every part received on a GRN (`?grn=`). */
export default async function PrintLabelsPage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { part, grn } = await searchParams;
  const source = part ? { partId: part } : grn ? { grnId: grn } : null;
  if (!source) notFound();

  let parts: LabelPart[];
  try {
    parts = await getLabelParts(user, source);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }

  const items = parts.map((p) => {
    const barcode = renderSkuBarcode(p.sku);
    return { ...p, svg: barcode?.svg ?? null, modules: barcode?.modules ?? null };
  });
  const back = part ? { href: `/parts/${part}`, label: "Back to part" } : { href: `/grn/${grn}`, label: "Back to GRN" };

  return <LabelSheet items={items} backHref={back.href} backLabel={back.label} />;
}
