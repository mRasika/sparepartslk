import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// No title here: it is the company's name, which lives in its database. The layouts and pages
// that show it render a <title> (React puts it in <head>). Keeping this static means the build
// never needs a database (one Docker image, many companies) and no metadata is streamed.
export const metadata: Metadata = { description: "Stock management and billing" };

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
