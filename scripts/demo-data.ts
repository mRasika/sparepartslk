/**
 * Realistic demo data for LOCAL testing: parts, suppliers, customers and ~2 months of GRNs,
 * invoices, payments, returns and adjustments. Everything goes through the real services, so the
 * stock ledger, average costs, document numbers and balances are all consistent.
 * Never part of production setup — see scripts/seed-demo.ts (refuses non-local databases).
 */
import { and, eq } from "drizzle-orm";
import { addDays, colomboDate } from "@/lib/dates";
import type { SessionUser } from "@/server/auth";
import { db } from "@/server/db/client";
import { invoiceItems, suppliers } from "@/server/db/schema";
import { createAdjustment } from "@/server/services/adjustments";
import {
  createPart,
  listBrands,
  listCategories,
  listPriceTiers,
  listVehicleModels,
  upsertBrand,
  upsertCategory,
  upsertVehicleModel,
} from "@/server/services/catalog";
import { createCustomer } from "@/server/services/customers";
import { createGrn, upsertSupplier } from "@/server/services/grn";
import { createInvoice, type InvoiceInput } from "@/server/services/invoicing";
import { receivePayment } from "@/server/services/payments";
import { createReturn } from "@/server/services/returns";

const MARKER_SUPPLIER = "Lanka Moto Parts (Pvt) Ltd";

const CATEGORIES = ["Brakes", "Chains & Sprockets", "Engine", "Electrical", "Filters", "Cables", "Suspension", "Tyres & Tubes", "Body Parts"];
const BRANDS = ["Bajaj Genuine", "Honda Genuine", "Yamaha Genuine", "TVS Genuine", "Hero Genuine", "Rolon", "NGK", "Exide", "CEAT", "Uno Minda", "Gabriel"];

const MODELS = {
  pulsar150: { make: "Bajaj", model: "Pulsar 150", yearFrom: 2010 },
  ct100: { make: "Bajaj", model: "CT 100", yearFrom: 2005 },
  discover: { make: "Bajaj", model: "Discover 125", yearFrom: 2012 },
  dio: { make: "Honda", model: "Dio", yearFrom: 2008 },
  shine: { make: "Honda", model: "CB Shine", yearFrom: 2010 },
  fz: { make: "Yamaha", model: "FZ-S", yearFrom: 2012 },
  rayzr: { make: "Yamaha", model: "Ray ZR", yearFrom: 2016 },
  apache: { make: "TVS", model: "Apache RTR 160", yearFrom: 2012 },
  wego: { make: "TVS", model: "Wego", yearFrom: 2010 },
  splendor: { make: "Hero", model: "Splendor Plus", yearFrom: 2008 },
  pleasure: { make: "Hero", model: "Pleasure", yearFrom: 2010 },
} as const;
type ModelKey = keyof typeof MODELS;

type PartSpec = {
  sku: string;
  name: string;
  category: string;
  brand: string;
  oem?: string;
  bin: string;
  reorderLevel: number;
  reorderQty: number;
  retail: string;
  dealer?: string;
  wholesale: string;
  fits: ModelKey[];
  active?: boolean;
};

