"use client";

import { ReferenceEditor } from "@/components/forms/reference-editor";
import { upsertSupplierAction } from "@/server/actions/grn";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  tin: string | null;
  isActive: boolean;
};

export function SupplierEditor({ rows }: { rows: Supplier[] }) {
  return (
    <ReferenceEditor
      noun="Supplier"
      rows={rows}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "phone", label: "Phone" },
        { key: "address", label: "Address" },
        { key: "tin", label: "TIN" },
        { key: "isActive", label: "Active", type: "checkbox", defaultValue: "true" },
      ]}
      display={(r) =>
        [r.name, r.phone].filter(Boolean).join(", ") + (r.isActive ? "" : " (inactive)")
      }
      save={(v) =>
        upsertSupplierAction({
          id: v.id || undefined,
          name: v.name,
          phone: v.phone,
          address: v.address,
          tin: v.tin,
          isActive: v.isActive === "true",
        })
      }
    />
  );
}
