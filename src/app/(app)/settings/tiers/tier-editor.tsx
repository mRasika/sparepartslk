"use client";

import { AlertTriangle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { describeRule, ROUND_TO_OPTIONS, rulePrice } from "@/lib/tier-rule";
import { createTierAction, updateTierAction } from "@/server/actions/tiers";
import type { TierStatsRow } from "@/server/services/tiers";

type Draft = { name: string; discountPct: string; roundTo: string };

const toDraft = (t: TierStatsRow): Draft => ({
  name: t.name,
  discountPct: String(Number(t.discountPct)),
  roundTo: String(t.roundTo),
});

const roundLabel = (n: number) => (n === 0 ? "No rounding" : `Nearest Rs ${n}`);

export function TierEditor({ tiers }: { tiers: TierStatsRow[] }) {
  const defaultTier = tiers.find((t) => t.isDefault);
  return (
    <div className="grid gap-4">
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tier</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead className="hidden text-right md:table-cell">Customers</TableHead>
              <TableHead className="hidden text-right md:table-cell">Typed prices</TableHead>
              <TableHead className="text-right">Below cost</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.map((t) => (
              <TierRow key={t.id} tier={t} defaultName={defaultTier?.name ?? "Retail"} />
            ))}
          </TableBody>
        </Table>
      </div>
      <NewTier defaultName={defaultTier?.name ?? "Retail"} />
      <p className="text-xs text-muted-foreground">
        Example: with a rule of 10% and nearest Rs 10, a part at Rs {formatMoney("1234")} {defaultTier?.name ?? "Retail"}{" "}
        sells for Rs {formatMoney(rulePrice("1234", "10", 10))}. Invoices already issued keep their prices.
      </p>
    </div>
  );
}

function RuleFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Input
          aria-label="Percent below the base price"
          id={`${idPrefix}-pct`}
          inputMode="decimal"
          value={draft.discountPct}
          onChange={(e) => onChange({ ...draft, discountPct: e.target.value })}
          className="w-20 text-right tabular-nums"
        />
        <span className="text-sm text-muted-foreground">% off</span>
      </div>
      <NativeSelect
        aria-label="Rounding"
        value={draft.roundTo}
        onChange={(e) => onChange({ ...draft, roundTo: e.target.value })}
      >
        {ROUND_TO_OPTIONS.map((n) => (
          <NativeSelectOption key={n} value={String(n)}>
            {roundLabel(n)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

function TierRow({ tier, defaultName }: { tier: TierStatsRow; defaultName: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => toDraft(tier));
  const [pending, startTransition] = useTransition();
  const initial = toDraft(tier);
  const changed = draft.name !== initial.name || draft.discountPct !== initial.discountPct || draft.roundTo !== initial.roundTo;

  function save() {
    startTransition(async () => {
      const result = await updateTierAction(tier.id, { ...draft, roundTo: Number(draft.roundTo) });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`${draft.name} saved`);
      router.refresh();
    });
  }

  return (
    <TableRow>
      <TableCell>
        <Input
          aria-label={`Name of ${tier.name}`}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="w-36"
        />
      </TableCell>
      <TableCell>
        {tier.isDefault ? (
          <span className="text-sm text-muted-foreground">Base price, typed on each part</span>
        ) : (
          <div className="grid gap-1">
            <RuleFields draft={draft} onChange={setDraft} idPrefix={tier.id} />
            <span className="text-xs text-muted-foreground">
              {describeRule(defaultName, draft.discountPct || "0", Number(draft.roundTo))}
            </span>
          </div>
        )}
      </TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">{tier.customerCount}</TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">{tier.typedPriceCount}</TableCell>
      <TableCell className="text-right tabular-nums">
        {tier.belowCostCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-destructive" title="Active parts this tier sells below average cost">
            <AlertTriangle className="size-3.5" aria-hidden /> {tier.belowCostCount}
          </span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" disabled={!changed || pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function NewTier({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ name: "", discountPct: "0", roundTo: "0" });
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus /> Add tier
        </Button>
      </div>
    );
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createTierAction({ ...draft, roundTo: Number(draft.roundTo) });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`${draft.name} added`);
      setOpen(false);
      setDraft({ name: "", discountPct: "0", roundTo: "0" });
      router.refresh();
    });
  }

  return (
    <form onSubmit={create} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <Input
        aria-label="New tier name"
        placeholder="Tier name, e.g. Fleet"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        className="w-44"
        required
        autoFocus
      />
      <RuleFields draft={draft} onChange={setDraft} idPrefix="new" />
      <span className="text-xs text-muted-foreground">{describeRule(defaultName, draft.discountPct || "0", Number(draft.roundTo))}</span>
      <div className="ml-auto flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !draft.name.trim()}>
          {pending ? "Adding…" : "Add tier"}
        </Button>
      </div>
    </form>
  );
}