const PARTS: PartSpec[] = [
  { sku: "BRK-PUL-R", name: "Brake Shoe Set Pulsar 150 Rear", category: "Brakes", brand: "Bajaj Genuine", oem: "JA101110", bin: "A1-01", reorderLevel: 10, reorderQty: 30, retail: "1100", dealer: "950", wholesale: "880", fits: ["pulsar150"] },
  { sku: "BRK-PAD-FZ", name: "Disc Brake Pad FZ-S Front", category: "Brakes", brand: "Yamaha Genuine", oem: "21C-F5805-00", bin: "A1-02", reorderLevel: 8, reorderQty: 20, retail: "1650", dealer: "1450", wholesale: "1350", fits: ["fz"] },
  { sku: "BRK-SHOE-CT", name: "Brake Shoe Set CT100", category: "Brakes", brand: "Bajaj Genuine", oem: "DJ101104", bin: "A1-03", reorderLevel: 10, reorderQty: 30, retail: "850", dealer: "740", wholesale: "690", fits: ["ct100"] },
  { sku: "BRK-LVR-UNI", name: "Brake Lever Right (Universal)", category: "Brakes", brand: "Uno Minda", bin: "B2-01", reorderLevel: 5, reorderQty: 20, retail: "450", dealer: "390", wholesale: "360", fits: [] },
  { sku: "CHN-428H-PUL", name: "Chain Kit 428H with Sprockets Pulsar 150", category: "Chains & Sprockets", brand: "Rolon", bin: "C1-01", reorderLevel: 5, reorderQty: 10, retail: "6500", dealer: "5800", wholesale: "5500", fits: ["pulsar150"] },
  { sku: "CHN-KIT-CT", name: "Chain Sprocket Kit CT100", category: "Chains & Sprockets", brand: "Rolon", bin: "C1-02", reorderLevel: 5, reorderQty: 10, retail: "4800", dealer: "4300", wholesale: "4100", fits: ["ct100"] },
  { sku: "SPK-KIT-APC", name: "Sprocket Kit Apache RTR 160", category: "Chains & Sprockets", brand: "TVS Genuine", bin: "C1-03", reorderLevel: 3, reorderQty: 6, retail: "5900", dealer: "5300", wholesale: "5000", fits: ["apache"] },
  { sku: "PLG-CPR7EA", name: "Spark Plug NGK CPR7EA-9", category: "Electrical", brand: "NGK", oem: "CPR7EA-9", bin: "D1-01", reorderLevel: 15, reorderQty: 50, retail: "750", dealer: "650", wholesale: "600", fits: ["fz", "rayzr", "dio", "wego", "pleasure"] },
  { sku: "PLG-BPR7ES", name: "Spark Plug NGK BPR7ES", category: "Electrical", brand: "NGK", oem: "BPR7ES", bin: "D1-02", reorderLevel: 15, reorderQty: 50, retail: "700", dealer: "610", wholesale: "570", fits: ["pulsar150", "ct100", "discover", "splendor", "apache"] },
  { sku: "FLT-OIL-PUL", name: "Oil Filter Pulsar 150", category: "Filters", brand: "Bajaj Genuine", oem: "JF531010", bin: "E1-01", reorderLevel: 10, reorderQty: 30, retail: "550", dealer: "480", wholesale: "450", fits: ["pulsar150"] },
  { sku: "FLT-AIR-DIO", name: "Air Filter Element Dio", category: "Filters", brand: "Honda Genuine", oem: "17210-GFC-890", bin: "E1-02", reorderLevel: 6, reorderQty: 20, retail: "900", dealer: "790", wholesale: "740", fits: ["dio"] },
  { sku: "FLT-AIR-SPL", name: "Air Filter Splendor Plus", category: "Filters", brand: "Hero Genuine", bin: "E1-03", reorderLevel: 6, reorderQty: 20, retail: "650", dealer: "570", wholesale: "530", fits: ["splendor"] },
  { sku: "CBL-CLT-CT", name: "Clutch Cable CT100", category: "Cables", brand: "Bajaj Genuine", bin: "F1-01", reorderLevel: 8, reorderQty: 25, retail: "480", dealer: "420", wholesale: "390", fits: ["ct100"] },
  { sku: "CBL-THR-DIO", name: "Throttle Cable Dio", category: "Cables", brand: "Honda Genuine", bin: "F1-02", reorderLevel: 6, reorderQty: 20, retail: "520", dealer: "455", wholesale: "425", fits: ["dio"] },
  { sku: "CBL-SPD-PUL", name: "Speedometer Cable Pulsar 150", category: "Cables", brand: "Bajaj Genuine", bin: "F1-03", reorderLevel: 5, reorderQty: 15, retail: "600", dealer: "525", wholesale: "490", fits: ["pulsar150"] },
  { sku: "BLB-H4-35", name: "Headlight Bulb 12V 35/35W", category: "Electrical", brand: "Uno Minda", bin: "D2-01", reorderLevel: 10, reorderQty: 40, retail: "350", dealer: "300", wholesale: "280", fits: [] },
  { sku: "BAT-12N5", name: "Battery 12V 5Ah Maintenance Free", category: "Electrical", brand: "Exide", oem: "12N5-3B", bin: "D2-02", reorderLevel: 4, reorderQty: 8, retail: "7800", dealer: "7100", wholesale: "6800", fits: ["ct100", "discover", "splendor"] },
  { sku: "CDI-PUL", name: "CDI Unit Pulsar 150", category: "Electrical", brand: "Bajaj Genuine", oem: "JE571012", bin: "D2-03", reorderLevel: 3, reorderQty: 5, retail: "5500", dealer: "4950", wholesale: "4700", fits: ["pulsar150"] },
  { sku: "REG-RECT-12", name: "Regulator Rectifier 12V", category: "Electrical", brand: "Uno Minda", bin: "D2-04", reorderLevel: 3, reorderQty: 8, retail: "2700", dealer: "2400", wholesale: "2250", fits: [] },
  // No Dealer price on purpose: Dealer customers pay the Retail price (fallback).
  { sku: "HRN-12V-UNI", name: "Horn 12V (Universal)", category: "Electrical", brand: "Uno Minda", bin: "D2-05", reorderLevel: 5, reorderQty: 15, retail: "1100", wholesale: "920", fits: [] },
  { sku: "TYR-275-18", name: "Tyre 2.75-18 Rear CEAT Secura", category: "Tyres & Tubes", brand: "CEAT", bin: "G1-01", reorderLevel: 6, reorderQty: 12, retail: "6900", dealer: "6400", wholesale: "6200", fits: ["ct100", "splendor", "discover"] },
  { sku: "TUB-275-18", name: "Tube 2.75-18", category: "Tyres & Tubes", brand: "CEAT", bin: "G1-02", reorderLevel: 10, reorderQty: 30, retail: "1200", dealer: "1080", wholesale: "1020", fits: ["ct100", "splendor", "discover"] },
  { sku: "TYR-90-100-10", name: "Tyre 90/100-10 Tubeless", category: "Tyres & Tubes", brand: "CEAT", bin: "G1-03", reorderLevel: 4, reorderQty: 10, retail: "7900", dealer: "7300", wholesale: "7000", fits: ["dio", "wego", "pleasure"] },
  { sku: "SHK-RR-SPL", name: "Rear Shock Absorber Pair Splendor", category: "Suspension", brand: "Gabriel", bin: "H1-01", reorderLevel: 2, reorderQty: 4, retail: "8900", dealer: "8100", wholesale: "7700", fits: ["splendor"] },
  { sku: "CLT-PLT-PUL", name: "Clutch Plate Set Pulsar 150", category: "Engine", brand: "Bajaj Genuine", oem: "JE561003", bin: "B1-01", reorderLevel: 4, reorderQty: 10, retail: "3500", dealer: "3150", wholesale: "2950", fits: ["pulsar150"] },
  { sku: "PST-KIT-CT", name: "Piston Kit CT100 (Standard)", category: "Engine", brand: "Bajaj Genuine", bin: "B1-02", reorderLevel: 2, reorderQty: 5, retail: "6200", dealer: "5600", wholesale: "5300", fits: ["ct100"] },
  { sku: "GSK-KIT-DIO", name: "Full Gasket Kit Dio", category: "Engine", brand: "Honda Genuine", bin: "B1-03", reorderLevel: 3, reorderQty: 10, retail: "1900", dealer: "1700", wholesale: "1600", fits: ["dio"] },
  { sku: "MIR-SET-UNI", name: "Mirror Set Pair (Universal)", category: "Body Parts", brand: "Uno Minda", bin: "H2-01", reorderLevel: 6, reorderQty: 20, retail: "950", dealer: "840", wholesale: "790", fits: [] },
  { sku: "IND-LMP-UNI", name: "Indicator Lamp Pair (Universal)", category: "Body Parts", brand: "Uno Minda", bin: "H2-02", reorderLevel: 6, reorderQty: 20, retail: "850", dealer: "750", wholesale: "700", fits: [] },
  { sku: "KCK-LVR-CT", name: "Kick Start Lever CT100", category: "Engine", brand: "Bajaj Genuine", bin: "B1-04", reorderLevel: 0, reorderQty: 0, retail: "1600", dealer: "1450", wholesale: "1350", fits: ["ct100"] },
  { sku: "PLG-B8HS", name: "Spark Plug NGK B8HS (discontinued)", category: "Electrical", brand: "NGK", bin: "D1-09", reorderLevel: 0, reorderQty: 0, retail: "500", dealer: "440", wholesale: "410", fits: [], active: false },
];

