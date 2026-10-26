import { Tags } from "lucide-react";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { colomboDate } from "@/lib/dates";
import { requireUser } from "@/server/auth";
import { getTargetSettings } from "@/server/services/sales-targets";
import { getSettings } from "@/server/services/settings";
import { ClosedDays } from "./closed-days";
import { SalesTargetForm } from "./sales-target-form";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess what="settings" />;
  const [s, target] = await Promise.all([getSettings(), getTargetSettings(user)]);

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
      <section id="sales-target" className="mt-10 grid max-w-3xl scroll-mt-20 gap-6 border-t pt-8">
        <div>
          <h2 className="text-base font-semibold">Sales target</h2>
          <p className="text-sm text-muted-foreground">
            Shown on the dashboard and in the daily report. A change applies from today; earlier days keep their target.
          </p>
        </div>
        <SalesTargetForm current={target.current} previous={target.previous} />
        <ClosedDays closedDays={target.closedDays} today={colomboDate()} />
      </section>
    </div>
  );
}
