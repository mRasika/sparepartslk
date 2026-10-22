import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdf } from "@/components/print/invoice-pdf";
import { getSessionUser } from "@/server/auth";
import { NotFound } from "@/server/errors";
import { getInvoicePrintData } from "@/server/services/print";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const { id } = await params;

  try {
    const data = await getInvoicePrintData(user, id);
    const pdf = await renderToBuffer(<InvoicePdf data={data} />);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=${data.number}.pdf`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof NotFound) return new Response("Invoice not found", { status: 404 });
    throw e;
  }
}