const SUPPLIERS = {
  lmp: { name: MARKER_SUPPLIER, phone: "011 268 4455", address: "235 Panchikawatta Rd, Colombo 10", tin: "409223344" },
  cas: { name: "Colombo Auto Spares", phone: "011 243 9012", address: "78 Prince St, Pettah" },
  kbt: { name: "Kandy Bike Traders", phone: "081 223 5566", address: "12 Peradeniya Rd, Kandy" },
  cth: { name: "Ceylon Tyre House", phone: "011 257 8800", address: "145 Baseline Rd, Colombo 09" },
};

/** [supplier, days ago, supplier invoice no, lines as [sku, qty, unit cost]] */
const GRNS: [keyof typeof SUPPLIERS, number, string, [string, number, string][]][] = [
  ["lmp", 60, "LMP/24/1187", [
    ["BRK-PUL-R", 30, "650"], ["BRK-SHOE-CT", 35, "480"], ["CHN-428H-PUL", 10, "4200"], ["CHN-KIT-CT", 10, "3100"],
    ["PLG-BPR7ES", 40, "420"], ["FLT-OIL-PUL", 30, "320"], ["CBL-CLT-CT", 30, "280"], ["CBL-SPD-PUL", 12, "350"],
    ["CDI-PUL", 2, "3400"], ["CLT-PLT-PUL", 9, "2100"], ["PST-KIT-CT", 5, "3900"], ["KCK-LVR-CT", 4, "950"],
    ["FLT-AIR-SPL", 18, "380"],
  ]],
  ["cas", 55, "CAS-55021", [
    ["BRK-PAD-FZ", 24, "900"], ["SPK-KIT-APC", 6, "3800"], ["PLG-CPR7EA", 12, "450"], ["FLT-AIR-DIO", 15, "520"],
    ["CBL-THR-DIO", 20, "300"], ["GSK-KIT-DIO", 8, "1100"],
  ]],
  ["kbt", 50, "KBT 3349", [
    ["BRK-LVR-UNI", 25, "220"], ["BLB-H4-35", 50, "180"], ["BAT-12N5", 3, "5200"], ["REG-RECT-12", 8, "1600"],
    ["HRN-12V-UNI", 15, "650"], ["MIR-SET-UNI", 20, "550"], ["IND-LMP-UNI", 16, "480"], ["SHK-RR-SPL", 6, "5800"],
  ]],
  ["cth", 45, "CTH/INV/8812", [["TYR-275-18", 5, "4800"], ["TUB-275-18", 30, "750"], ["TYR-90-100-10", 10, "5500"]]],
  // Price rise on the second delivery moves the weighted average cost.
  ["lmp", 20, "LMP/24/1342", [["BRK-PUL-R", 10, "700"], ["CHN-428H-PUL", 4, "4400"], ["PLG-BPR7ES", 20, "460"]]],
];

