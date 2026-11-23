"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Screen-only controls above a printable document; prints automatically when asked. */
export function PrintToolbar({
  backHref,
  backLabel,
  formats,
  autoPrint,
  confirm,
  children,
}: {
  backHref: string;
  /** e.g. "Back to invoice". */
  backLabel: string;
  formats: { label: string; href: string; active: boolean }[];
  autoPrint: boolean;
  /** When set, Print asks this first, e.g. before a large label run. */
  confirm?: { title: string; description: string } | null;
  /** Extra controls before the Print button. */
  children?: React.ReactNode;
}) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!autoPrint) return;
    // Let fonts and the logo settle before opening the print dialog.
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [autoPrint]);

  function print() {
    setAsking(false);
    // After the dialog's 100 ms close animation, so it isn't printed too.
    setTimeout(() => window.print(), 200);
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur print:hidden">
      <Link href={backHref} className={buttonVariants({ variant: "ghost" })}>
        <ArrowLeft /> {backLabel}
      </Link>
      <div className="flex flex-wrap gap-2">
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
        {children}
        <Button onClick={() => (confirm ? setAsking(true) : window.print())}>
          <Printer /> Print
        </Button>
      </div>
      {confirm && (
        <Dialog open={asking} onOpenChange={setAsking}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirm.title}</DialogTitle>
              <DialogDescription>{confirm.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAsking(false)}>
                Check counts
              </Button>
              <Button onClick={print}>
                <Printer /> Print
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
