"use client";

import {
  upsertBrandAction,
  upsertCategoryAction,
  upsertVehicleModelAction,
} from "@/server/actions/catalog";
import { ReferenceEditor } from "./reference-editor";

type Named = { id: string; name: string };
type VehicleModel = {
  id: string;
  make: string;
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  label: string;
};

const NAME_FIELDS = [{ key: "name", label: "Name", required: true }];

export function CategoryEditor({ rows }: { rows: Named[] }) {
  return (
    <ReferenceEditor
      noun="Category"
      rows={rows}
      fields={NAME_FIELDS}
      display={(r) => String(r.name)}
      save={(v) => upsertCategoryAction({ id: v.id || undefined, name: v.name })}
    />
  );
}

export function BrandEditor({ rows }: { rows: Named[] }) {
  return (
    <ReferenceEditor
      noun="Brand"
      rows={rows}
      fields={NAME_FIELDS}
      display={(r) => String(r.name)}
      save={(v) => upsertBrandAction({ id: v.id || undefined, name: v.name })}
    />
  );
}

export function VehicleModelEditor({ rows }: { rows: VehicleModel[] }) {
  return (
    <ReferenceEditor
      noun="Bike model"
      rows={rows}
      fields={[
        { key: "make", label: "Make", required: true },
        { key: "model", label: "Model", required: true },
        { key: "yearFrom", label: "From year", type: "number" },
        { key: "yearTo", label: "To year", type: "number" },
      ]}
      display={(r) => String(r.label)}
      save={(v) =>
        upsertVehicleModelAction({
          id: v.id || undefined,
          make: v.make,
          model: v.model,
          yearFrom: v.yearFrom ? Number(v.yearFrom) : null,
          yearTo: v.yearTo ? Number(v.yearTo) : null,
        })
      }
    />
  );
}
