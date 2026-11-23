"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

/**
 * Light / dark / system theme as a `dark` class on <html>, remembered per device. The toaster sits
 * inside so it follows the switch. Print pages pass forcedTheme="light": paper is white.
 */
/**
 * next-themes renders an inline <script> that sets the theme class before first paint. It only ever runs
 * from the server HTML. React 19.2+ logs "Encountered a script tag" when that script is created on the
 * client (e.g. navigating from /login into the app), so on the client mark it as a data block: it would
 * not run there anyway. The server/client `type` difference is covered by next-themes'
 * suppressHydrationWarning on the script.
 */
const scriptProps = typeof window === "undefined" ? undefined : { type: "application/json" };

export function ThemeProvider({ children, forcedTheme }: { children: React.ReactNode; forcedTheme?: "light" }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      forcedTheme={forcedTheme}
      scriptProps={scriptProps}
    >
      {children}
      <Toaster richColors />
    </NextThemesProvider>
  );
}
