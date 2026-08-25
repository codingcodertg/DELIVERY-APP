// PO match ladder (#31), pure form: MPN exact (case-insensitive) → name contains.
// Mirrors lib/actions.ts matchPoLines so it can be unit-tested without a DB.

export type Candidate = { id: number; sku: string; name: string; mpn: string | null };
export type LadderLine = { mpn?: string | null; name?: string | null };

export function matchByLadder<C extends Candidate>(line: LadderLine, candidates: C[]): C | null {
  const mpn = line.mpn?.trim().toUpperCase();
  if (mpn) {
    const hit = candidates.find((c) => (c.mpn ?? "").trim().toUpperCase() === mpn);
    if (hit) return hit;
  }
  const name = line.name?.trim().toLowerCase();
  if (name) {
    const hit = candidates.find((c) => c.name.toLowerCase().includes(name));
    if (hit) return hit;
  }
  return null;
}
