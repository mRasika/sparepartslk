import { ThemeProvider } from "@/components/theme/theme-provider";

/** Printed documents are always light, whatever theme the app uses. */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider forcedTheme="light">{children}</ThemeProvider>;
}
