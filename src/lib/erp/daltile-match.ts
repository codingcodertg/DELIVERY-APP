// Daltile match ladder (shared by the job route + the run script).
//
//   1. sku        — ERP mpn exactly equals a warehouse external_sku        (0.99)
//   2. mpn        — a Daltile color code in the ERP mpn  ↔ warehouse code  (0.97)
//   3. name_code  — a Daltile color code in the ERP NAME ↔ warehouse code  (0.95)
//   4. name_size  — normalized name contains the warehouse color name + size match (0.50, suggestion)
//
// Tiers 1–3 are high-confidence (eligible to auto-confirm in the review UI);
// tier 4 is a manager-review suggestion. `external_sku` on the ref holds the
// Daltile COLOR CODE (the stable match key + the value backfilled into
// products.mpn on confirm). The card's display fields come from the warehouse.

export interface WareRow {
  product_id: string;
  external_sku: string | null;
  color_code: string | null;
  url: string;
  title: string;
  series_name: string | null;
  nominal_size: string | null;
  finish: string | null;
  color_name: string | null;
  specs: Record<string, unknown>;
  image_urls: string[] | null;
}
export interface ErpProduct { id: number; name: string; mpn: string | null; size_in: string | null }
export type MatchMethod = 'sku' | 'mpn' | 'name_code' | 'name_size';
export interface MatchRef {
  product_id: number;
  source: 'daltile';
  external_sku: string | null;
  external_url: string;
  external_title: string;
  series_name: string | null;
  nominal_size: string | null;
  finish: string | null;
  color_name: string | null;
  specs: Record<string, unknown>;
  image_urls: string[] | null;
  match_method: MatchMethod;
  match_confidence: number;
}
export interface TierCounts { sku: number; mpn: number; name_code: number; name_size: number; total: number }

const CONF: Record<MatchMethod, number> = { sku: 0.99, mpn: 0.97, name_code: 0.95, name_size: 0.5 };

export const normSize = (s: string | null | undefined) => (s || '').toUpperCase().replace(/[^0-9X]/g, '');
export const normName = (s: string | null | undefined) =>
  (s || '').toUpperCase()
    .replace(/\*[^*]*\*/g, ' ').replace(/\([A-Z0-9]{1,3}\)/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*S(Q)?\s?F(T)?\b/g, ' ').replace(/\b\d+\s*[X×]\s*\d+\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sizeFromName = (n: string) => {
  const m = n.toUpperCase().match(/\b(\d+)\s*[X×]\s*(\d+)\b/);
  return m ? `${m[1]}X${m[2]}` : '';
};
// candidate Daltile color-code tokens (e.g. CT76, ME24, D311, 0Q41, 1500)
const codeTokens = (s: string): string[] =>
  [...new Set((s.toUpperCase().match(/\b\d?[A-Z]{1,2}\d{2,3}\b|\b\d{4}\b/g) || []))];

export interface Indexes {
  bySku: Map<string, WareRow>;
  byCode: Map<string, WareRow[]>;
  bySize: Map<string, Array<{ cc: string; row: WareRow }>>; // size → [{normName(color_name), row}]
}
export function buildIndexes(ware: WareRow[]): Indexes {
  const bySku = new Map<string, WareRow>();
  const byCode = new Map<string, WareRow[]>();
  const bySize = new Map<string, Array<{ cc: string; row: WareRow }>>();
  for (const w of ware) {
    if (w.external_sku) bySku.set(w.external_sku.toUpperCase(), w);
    if (w.color_code) {
      const c = w.color_code.toUpperCase();
      if (!byCode.has(c)) byCode.set(c, []);
      byCode.get(c)!.push(w);
    }
    const cc = normName(w.color_name);
    if (cc.length >= 6 && w.nominal_size) {
      const sz = normSize(w.nominal_size);
      if (!bySize.has(sz)) bySize.set(sz, []);
      bySize.get(sz)!.push({ cc, row: w });
    }
  }
  return { bySku, byCode, bySize };
}

// pick the best warehouse variant for a color code (prefer a size match, then one with imagery)
function pickByCode(rows: WareRow[], size: string): WareRow {
  return rows.find(r => normSize(r.nominal_size) === size && size)
    ?? rows.find(r => (r.image_urls?.length ?? 0) > 0)
    ?? rows[0];
}
function ref(p: ErpProduct, w: WareRow, method: MatchMethod): MatchRef {
  return {
    product_id: p.id, source: 'daltile',
    external_sku: w.color_code, external_url: w.url, external_title: w.title,
    series_name: w.series_name, nominal_size: w.nominal_size, finish: w.finish,
    color_name: w.color_name, specs: w.specs, image_urls: w.image_urls,
    match_method: method, match_confidence: CONF[method],
  };
}

export function matchOne(p: ErpProduct, idx: Indexes): MatchRef | null {
  const size = normSize(p.size_in) || normSize(sizeFromName(p.name));
  const umpn = (p.mpn || '').toUpperCase().trim();

  // 1. full sku
  if (umpn && idx.bySku.has(umpn)) return ref(p, idx.bySku.get(umpn)!, 'sku');
  // 2. color code in the mpn
  for (const c of codeTokens(umpn)) if (idx.byCode.has(c)) return ref(p, pickByCode(idx.byCode.get(c)!, size), 'mpn');
  // 3. color code embedded in the product NAME
  for (const c of codeTokens(p.name)) if (idx.byCode.has(c)) return ref(p, pickByCode(idx.byCode.get(c)!, size), 'name_code');
  // 4. normalized name + size (suggestion)
  if (size && idx.bySize.has(size)) {
    const en = normName(p.name);
    let best: { cc: string; row: WareRow } | null = null;
    for (const cand of idx.bySize.get(size)!) {
      if (en.includes(cand.cc) && (!best || cand.cc.length > best.cc.length)) best = cand;
    }
    if (best) return ref(p, best.row, 'name_size');
  }
  return null;
}

export function matchAll(ware: WareRow[], erp: ErpProduct[]): { refs: MatchRef[]; counts: TierCounts } {
  const idx = buildIndexes(ware);
  const refs: MatchRef[] = [];
  const counts: TierCounts = { sku: 0, mpn: 0, name_code: 0, name_size: 0, total: 0 };
  for (const p of erp) {
    const r = matchOne(p, idx);
    if (!r) continue;
    refs.push(r);
    counts[r.match_method]++;
    counts.total++;
  }
  return { refs, counts };
}
