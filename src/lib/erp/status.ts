// Status → semantic pill colors (design-direction.md). Kept separate from the clay brand accent.
export const PILL = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-sky-200 bg-sky-50 text-sky-700",
  gray: "border-slate-200 bg-slate-100 text-slate-600",
  slate: "border-slate-200 bg-slate-50 text-slate-500",
} as const;

/** commercial_status: active|special_order|discontinued|inactive */
export function commercialStatusClass(s: string): string {
  switch (s) {
    case "active":
      return PILL.green;
    case "special_order":
      return PILL.amber;
    case "discontinued":
      return PILL.slate;
    case "inactive":
      return PILL.red;
    default:
      return PILL.gray;
  }
}

/** record_status: draft|pending_approval|published|archived */
export function recordStatusClass(s: string): string {
  switch (s) {
    case "published":
      return PILL.green;
    case "draft":
      return PILL.gray;
    case "pending_approval":
      return PILL.blue;
    case "archived":
      return PILL.slate;
    default:
      return PILL.gray;
  }
}

export const label = (s: string | null | undefined): string => (s ? s.replace(/_/g, " ") : "—");

// ── Etiquetas en dos idiomas (G-10, D-204) ──────────────────────────────────
// Los estados comercial y de registro, los tipos de producto y los tipos de solicitud son
// enumerados fijos del código (no configurables), así que su etiqueta es texto de pantalla. La
// librería NO lee el idioma: devuelve el par {en, es} y el componente elige con su t(). Un valor
// que el mapa no conozca cae al `label()` de siempre en los dos idiomas.
export type Pair = { en: string; es: string };
const LABELS: Record<string, Pair> = {
  // commercial_status
  active: { en: "Active", es: "Activo" },
  special_order: { en: "Special order", es: "Pedido especial" },
  discontinued: { en: "Discontinued", es: "Descontinuado" },
  inactive: { en: "Inactive", es: "Inactivo" },
  // record_status
  draft: { en: "Draft", es: "Borrador" },
  pending_approval: { en: "Pending approval", es: "Pendiente de aprobación" },
  published: { en: "Published", es: "Publicado" },
  archived: { en: "Archived", es: "Archivado" },
  // product_type
  tile: { en: "Tile", es: "Azulejo" },
  trim: { en: "Trim", es: "Remate" },
  setting_material: { en: "Setting material", es: "Material de instalación" },
  tool: { en: "Tool", es: "Herramienta" },
  accessory: { en: "Accessory", es: "Accesorio" },
  other: { en: "Other", es: "Otro" },
  // request type
  new: { en: "New", es: "Nuevo" },
  edit: { en: "Edit", es: "Edición" },
  reactivate: { en: "Reactivate", es: "Reactivar" },
  deactivate: { en: "Deactivate", es: "Desactivar" },
  // request status
  pending: { en: "Pending", es: "Pendiente" },
  approved: { en: "Approved", es: "Aprobada" },
  rejected: { en: "Rejected", es: "Rechazada" },
};
export function statusLabel(s: string | null | undefined): Pair {
  const known = s ? LABELS[s] : undefined;
  if (known) return known;
  const raw = label(s);
  return { en: raw, es: raw };
}
