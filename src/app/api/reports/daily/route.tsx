import { renderToBuffer } from "@react-pdf/renderer";
import { DailyReportPdf } from "@/components/print/daily-report-pdf";
import { colomboDate } from "@/lib/dates";
import { parseReportDate } from "@/lib/sales-target";
import { getSessionUser } from "@/server/auth";
import { getDailyTargetReport } from "@/server/services/sales-targets";

export const runtime = "nodejs";

/** The daily sales report PDF (spec §5). Admins only. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (user.role !== "admin") return new Response("Admins only", { status: 403 });

  const params = new URL(req.url).searchParams;
  const date = parseReportDate(params.get("date"), colomboDate());
  if (!date) return new Response("Choose a date up to today", { status: 400 });
  const disposition = params.get("download") === "1" ? "attachment" : "inline";

  const data = await getDailyTargetReport(user, date);
  const pdf = await renderToBuffer(<DailyReportPdf data={data} printedAt={new Date()} />);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename=daily-sales-${date}.pdf`,
      "Cache-Control": "no-store",
    },
  });
}
