import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { AdjustmentForm } from "./adjustment-form";

export default async function NewAdjustmentPage() {
  const user = await requireUser();
  return (
    <div>
      <PageHeader
        title="Adjust stock"
        description={
          user.role === "admin"
            ? "Correct stock after a count, or write off damaged or lost items."
            : "Write off damaged or lost items. Ask an admin for count corrections."
        }
      />
      <AdjustmentForm isAdmin={user.role === "admin"} />
    </div>
  );
}
