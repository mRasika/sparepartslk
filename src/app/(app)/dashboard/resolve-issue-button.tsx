"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveReconciliationIssueAction } from "@/server/actions/dashboard";

export function ResolveIssueButton({ issueId, sku }: { issueId: string; sku: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await resolveReconciliationIssueAction(issueId);
          if (!r.ok) {
            toast.error(r.error.message);
            return;
          }
          toast.success(`${sku} marked as fixed`);
          router.refresh();
        })
      }
    >
      Mark fixed
    </Button>
  );
}
