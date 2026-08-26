// Job positions. Kept in a PLAIN module (not the "use server" actions file):
// a "use server" file may only export async functions, so a const array there
// breaks the entire file at runtime.
export const POSITIONS = ["office", "sales", "warehouse", "manager", "owner"] as const;
export type Position = (typeof POSITIONS)[number];

/** The role a given position implies (position is the single source of truth). */
export function roleForPosition(position: Position): "employee" | "manager" | "owner" {
  return position === "owner" ? "owner" : position === "manager" ? "manager" : "employee";
}
