import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDate, formatMoney } from "@/lib/format";
import type { InvoicePrintData } from "@/server/services/print";

const s = StyleSheet.create({
  page: { padding: 34, fontSize: 9.5, fontFamily: "Helvetica", color: "#111" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottom: "1.5pt solid #111", paddingBottom: 10 },
  bizName: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", textAlign: "right", marginBottom: 4 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
  metaLabel: { color: "#555", width: 50, textAlign: "right" },
  billTo: { paddingVertical: 10 },
  small: { fontSize: 8, color: "#555", marginBottom: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", borderBottom: "1pt solid #111", paddingVertical: 4, fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  tr: { flexDirection: "row", borderBottom: "0.5pt solid #ccc", paddingVertical: 4 },
  cNo: { width: "5%" },
  cSku: { width: "15%" },
  cDesc: { width: "36%" },
  cQty: { width: "8%", textAlign: "right" },
  cPrice: { width: "12%", textAlign: "right" },
  cDisc: { width: "12%", textAlign: "right" },
  cAmt: { width: "12%", textAlign: "right" },
  totals: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  words: { width: "55%", fontStyle: "italic", alignSelf: "flex-end" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", width: 190, paddingVertical: 2 },
  grand: { fontSize: 12, fontFamily: "Helvetica-Bold", borderTop: "1pt solid #111", marginTop: 3, paddingTop: 4 },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: 50 },
  sign: { width: 190, borderTop: "0.8pt solid #111", paddingTop: 3, textAlign: "center" },
  watermark: {
    position: "absolute",
    top: 330,
    left: 70,
    fontSize: 80,
    color: "#c81e1e",
    opacity: 0.15,
    transform: "rotate(-24deg)",
    fontFamily: "Helvetica-Bold",
  },
});

/** The A4 invoice as a PDF, from the same data as the print page. */
export function InvoicePdf({ data }: { data: InvoicePrintData }) {
  const vatOn = Number(data.vatRate) > 0;
  return (
    <Document title={data.number} author={data.business.name}>
      <Page size="A4" style={s.page}>
        {data.status === "cancelled" && <Text style={s.watermark}>CANCELLED</Text>}
        <View style={s.header}>
          <View>
            <Text style={s.bizName}>{data.business.name}</Text>
            {data.business.address ? <Text>{data.business.address}</Text> : null}
            <Text>{[data.business.phone, data.business.email].filter(Boolean).join("  |  ")}</Text>
            {data.business.tin ? <Text>TIN: {data.business.tin}</Text> : null}
          </View>
          <View>
            <Text style={s.title}>{data.title}</Text>
            <Meta label="No" value={data.number} />
            <Meta label="Date" value={formatDate(data.date)} />
            {data.paymentType === "credit" ? <Meta label="Due" value={formatDate(data.dueDate)} /> : null}
            <Meta label="Payment" value={data.paymentType === "cash" ? "Cash" : "Credit"} />
          </View>
        </View>

        <View style={s.billTo}>
          <Text style={s.small}>Bill to</Text>
          <Text style={s.bold}>{data.customer.name}</Text>
          {data.customer.businessName ? <Text>{data.customer.businessName}</Text> : null}
          {data.customer.address ? <Text>{data.customer.address}</Text> : null}
          {vatOn || data.customer.tin ? <Text>TIN: {data.customer.tin || "Not provided"}</Text> : null}
        </View>

        <View style={s.th}>
          <Text style={s.cNo}>#</Text>
          <Text style={s.cSku}>SKU</Text>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cPrice}>Unit price</Text>
          <Text style={s.cDisc}>Discount</Text>
          <Text style={s.cAmt}>Amount</Text>
        </View>
        {data.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.cNo}>{i + 1}</Text>
            <Text style={s.cSku}>{l.sku}</Text>
            <Text style={s.cDesc}>{l.description}</Text>
            <Text style={s.cQty}>{l.qty}</Text>
            <Text style={s.cPrice}>{formatMoney(l.unitPrice)}</Text>
            <Text style={s.cDisc}>{l.discount === "0.00" ? "" : formatMoney(l.discount)}</Text>
            <Text style={s.cAmt}>{formatMoney(l.lineTotal)}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <Text style={s.words}>{data.amountInWords}</Text>
          <View>
            <Row label="Subtotal" value={formatMoney(data.subtotal)} />
            {data.invoiceDiscount !== "0.00" ? <Row label="Discount" value={`-${formatMoney(data.invoiceDiscount)}`} /> : null}
            {vatOn ? <Row label={`VAT ${Number(data.vatRate)}%`} value={formatMoney(data.vatAmount)} /> : null}
            <View style={[s.totalRow, s.grand]}>
              <Text>Total (Rs)</Text>
              <Text>{formatMoney(data.total)}</Text>
            </View>
          </View>
        </View>

        <View style={s.footer} wrap={false}>
          <Text>Prepared by: {data.preparedBy}</Text>
          <Text style={s.sign}>Received by (signature and date)</Text>
        </View>
      </Page>
    </Document>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.bold}>{value}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.totalRow}>
      <Text>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}