const CUSTOMERS = {
  silva: { name: "Chaminda Silva", businessName: "Silva Motor Spares", phone: "077 123 4567", address: "45 Kandy Rd, Kadawatha", tin: "114567890", tier: "Dealer", creditLimit: "150000", creditDays: 30 },
  sameera: { name: "Sameera Bandara", businessName: "Sameera Auto Centre", phone: "071 455 2211", address: "22 Puttalam Rd, Kurunegala", tier: "Dealer", creditLimit: "100000", creditDays: 45 },
  ruwan: { name: "Ruwan Fernando", businessName: "Ruwan Traders", phone: "011 233 7788", address: "56 Keyzer St, Pettah", tin: "409112233", tier: "Wholesale", creditLimit: "300000", creditDays: 30 },
  kasun: { name: "Kasun Wijeratne", businessName: "Kasun Bike Service", phone: "076 998 1122", address: "8 Station Rd, Gampaha", tier: "Retail", creditLimit: "50000", creditDays: 14 },
  ajith: { name: "Ajith Kumara", phone: "070 334 5566", tier: "Retail", creditLimit: "0", creditDays: 0 },
  old: { name: "Old Garage Motors", phone: "011 290 1100", tier: "Retail", creditLimit: "0", creditDays: 0, inactive: true },
} as const;
type CustomerKey = keyof typeof CUSTOMERS | "walkIn";

