import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { listSuppliers } from "@/server/services/grn";
import { SupplierEditor } from "./supplier-editor";

export default async function SuppliersPage() {
  await requireUser();
  const suppliers = await listSuppliers();
  return (
    <div>
      <PageHeader title="Suppliers" description="Who you buy parts from. Inactive suppliers can’t be used on new GRNs." />
      <SupplierEditor rows={suppliers} />
    </div>
  );
}
