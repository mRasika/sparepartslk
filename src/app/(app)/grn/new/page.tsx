import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { colomboDate } from "@/lib/dates";
import { requireUser } from "@/server/auth";
import { listSuppliers } from "@/server/services/grn";
import { GrnForm } from "./grn-form";

export default async function NewGrnPage() {
  await requireUser();
  const suppliers = await listSuppliers({ activeOnly: true });

  return (
    <div>
      <PageHeader
        title="Receive goods"
        description="Record a supplier delivery. Stock and average cost update when you save."
      />
      {suppliers.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm">
          Add a supplier first on the{" "}
          <Link href="/suppliers" className="font-medium underline">
            Suppliers
          </Link>{" "}
          page.
        </p>
      ) : (
        <GrnForm suppliers={suppliers} today={colomboDate()} />
      )}
    </div>
  );
}