type Line = [string, number, string?]; // sku, qty, optional line discount %
type InvoiceSpec = {
  key: string;
  daysAgo: number; // 0 = today, entered by staff
  customer: CustomerKey;
  type: "cash" | "credit";
  lines: Line[];
  invoiceDiscountPct?: string;
  method?: "cash" | "bank" | "cheque";
  reference?: string;
};

const INVOICES: InvoiceSpec[] = [
  { key: "I1", daysAgo: 40, customer: "silva", type: "credit", lines: [["BRK-PUL-R", 8], ["FLT-OIL-PUL", 6], ["CHN-428H-PUL", 1]] },
  { key: "I2", daysAgo: 38, customer: "ruwan", type: "credit", lines: [["PLG-BPR7ES", 20], ["CBL-CLT-CT", 10], ["TUB-275-18", 10], ["BLB-H4-35", 20]] },
  { key: "I3", daysAgo: 35, customer: "kasun", type: "credit", lines: [["BRK-SHOE-CT", 4], ["CBL-CLT-CT", 2], ["BLB-H4-35", 4]] },
  { key: "I4", daysAgo: 30, customer: "walkIn", type: "cash", lines: [["BLB-H4-35", 2], ["MIR-SET-UNI", 1]] },
  { key: "I5", daysAgo: 50, customer: "sameera", type: "credit", lines: [["BRK-PAD-FZ", 6], ["PLG-CPR7EA", 6], ["FLT-AIR-DIO", 4]] },
  { key: "I6", daysAgo: 25, customer: "ajith", type: "cash", lines: [["TYR-275-18", 1], ["TUB-275-18", 1]], method: "bank", reference: "BOC 55120931" },
  { key: "I7", daysAgo: 20, customer: "silva", type: "credit", lines: [["CHN-428H-PUL", 2], ["CLT-PLT-PUL", 2], ["CBL-SPD-PUL", 2], ["HRN-12V-UNI", 2]] },
  { key: "I8", daysAgo: 15, customer: "ruwan", type: "credit", lines: [["BRK-PUL-R", 10], ["BRK-SHOE-CT", 10], ["FLT-AIR-SPL", 6], ["CBL-THR-DIO", 6]], invoiceDiscountPct: "5" },
  { key: "I9", daysAgo: 12, customer: "kasun", type: "credit", lines: [["IND-LMP-UNI", 4], ["MIR-SET-UNI", 2], ["HRN-12V-UNI", 2]] },
  { key: "I10", daysAgo: 10, customer: "walkIn", type: "cash", lines: [["PLG-BPR7ES", 2], ["BLB-H4-35", 1]] },
  { key: "I11", daysAgo: 7, customer: "sameera", type: "credit", lines: [["GSK-KIT-DIO", 2], ["CBL-THR-DIO", 4], ["TYR-90-100-10", 2]] },
  { key: "I12", daysAgo: 5, customer: "silva", type: "credit", lines: [["BAT-12N5", 2, "5"]] },
  { key: "I13", daysAgo: 3, customer: "walkIn", type: "cash", lines: [["BRK-LVR-UNI", 2]] },
  { key: "T1", daysAgo: 0, customer: "walkIn", type: "cash", lines: [["BLB-H4-35", 2], ["PLG-BPR7ES", 1]] },
  { key: "T2", daysAgo: 0, customer: "silva", type: "credit", lines: [["FLT-OIL-PUL", 4], ["BRK-PUL-R", 2]] },
  { key: "T3", daysAgo: 0, customer: "ajith", type: "cash", lines: [["MIR-SET-UNI", 1, "10"], ["IND-LMP-UNI", 1]] },
];

