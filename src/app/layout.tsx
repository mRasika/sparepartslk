import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { cachedBusinessName } from "@/server/cached";
import "./globals.css";

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  return { title: await cachedBusinessName(), description: "Stock management and billing" };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // next-themes sets the theme class on <html> before React hydrates.
    <html lang="en" className={plex.variable} suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
