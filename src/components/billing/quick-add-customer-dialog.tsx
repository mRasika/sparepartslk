"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionError } from "@/lib/action-result";
import { quickAddCustomerAction } from "@/server/actions/customers";
import type { PickedCustomer } from "./customer-picker";

export type QuickAddPrefill = { name: string; phone: string };

/** Typed text that looks like a phone number goes to Phone; anything else is the name. */
export function prefillFrom(text: string): QuickAddPrefill {
  const t = text.trim();
  return /^\+?[\d\s-]{6,}$/.test(t) ? { name: "", phone: t } : { name: t, phone: "" };
}

/** Adds a cash customer on the default tier without leaving the invoice or quotation. */
export function QuickAddCustomerDialog({
  prefill,
  onClose,
  onAdded,
}: {
  /** Open while set. */
  prefill: QuickAddPrefill | null;
  onClose: () => void;
  onAdded: (c: PickedCustomer) => void;
}) {
  return (
    <Dialog open={prefill !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* Remounted per opening, so each starts from its own prefill. */}
        {prefill && <QuickAddForm prefill={prefill} onClose={onClose} onAdded={onAdded} />}
      </DialogContent>
    </Dialog>
  );
}

function QuickAddForm({
  prefill,
  onClose,
  onAdded,
}: {
  prefill: QuickAddPrefill;
  onClose: () => void;
  onAdded: (c: PickedCustomer) => void;
}) {
  const [values, setValues] = useState({ ...prefill, businessName: "", address: "" });
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof values, v: string) => setValues((s) => ({ ...s, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await quickAddCustomerAction(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Customer added");
      onAdded(result.data);
    });
  }

  return (
    // The dialog is portalled, but React still bubbles its events to the editor's form: stop them
    // here so Enter or Ctrl+Enter adds the customer instead of saving the invoice.
    <form
      onSubmit={(e) => {
        e.stopPropagation();
        submit(e);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>New customer</DialogTitle>
        <DialogDescription>
          Added as a cash customer on the default price tier. An admin can add credit on the customer’s page.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="quick-add-name">Name</Label>
          <Input
            id="quick-add-name"
            required
            maxLength={120}
            autoFocus={!prefill.name}
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            aria-invalid={error?.field === "name" || undefined}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="quick-add-phone">Phone</Label>
          <Input
            id="quick-add-phone"
            type="tel"
            maxLength={40}
            autoFocus={Boolean(prefill.name)}
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="quick-add-business">Business name</Label>
          <Input
            id="quick-add-business"
            maxLength={160}
            value={values.businessName}
            onChange={(e) => set("businessName", e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="quick-add-address">Address</Label>
          <Input
            id="quick-add-address"
            maxLength={300}
            value={values.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add customer"}
        </Button>
      </DialogFooter>
    </form>
  );
}
