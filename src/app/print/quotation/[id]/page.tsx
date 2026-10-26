import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InvoiceA4 } from "@/components/print/invoice-a4";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { getSessionUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { getQuotationPrintData, type InvoicePrintData } from "@/server/services/print";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return {};
  const data = await getQuotationPrintData(id).catch(() => null);
  // The browser uses the title as the default PDF file name.
  return { title: data?.number ?? "Quotation" };
}

export default async function PrintQuotationPage({ params, searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { autoprint } = await searchParams;

  let data: InvoicePrintData;
  try {
    data = await getQuotationPrintData(id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }

  return (
    <div className="min-h-svh bg-white text-black">
      <PrintToolbar
        backHref={`/quotations/${id}`}
        autoPrint={autoprint === "1"}
        formats={[{ label: "A4", href: `/print/quotation/${id}`, active: true }]}
      />
      <InvoiceA4 data={data} />
    </div>
  );
}
