import { ThemeProvider } from "@/components/theme/theme-provider";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
