"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";

export type FieldSpec = {
  key: string;
  label: string;
  type?: "text" | "number" | "checkbox";
  required?: boolean;
  /** Value for a new record; checkboxes use "true" / "false". */
  defaultValue?: string;
};

type Value = string | number | boolean | null;

/** List of simple records with an add/edit dialog (categories, brands, bike models). */
export function ReferenceEditor({
  noun,
  rows,
  fields,
  display,
  save,
}: {
  noun: string;
  rows: ({ id: string } & Record<string, Value>)[];
  fields: FieldSpec[];
  display: (row: Record<string, Value>) => string;
  save: (values: Record<string, string>) => Promise<ActionResult<{ id: string }>>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (row?: (typeof rows)[number]) => {
    setError(null);
    setEditing(
      Object.fromEntries([
        ["id", row?.id ?? ""],
        ...fields.map((f) => [
          f.key,
          row ? (row[f.key] == null ? "" : String(row[f.key])) : (f.defaultValue ?? ""),
        ]),
      ]),
    );
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    startTransition(async () => {
      const result = await save(editing);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(`${noun} saved`);
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-3 flex justify-end">
        <Button onClick={() => open()}>
          <Plus /> Add {noun.toLowerCase()}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Nothing here yet. Add the first {noun.toLowerCase()}.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{display(row)}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${display(row)}`} onClick={() => open(row)}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{editing?.id ? `Edit ${noun.toLowerCase()}` : `Add ${noun.toLowerCase()}`}</DialogTitle>
            </DialogHeader>
            {fields.map((f, i) =>
              f.type === "checkbox" ? (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={editing?.[f.key] === "true"}
                    onCheckedChange={(c) => setEditing((v) => (v ? { ...v, [f.key]: String(Boolean(c)) } : v))}
                  />
                  {f.label}
                </label>
              ) : (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={`ref-${f.key}`}>{f.label}</Label>
                <Input
                  id={`ref-${f.key}`}
                  type={f.type ?? "text"}
                  required={f.required}
                  autoFocus={i === 0}
                  value={editing?.[f.key] ?? ""}
                  onChange={(e) => setEditing((v) => (v ? { ...v, [f.key]: e.target.value } : v))}
                />
              </div>
              ),
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
