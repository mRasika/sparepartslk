import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdf } from "@/components/print/invoice-pdf";
import { getSessionUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { getQuotationPrintData } from "@/server/services/print";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const disposition = new URL(req.url).searchParams.get("download") === "1" ? "attachment" : "inline";

  try {
    const data = await getQuotationPrintData(id);
    const pdf = await renderToBuffer(<InvoicePdf data={data} />);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename=${data.number}.pdf`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFound) return new Response("Quotation not found", { status: 404 });
    throw e;
  }
}
