import { redirect } from "next/navigation";
import { Sidebar } from "@/components/nav/sidebar";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { getSessionUser } from "@/server/auth";
import { cachedBusinessName } from "@/server/cached";
import { lowStockCount } from "@/server/services/inventory";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [lowCount, businessName] = await Promise.all([lowStockCount(), cachedBusinessName()]);

  return (
    <ThemeProvider>
      <div className="min-h-svh">
        <Sidebar businessName={businessName} fullName={user.fullName} role={user.role} lowStockCount={lowCount} />
        <main className="px-4 py-6 md:ml-60 md:px-8 md:py-8">{children}</main>
      </div>
    </ThemeProvider>
  );
}
