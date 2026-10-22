import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth";
import { listUsers } from "@/server/services/users";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccess what="user management" />;
  const users = await listUsers();
  return (
    <div className="max-w-4xl">
      <PageHeader title="Users" description="Who can sign in, and what they can do. Staff can’t see costs, change settings or cancel invoices." />
      <UsersTable users={users} currentUserId={user.id} />
    </div>
  );
}
