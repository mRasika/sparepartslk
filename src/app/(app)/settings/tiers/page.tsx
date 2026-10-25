import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/server/auth";
import { listTiersWithStats } from "@/server/services/tiers";
import { TierEditor } from "./tier-editor";

export default async function PriceTiersPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess what="price tiers" />;
  const tiers = await listTiersWithStats();

  return (
    <div>
      <PageHeader
        title="Price tiers"
        description="Each customer is on one tier. A tier's rule prices every part that has no price typed for that tier."
        actions={
          <Link href="/parts/prices" className={buttonVariants({ variant: "outline" })}>
            Change prices in bulk
          </Link>
        }
      />
      <TierEditor tiers={tiers} />
    </div>
  );
}
