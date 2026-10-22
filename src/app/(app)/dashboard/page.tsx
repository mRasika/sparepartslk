import { getSessionUser } from "@/server/auth";

// Placeholder until Task 16 adds the daily figures.
export default async function DashboardPage() {
  const user = await getSessionUser();
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">Signed in as {user?.fullName}.</p>
    </div>
  );
}
