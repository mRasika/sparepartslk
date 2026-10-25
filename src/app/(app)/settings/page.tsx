import { Tags } from "lucide-react";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/services/settings";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess what="settings" />;
  const s = await getSettings();

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Business details printed on invoices, VAT, and rules for staff."
        actions={
          <Link href="/settings/tiers" className={buttonVariants({ variant: "outline" })}>
            <Tags /> Price tiers
          </Link>
        }
      />
      <SettingsForm
        initial={{
          businessName: s.businessName,
          address: s.address,
          phone: s.phone,
          email: s.email,
          tin: s.tin,
          vatEnabled: s.vatEnabled,
          vatRate: s.vatRate,
          staffMaxDiscountPct: s.staffMaxDiscountPct,
          defaultCreditDays: String(s.defaultCreditDays),
          docPrefix: s.docPrefix,
          logoUrl: s.logoUrl,
        }}
      />
    </div>
  );
}
