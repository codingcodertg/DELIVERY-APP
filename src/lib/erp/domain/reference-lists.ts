/**
 * The reference lists behind the order form: pickup points, dropoff sites, stores and accounts.
 *
 * These accumulate as reps hit "save for next time" while writing an order, so they arrive messy —
 * blank rows, the same site typed twice with different capitalisation, stray whitespace. Cleaning
 * happens on the way IN, once, rather than at every read site.
 */

export interface NamedLocation {
  name: string;
  address: string;
  /** Stores only: orders sold from here skip approval and are created already Approved. */
  auto_approve?: boolean;
  lat?: number | null;
  lng?: number | null;
}

export interface AccountEntry {
  name: string;
  contact: string;
  phone: string;
  /** A branch (internal) account: picking it defaults the order type to Intertienda. */
  intertienda?: boolean;
}

/**
 * Clean a list of named locations.
 *
 * Drops unnamed rows and keeps the FIRST of any duplicate name, compared case-insensitively.
 * First-wins matters: the earlier row is the one that has been in use, and is the one whose
 * geocoded pin (if any) has already been verified.
 */
export function normalizeLocations(rows: NamedLocation[]): NamedLocation[] {
  const seen = new Set<string>();
  const out: NamedLocation[] = [];

  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const cleaned: NamedLocation = { name, address: (r.address ?? "").trim() };
    if (r.auto_approve) cleaned.auto_approve = true;
    // A pin only means anything alongside the address it was verified for, and the editor clears
    // it when the address changes. Carried through as-is here.
    if (r.lat != null && r.lng != null) {
      cleaned.lat = r.lat;
      cleaned.lng = r.lng;
    }
    out.push(cleaned);
  }
  return out;
}

/** Same rules for accounts, keyed on the account name. */
export function normalizeAccounts(rows: AccountEntry[]): AccountEntry[] {
  const seen = new Set<string>();
  const out: AccountEntry[] = [];

  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      contact: (r.contact ?? "").trim(),
      phone: (r.phone ?? "").trim(),
      intertienda: !!r.intertienda,
    });
  }
  return out;
}

/**
 * How many orders reference each entry of a list, by the order field that stores its name.
 *
 * Shown next to each row so somebody about to delete one can see whether it is in use. Matched
 * case-insensitively, because the order was written from a free-text field.
 */
export function usageCounts(
  orders: Record<string, unknown>[],
  field: string,
  names: string[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n.toLowerCase(), 0);

  for (const o of orders) {
    const v = o[field];
    if (typeof v !== "string") continue;
    const key = v.trim().toLowerCase();
    const cur = counts.get(key);
    if (cur !== undefined) counts.set(key, cur + 1);
  }
  return counts;
}
