"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";

/** Screen-only controls above a printable document; prints automatically when asked. */
export function PrintToolbar({
  backHref,
  formats,
  autoPrint,
}: {
  backHref: string;
  formats: { label: string; href: string; active: boolean }[];
  autoPrint: boolean;
}) {
  useEffect(() => {
    if (!autoPrint) return;
    // Let fonts and the logo settle before opening the print dialog.
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [autoPrint]);

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur print:hidden">
      <Link href={backHref} className={buttonVariants({ variant: "ghost" })}>
        <ArrowLeft /> Back to invoice
      </Link>
      <div className="flex gap-2">
        {formats.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            aria-current={f.active ? "page" : undefined}
            className={buttonVariants({ variant: f.active ? "secondary" : "ghost" })}
          >
            {f.label}
          </Link>
        ))}
        <Button onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
    </div>
  );
}
