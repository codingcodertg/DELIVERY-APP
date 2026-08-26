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
