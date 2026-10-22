import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InvoiceA4 } from "@/components/print/invoice-a4";
import { InvoiceThermal } from "@/components/print/invoice-thermal";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { getSessionUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { getInvoicePrintData, type InvoicePrintData } from "@/server/services/print";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string; autoprint?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return {};
  const data = await getInvoicePrintData(user, id).catch(() => null);
  // The browser uses the title as the default PDF file name.
  return { title: data?.number ?? "Invoice" };
}

export default async function PrintInvoicePage({ params, searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { format = "a4", autoprint } = await searchParams;

  let data: InvoicePrintData;
  try {
    data = await getInvoicePrintData(user, id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const thermal = format === "thermal";

  return (
    <div className="min-h-svh bg-white text-black">
      <PrintToolbar
        backHref={`/invoices/${id}`}
        autoPrint={autoprint === "1"}
        formats={[
          { label: "A4", href: `/print/invoice/${id}?format=a4`, active: !thermal },
          { label: "Receipt", href: `/print/invoice/${id}?format=thermal`, active: thermal },
        ]}
      />
      {thermal ? <InvoiceThermal data={data} /> : <InvoiceA4 data={data} />}
    </div>
  );
}
