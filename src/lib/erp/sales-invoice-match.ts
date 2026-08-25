// Sales-invoice match ladder (shared by the dry-run script + the future Phase-2
// ingestion job). Pure — no DB. Given invoice lines + the ERP catalog (products
// + vendor_skus + sku_aliases), resolve each raw item code/description to a
// product_id, returning match_method + confidence.
//
//   1. sku         raw code → products.sku       (exact, normalized/trim)  0.99
//   2. mpn         raw code → products.mpn        (exact, normalized/trim)  0.97
//   3. vendor_sku  raw code → vendor_skus         (exact, normalized/trim)  0.96
//   4. alias       raw code → sku_aliases.old_sku (exact, normalized/trim)  0.95
//   5. name_size   normalized description tokens + size  (SUGGESTION)       computed
//
// Tiers 1–4 are high-confidence (auto_eligible — a Phase-2 UI may auto-confirm).
// Tier 5 is always a manager-review suggestion (auto_eligible = false), because
// description+size can be ambiguous (see sales-invoice-datamodel.md, conclusion 2).
//
// The exact tiers normalize code (upper + strip non-alphanumerics) so they
// tolerate case/spacing/punctuation — but NOT OCR character swaps (I↔1, D↔I) or
// dropped leading zeros, which is the point: those miss on code and fall to
// name+size exactly as the real invoices do.

export type MatchMethod = 'sku' | 'mpn' | 'vendor_sku' | 'alias' | 'name_size';

export interface InvoiceLine {
  line_no: number;
  raw_item_code: string | null;
  raw_description: string | null;
  raw_uom?: string | null;
  qty?: number | null;
  unit_price?: number | null;
  amount?: number | null;
}
export interface CatalogProduct {
  id: number;
  sku: string | null;
  name: string | null;
  mpn: string | null;
  size_in: string | null;
}
export interface CodeRef { code: string; product_id: number }

export interface LineMatch {
  line_no: number;
  product_id: number | null;
  matched_sku: string | null;
  matched_name: string | null;
  match_method: MatchMethod | null;
  match_confidence: number;   // 0 when unmatched
  auto_eligible: boolean;     // true only for the exact code tiers
  score: number | null;       // name_size token-containment (0–1), else null
  alternatives: number;       // # of other near-tie name_size candidates (ambiguity signal)
}

const CONF: Record<Exclude<MatchMethod, 'name_size'>, number> = {
  sku: 0.99, mpn: 0.97, vendor_sku: 0.96, alias: 0.95,
};
// name_size: containment c (0..1) → confidence in [0.40, 0.85]; never auto.
const NAME_SIZE_MIN_CONTAINMENT = 0.6;
const NAME_SIZE_MIN_TOKENS = 2;
const nameSizeConf = (c: number) => Math.round((0.4 + 0.45 * c) * 1000) / 1000;

