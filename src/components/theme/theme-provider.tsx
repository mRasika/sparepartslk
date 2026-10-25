"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

/**
 * Light / dark / system theme as a `dark` class on <html>, remembered per device. The toaster sits
 * inside so it follows the switch. Print pages pass forcedTheme="light": paper is white.
 */
export function ThemeProvider({ children, forcedTheme }: { children: React.ReactNode; forcedTheme?: "light" }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange forcedTheme={forcedTheme}>
      {children}
      <Toaster richColors />
    </NextThemesProvider>
  );
}