export type DemoSummary = { loaded: boolean; message: string };

/** Loads the demo set once. Returns loaded=false if it is already there. */
export async function loadDemoData({ admin, staff }: { admin: SessionUser; staff: SessionUser }): Promise<DemoSummary> {
  const [already] = await db.select().from(suppliers).where(eq(suppliers.name, MARKER_SUPPLIER));
  if (already) return { loaded: false, message: "Demo data is already loaded; nothing changed." };

  const today = colomboDate();
  const daysAgo = (n: number) => addDays(today, -n);

  // Reference lists (reuse anything that already exists by name).
  const categoryIds = new Map((await listCategories()).map((c) => [c.name, c.id]));
  for (const name of CATEGORIES) if (!categoryIds.has(name)) categoryIds.set(name, (await upsertCategory(admin, { name })).id);
  const brandIds = new Map((await listBrands()).map((b) => [b.name, b.id]));
  for (const name of BRANDS) if (!brandIds.has(name)) brandIds.set(name, (await upsertBrand(admin, { name })).id);
  const existingModels = await listVehicleModels();
  const modelIds = new Map<ModelKey, string>();
  for (const [key, m] of Object.entries(MODELS) as [ModelKey, (typeof MODELS)[ModelKey]][]) {
    const found = existingModels.find((x) => x.make === m.make && x.model === m.model);
    modelIds.set(key, found ? found.id : (await upsertVehicleModel(admin, m)).id);
  }
  const tiers = new Map((await listPriceTiers()).map((t) => [t.name, t.id]));

  // Parts.
  const partIds = new Map<string, string>();
  for (const p of PARTS) {
    const prices = [
      { tierId: tiers.get("Retail")!, price: p.retail },
      ...(p.dealer ? [{ tierId: tiers.get("Dealer")!, price: p.dealer }] : []),
      { tierId: tiers.get("Wholesale")!, price: p.wholesale },
    ];
    const { id } = await createPart(admin, {
      sku: p.sku,
      name: p.name,
      oemPartNo: p.oem,
      categoryId: categoryIds.get(p.category),
      brandId: brandIds.get(p.brand),
      unit: "pcs",
      binLocation: p.bin,
      reorderLevel: p.reorderLevel,
      reorderQty: p.reorderQty,
      isActive: p.active ?? true,
      prices,
      fitmentIds: p.fits.map((f) => modelIds.get(f)!),
    });
    partIds.set(p.sku, id);
  }

  // Suppliers and deliveries.
  const supplierIds = new Map<string, string>();
  for (const [key, s] of Object.entries(SUPPLIERS)) supplierIds.set(key, (await upsertSupplier(admin, { ...s, isActive: true })).id);
  for (const [supplier, ago, supplierInvoiceNo, lines] of GRNS) {
    await createGrn(admin, {
      supplierId: supplierIds.get(supplier)!,
      supplierInvoiceNo,
      receivedDate: daysAgo(ago),
      lines: lines.map(([sku, qty, unitCost]) => ({ partId: partIds.get(sku)!, qty, unitCost })),
    });
  }

  // Customers.
  const customerIds = new Map<CustomerKey, string>();
  const walkIn = await db.query.customers.findFirst({ where: (c, { eq: e }) => e(c.isWalkIn, true) });
  customerIds.set("walkIn", walkIn!.id);
  for (const [key, c] of Object.entries(CUSTOMERS) as [keyof typeof CUSTOMERS, (typeof CUSTOMERS)[keyof typeof CUSTOMERS]][]) {
    const { id } = await createCustomer(admin, {
      name: c.name,
      businessName: "businessName" in c ? c.businessName : undefined,
      phone: c.phone,
      address: "address" in c ? c.address : undefined,
      tin: "tin" in c ? c.tin : undefined,
      tierId: tiers.get(c.tier)!,
      creditLimit: c.creditLimit,
      creditDays: c.creditDays,
      isActive: !("inactive" in c),
    });
    customerIds.set(key, id);
  }

  // Invoices: past ones entered by the admin (backdated), today's by staff.
  const invoiceIds = new Map<string, string>();
  for (const inv of INVOICES) {
    const input: InvoiceInput = {
      customerId: customerIds.get(inv.customer)!,
      paymentType: inv.type,
      invoiceDate: inv.daysAgo > 0 ? daysAgo(inv.daysAgo) : undefined,
      lines: inv.lines.map(([sku, qty, pct]) => ({
        partId: partIds.get(sku)!,
        qty,
        discount: pct ? { type: "percent" as const, value: pct } : undefined,
      })),
      invoiceDiscount: inv.invoiceDiscountPct ? { type: "percent", value: inv.invoiceDiscountPct } : undefined,
      cashPayment: inv.type === "cash" ? { method: inv.method ?? "cash", reference: inv.reference } : undefined,
    };
    const { id } = await createInvoice(inv.daysAgo > 0 ? admin : staff, input);
    invoiceIds.set(inv.key, id);
  }

  // Payments (oldest-due invoices are settled first). Kasun pays nothing, so his invoice goes overdue;
  // Sameera's is only part paid.
  await receivePayment(admin, { customerId: customerIds.get("silva")!, amount: "16280", method: "cash", paymentDate: daysAgo(25) });
  await receivePayment(admin, { customerId: customerIds.get("ruwan")!, amount: "31100", method: "cheque", reference: "HNB 004512", paymentDate: daysAgo(10) });
  await receivePayment(admin, { customerId: customerIds.get("sameera")!, amount: "10000", method: "bank", reference: "BOC TT 778812", paymentDate: daysAgo(8) });
  await receivePayment(staff, { customerId: customerIds.get("silva")!, amount: "10000", method: "cash", paymentDate: daysAgo(2) });

  // Returns.
  const item = async (invoiceKey: string, sku: string) => {
    const [row] = await db
      .select({ id: invoiceItems.id })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.invoiceId, invoiceIds.get(invoiceKey)!), eq(invoiceItems.partId, partIds.get(sku)!)));
    return row.id;
  };
  await createReturn(staff, {
    invoiceId: invoiceIds.get("I7")!,
    reason: "Customer ordered one kit too many",
    lines: [{ invoiceItemId: await item("I7", "CHN-428H-PUL"), qty: 1, restock: true }],
  });
  await createReturn(staff, {
    invoiceId: invoiceIds.get("I3")!,
    reason: "Bulb filament broken on arrival",
    lines: [{ invoiceItemId: await item("I3", "BLB-H4-35"), qty: 1, restock: false }],
  });
  await createReturn(staff, {
    invoiceId: invoiceIds.get("I4")!,
    reason: "Wrong mirror thread size",
    lines: [{ invoiceItemId: await item("I4", "MIR-SET-UNI"), qty: 1, restock: true }],
    refund: { method: "cash" },
  });

  // Stock adjustments.
  await createAdjustment(admin, {
    reason: "count_correction",
    note: "Found 2 in the back store during the monthly count",
    lines: [{ partId: partIds.get("GSK-KIT-DIO")!, qtyChange: 2 }],
  });
  await createAdjustment(staff, {
    reason: "damage",
    note: "Mirror glass cracked on the display rack",
    lines: [{ partId: partIds.get("MIR-SET-UNI")!, qtyChange: -1 }],
  });

  return {
    loaded: true,
    message: `Loaded ${PARTS.length} parts, ${Object.keys(SUPPLIERS).length} suppliers, ${Object.keys(CUSTOMERS).length} customers, ${GRNS.length} GRNs, ${INVOICES.length} invoices, 4 payments, 3 returns and 2 adjustments.`,
  };
}
