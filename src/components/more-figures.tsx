import { ChevronRight } from "lucide-react";

/**
 * Secondary figures kept out of the way until asked for. A native <details>, so opening it is not a
 * navigation (no `?query` link) and works without JavaScript.
 */
export function MoreFigures({
  label = "More figures",
  open = false,
  children,
}: {
  label?: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="flex flex-col gap-4 border-t p-4 sm:p-5">{children}</div>
    </details>
  );
}