// ── normalization ───────────────────────────────────────────────────────────
export const normCode = (s: string | null | undefined) =>
  (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// common tile color-spelling + abbreviation synonyms (safe, bidirectional)
const SYN: Array<[RegExp, string]> = [
  [/\bGREY\b/g, 'GRAY'],
];
// units / packaging / coverage noise tokens to drop
const STOP = new Set(['SF', 'SQFT', 'SQ', 'FT', 'LB', 'LBS', 'BX', 'BG', 'PC', 'PCS',
  'EA', 'EACH', 'CT', 'CASE', 'BOX', 'BAG', 'PIECE', 'PALLET', 'CTN']);

export const sizeOf = (s: string | null | undefined): string => {
  const m = (s || '').toUpperCase().match(/\b(\d+(?:\.\d+)?)\s*[X×]\s*(\d+(?:\.\d+)?)\b/);
  return m ? `${m[1]}X${m[2]}` : '';
};

// A "#NNN" color/shade number (grouts, caulks: "Uni Texcolor Grout #012"). Like
// size, it is a hard discriminator: two products that differ on it are different
// colors, so a mismatch must NOT be matched (it would be a wrong-color suggestion).
export const colorNumOf = (s: string | null | undefined): string => {
  const m = (s || '').match(/#\s*(\d{2,4})\b/);
  return m ? m[1] : '';
};

// normalized, size/coverage/grade-stripped name → meaningful token set
export function nameTokens(s: string | null | undefined): Set<string> {
  let t = (s || '').toUpperCase();
  for (const [re, rep] of SYN) t = t.replace(re, rep);
  t = t
    .replace(/\([A-Z0-9]{1,3}\)/g, ' ')                 // grade markers (M)/(G)
    .replace(/#/g, ' ')                                  // # before color number
    .replace(/\b\d+(?:\.\d+)?\s*S(?:Q)?\s?F(?:T)?\b/g, ' ') // coverage "15.5 SF"
    .replace(/\b\d+(?:\.\d+)?\s*LBS?\b/g, ' ')           // weight "25 LBS"
    .replace(/\b\d+(?:\.\d+)?\s*[X×]\s*\d+(?:\.\d+)?\b/g, ' ') // NxN size
    .replace(/[^A-Z0-9 ]/g, ' ')                         // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
  const out = new Set<string>();
  for (const tok of t.split(' ')) {
    if (!tok || STOP.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

// ── index ───────────────────────────────────────────────────────────────────
export interface CatalogIndex {
  products: CatalogProduct[];
  bySku: Map<string, CatalogProduct>;
  byMpn: Map<string, CatalogProduct>;
  byVendorSku: Map<string, number>;
  byAlias: Map<string, number>;
  byId: Map<number, CatalogProduct>;
  prepared: Array<{ p: CatalogProduct; tokens: Set<string>; size: string; colorNum: string }>;
}

export function buildIndex(
  products: CatalogProduct[],
  vendorSkus: CodeRef[] = [],
  aliases: CodeRef[] = [],
): CatalogIndex {
  const bySku = new Map<string, CatalogProduct>();
  const byMpn = new Map<string, CatalogProduct>();
  const byVendorSku = new Map<string, number>();
  const byAlias = new Map<string, number>();
  const byId = new Map<number, CatalogProduct>();
  const prepared: CatalogIndex['prepared'] = [];
  for (const p of products) {
    byId.set(p.id, p);
    const sk = normCode(p.sku); if (sk && !bySku.has(sk)) bySku.set(sk, p);
    const mp = normCode(p.mpn); if (mp && !byMpn.has(mp)) byMpn.set(mp, p);
    prepared.push({ p, tokens: nameTokens(p.name), size: sizeOf(p.size_in) || sizeOf(p.name), colorNum: colorNumOf(p.name) });
  }
  for (const v of vendorSkus) { const c = normCode(v.code); if (c && !byVendorSku.has(c)) byVendorSku.set(c, v.product_id); }
  for (const a of aliases)    { const c = normCode(a.code); if (c && !byAlias.has(c))    byAlias.set(c, a.product_id); }
  return { products, bySku, byMpn, byVendorSku, byAlias, byId, prepared };
}

// ── match one line ──────────────────────────────────────────────────────────
function exact(idx: CatalogIndex, code: string): { p: CatalogProduct; method: Exclude<MatchMethod, 'name_size'> } | null {
  const c = normCode(code);
  if (!c) return null;
  if (idx.bySku.has(c)) return { p: idx.bySku.get(c)!, method: 'sku' };
  if (idx.byMpn.has(c)) return { p: idx.byMpn.get(c)!, method: 'mpn' };
  if (idx.byVendorSku.has(c)) { const p = idx.byId.get(idx.byVendorSku.get(c)!); if (p) return { p, method: 'vendor_sku' }; }
  if (idx.byAlias.has(c))     { const p = idx.byId.get(idx.byAlias.get(c)!);     if (p) return { p, method: 'alias' }; }
  return null;
}

function nameSize(idx: CatalogIndex, line: InvoiceLine): { p: CatalogProduct; score: number; alternatives: number } | null {
  const lt = nameTokens(line.raw_description);
  if (lt.size < NAME_SIZE_MIN_TOKENS) return null;
  const lsz = sizeOf(line.raw_description);
  const lcn = colorNumOf(line.raw_description);
  let best: { p: CatalogProduct; score: number } | null = null;
  let near = 0;
  for (const { p, tokens, size, colorNum } of idx.prepared) {
    if (lsz && size && lsz !== size) continue;          // size conflict → skip
    if (lcn && colorNum && lcn !== colorNum) continue;  // color-number conflict (#012 ≠ #460) → skip
    let hit = 0;
    for (const tok of lt) if (tokens.has(tok)) hit++;
    if (hit < NAME_SIZE_MIN_TOKENS) continue;
    let c = hit / lt.size;                                // containment of line tokens
    if (lsz && size && lsz === size) c = Math.min(1, c + 0.1); // size agreement bonus
    if (c < NAME_SIZE_MIN_CONTAINMENT) continue;
    if (!best || c > best.score || (c === best.score && tokens.size < nameTokens(best.p.name).size)) {
      if (best && Math.abs(c - best.score) <= 0.1) near++;
      best = { p, score: c };
    } else if (Math.abs(c - best.score) <= 0.1) {
      near++;
    }
  }
  return best ? { p: best.p, score: Math.min(1, best.score), alternatives: near } : null;
}

export function matchLine(line: InvoiceLine, idx: CatalogIndex): LineMatch {
  const base: LineMatch = {
    line_no: line.line_no, product_id: null, matched_sku: null, matched_name: null,
    match_method: null, match_confidence: 0, auto_eligible: false, score: null, alternatives: 0,
  };
  const e = exact(idx, line.raw_item_code || '');
  if (e) {
    return { ...base, product_id: e.p.id, matched_sku: e.p.sku, matched_name: e.p.name,
      match_method: e.method, match_confidence: CONF[e.method], auto_eligible: true };
  }
  const ns = nameSize(idx, line);
  if (ns) {
    return { ...base, product_id: ns.p.id, matched_sku: ns.p.sku, matched_name: ns.p.name,
      match_method: 'name_size', match_confidence: nameSizeConf(ns.score),
      auto_eligible: false, score: Math.round(ns.score * 1000) / 1000, alternatives: ns.alternatives };
  }
  return base;
}

export interface MatchSummary {
  total: number;
  matched: number;
  unmatched: number;
  match_rate: number;            // matched / total
  auto_eligible: number;         // high-confidence (code-tier) count
  suggestions: number;           // name_size count
  byMethod: Record<MatchMethod, number>;
}

export function matchInvoice(lines: InvoiceLine[], idx: CatalogIndex): { rows: LineMatch[]; summary: MatchSummary } {
  const rows = lines.map(l => matchLine(l, idx));
  const byMethod: Record<MatchMethod, number> = { sku: 0, mpn: 0, vendor_sku: 0, alias: 0, name_size: 0 };
  let matched = 0, auto = 0, sugg = 0;
  for (const r of rows) {
    if (r.match_method) { matched++; byMethod[r.match_method]++; }
    if (r.auto_eligible) auto++;
    if (r.match_method === 'name_size') sugg++;
  }
  return {
    rows,
    summary: {
      total: rows.length, matched, unmatched: rows.length - matched,
      match_rate: rows.length ? Math.round((matched / rows.length) * 1000) / 1000 : 0,
      auto_eligible: auto, suggestions: sugg, byMethod,
    },
  };
}
