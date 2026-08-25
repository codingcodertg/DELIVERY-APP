// PO / proforma document parsing (M1.5 PO-upload). Framework-free so it unit-tests without a DB.
//
// The killer feature is the PO↔acknowledgment discrepancy matcher (DB: po_recon_rows). This module
// only structures a pasted document into the {header, lines} shape the upsert RPCs accept; a manager
// always reviews/edits the parsed result before it's saved, and CSV / manual entry are the guaranteed
// fallbacks for any layout the parser can't read.
//
// Design: a parser-PER-FORMAT registry (`PARSERS`) so other suppliers can be added later. The PLG
// (Lamosa) parsers target `pdftotext -layout` output — the spatially-aligned text the meeting called
// out. Line items are parsed by a token heuristic (anchor on the MPN + the unit word, then classify
// the numeric tokens positionally) which is robust to column spacing and even to PDF copy-paste
// reordering; header fields use labeled same-line regexes. Anything not found becomes a `warning`.

export const UNIT_WORDS = [
  "BOX", "BX", "CJ", "CAJA", "PI2", "SF", "SQFT", "FT2", "M2", "EA", "PC", "PCS", "PZA",
  "CTN", "CASE", "PALLET", "PLT", "ROLL", "LF", "LM", "PIECE", "UN",
];

export type ParsedPoHeader = {
  po_number: string | null;
  vendor_name: string | null;
  po_date: string | null; // ISO yyyy-mm-dd
  buyer_user: string | null;
  currency: string | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  total: number | null;
};
export type ParsedPoLine = {
  line_no: number | null;
  vendor_item_no: string | null; // MPN
  description: string | null;
  qty: number | null;
  uom: string | null;
  unit_rate: number | null;
  amount: number | null;
};
export type ParsedAckHeader = {
  ack_document_no: string | null;
  po_number: string | null;
  vendor_name: string | null;
  ack_date: string | null;
  order_type: string | null;
  customer_no: string | null;
  currency: string | null;
  incoterm: string | null;
  payment_terms: string | null;
  salesperson: string | null;
  specifier: string | null;
  ship_to_address: string | null;
  merchandise_value: number | null;
  handling: number | null;
  handling_bonus: number | null;
  freight: number | null;
  subtotal: number | null;
  iva_pct: number | null;
  iva_amount: number | null;
  total: number | null;
  special_instructions: string | null;
};
export type ParsedAckLine = {
  line_no: number | null;
  item_no: string | null; // MPN
  customer_item_no: string | null;
  description: string | null;
  uom: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  boxes: number | null;
  weight_kg: number | null;
  weight_lbs: number | null;
  pallet_factor_m2: number | null;
  pallets: number | null;
};

export type ParsedPo = { kind: "po"; header: ParsedPoHeader; lines: ParsedPoLine[]; warnings: string[] };
export type ParsedAck = { kind: "ack"; header: ParsedAckHeader; lines: ParsedAckLine[]; warnings: string[] };
export type ParsedDoc = ParsedPo | ParsedAck;

export interface DocParser {
  id: string;
  label: string;
  /** Cheap signature check: can this parser handle this text? */
  detect(text: string): boolean;
  parse(text: string): ParsedDoc;
}

// ---- shared helpers ---------------------------------------------------------------------------

/** A bare token that is purely a (possibly $/comma/%-decorated) number — excludes sizes like 8X36. */
export function isNumericToken(tok: string): boolean {
  return /^[$]?-?[\d,]+(\.\d+)?%?$/.test(tok) && /\d/.test(tok);
}

/** Parse one numeric token/string to a number, tolerating $, commas, %, surrounding spaces. */
export function num(s: string | null | undefined): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/[,$%\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function isUnitWord(tok: string): boolean {
  return UNIT_WORDS.includes(tok.trim().toUpperCase());
}

/** MPN-like token: has ≥2 letters and ≥1 digit, all uppercase alphanumerics, length ≥5 (e.g.
 *  ATRANEW19CI, PMONNUE19CI). Rejects unit words, sizes (8X36), grades (1A), and plain words. */
export function isMpnToken(tok: string): boolean {
  if (tok.length < 5) return false;
  if (!/^[A-Z0-9]+$/.test(tok)) return false;
  if (!/[A-Z]/.test(tok) || !/\d/.test(tok)) return false;
  if ((tok.match(/[A-Z]/g) ?? []).length < 2) return false;
  if (isUnitWord(tok)) return false;
  return true;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const yyyy = y < 100 ? 2000 + y : y;
  return `${yyyy}-${pad2(m)}-${pad2(d)}`;
}
/** US M/D/Y (PO header — e.g. 6/5/2026). */
export function parseUsDate(s: string | null | undefined): string | null {
  const m = String(s ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  return m ? toIso(+m[3], +m[1], +m[2]) : null;
}
/** European D.M.Y (PLG ack — e.g. 10.06.2026 = 10 June 2026). */
export function parseEuDate(s: string | null | undefined): string | null {
  const m = String(s ?? "").match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  return m ? toIso(+m[3], +m[2], +m[1]) : null;
}

function firstGroup(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m && m[1] != null ? m[1].trim() : null;
}
/** The LAST capture of a repeated pattern (e.g. the grand "Total", below the line "Total" column). */
function lastGroup(text: string, reSource: string, flags = "gi"): string | null {
  const re = new RegExp(reSource, flags);
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(text)) !== null) last = m[1]?.trim() ?? last;
  return last;
}

// ---- line-item parsers (token heuristic) ------------------------------------------------------

/** PO line: `<MPN> <description…> <QTY> <UOM> <RATE> <AMOUNT>` in any column order. Anchors on the
 *  MPN and the unit word; QTY is the number adjacent to the unit, then RATE, AMOUNT are the trailing
 *  numbers; description is the leftover (non-numeric, non-MPN, non-unit) tokens (keeps sizes 8X36). */
export function parsePoLine(line: string): ParsedPoLine | null {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (toks.length < 4) return null;
  const mpnIdx = toks.findIndex(isMpnToken);
  if (mpnIdx === -1) return null;

  const uomIdx = toks.findIndex((t, i) => i > mpnIdx && isUnitWord(t));
  const nums = toks.map((t, i) => ({ i, t })).filter((x) => isNumericToken(x.t));
  if (nums.length < 2) return null;

  let qty: number | null = null;
  let qtyIdx = -1;
  if (uomIdx >= 0) {
    const before = nums.filter((x) => x.i < uomIdx);
    if (before.length) { qtyIdx = before[before.length - 1].i; qty = num(before[before.length - 1].t); }
  }
  if (qty == null) {
    const after = nums.filter((x) => x.i > mpnIdx);
    if (after.length) { qtyIdx = after[0].i; qty = num(after[0].t); }
  }

  const rest = nums.filter((x) => x.i !== qtyIdx);
  let unit_rate: number | null = null;
  let amount: number | null = null;
  if (rest.length >= 2) { amount = num(rest[rest.length - 1].t); unit_rate = num(rest[rest.length - 2].t); }
  else if (rest.length === 1) { amount = num(rest[0].t); unit_rate = amount != null && qty ? amount / qty : null; }

  const numIdx = new Set(nums.map((x) => x.i));
  const description =
    toks.filter((_, i) => i !== mpnIdx && i !== uomIdx && !numIdx.has(i)).join(" ").trim() || null;

  return {
    line_no: null,
    vendor_item_no: toks[mpnIdx],
    description,
    qty,
    uom: uomIdx >= 0 ? toks[uomIdx].toUpperCase() : null,
    unit_rate,
    amount,
  };
}

/** Ack line: `<LINE> <MPN> <description…> <UM> <QTY> <PRICE> <AMOUNT> <BOXES> <KG> <LBS> <PALLET-F>
 *  <PALLETS>`. Anchors on MPN + unit word; the 8 numbers AFTER the unit map positionally (the "M2"
 *  unit label after pallet-factor is skipped as non-numeric). */
export function parseAckLine(line: string): ParsedAckLine | null {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  const mpnIdx = toks.findIndex(isMpnToken);
  if (mpnIdx === -1) return null;
  const uomIdx = toks.findIndex((t, i) => i > mpnIdx && isUnitWord(t));
  if (uomIdx === -1) return null;

  const line_no = mpnIdx > 0 && /^\d+$/.test(toks[0]) ? parseInt(toks[0], 10) : null;
  const after = toks.slice(uomIdx + 1).filter(isNumericToken).map((t) => num(t));
  const [quantity, unit_price, amount, boxes, weight_kg, weight_lbs, pallet_factor_m2, pallets] = after;
  const description =
    toks.slice(mpnIdx + 1, uomIdx).filter((t) => !isNumericToken(t)).join(" ").trim() || null;

  return {
    line_no,
    item_no: toks[mpnIdx],
    customer_item_no: null,
    description,
    uom: toks[uomIdx].toUpperCase(),
    quantity: quantity ?? null,
    unit_price: unit_price ?? null,
    amount: amount ?? null,
    boxes: boxes ?? null,
    weight_kg: weight_kg ?? null,
    weight_lbs: weight_lbs ?? null,
    pallet_factor_m2: pallet_factor_m2 ?? null,
    pallets: pallets ?? null,
  };
}

// ---- PLG (Lamosa) parsers ---------------------------------------------------------------------

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
}

/** PO number sits in the "P.O. No." column — i.e. to the RIGHT of the date on the value row of a
 *  2-column `-layout` (so a left-column address number like "3913" isn't mistaken for it). Falls
 *  back to an inline "P.O. No. <n>" label. */
function findPoNumber(text: string): string | null {
  for (const l of nonEmptyLines(text)) {
    const dm = l.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
    if (!dm) continue;
    const after = l.slice((dm.index ?? 0) + dm[0].length).match(/\b(\d{3,8})\b/);
    if (after) return after[1];
  }
  return firstGroup(text, /P\.?\s*O\.?\s*No\.?\s*[:#]?\s*(\d{3,8})/i);
}

const TABLE_KEYWORDS = /\b(TOTAL|MERCHANDISE|HANDLING|FLETE|SUB-?TOTAL|IVA|SHIP\s*TO|SPECIAL|VENDOR|DESCRIPTION|BUYER)\b/i;

/** Parse a line-item table, merging wrapped-description continuation lines into the item above them.
 *  In `pdftotext -layout` output a tall cell (e.g. "8X36 TRAPLANK FD US" / "GRAY 1A") spills the
 *  numeric columns onto the FIRST line and leaves the rest of the description as an orphan line with
 *  no MPN, unit word, or numbers — those get appended to the current item. A numeric/label row ends
 *  the table so totals and addresses below it are never swallowed. */
function parseLineTable<T extends { description: string | null }>(
  text: string,
  parseLine: (line: string) => T | null
): T[] {
  const out: T[] = [];
  let current: T | null = null;
  let inTable = false;
  for (const raw of nonEmptyLines(text)) {
    const parsed = parseLine(raw);
    if (parsed) { out.push(parsed); current = parsed; inTable = true; continue; }
    if (!inTable || !current) continue; // before the table, or nothing to continue
    const toks = raw.trim().split(/\s+/).filter(Boolean);
    const isContinuation =
      toks.length > 0 &&
      !toks.some(isNumericToken) &&
      !toks.some(isUnitWord) &&
      !toks.some(isMpnToken) &&
      !raw.includes(":") &&
      !TABLE_KEYWORDS.test(raw);
    if (isContinuation) {
      current.description = [current.description, toks.join(" ")].filter(Boolean).join(" ") || null;
    } else {
      inTable = false; // a numeric/label row → the item table has ended
      current = null;
    }
  }
  return out;
}

const plgPoParser: DocParser = {
  id: "plg-po",
  label: "PLG / Rodriguez Purchase Order",
  detect: (t) => /purchase\s+order/i.test(t) && /\bP\.?\s*O\.?\s*No/i.test(t),
  parse(text) {
    const warnings: string[] = [];
    const header: ParsedPoHeader = {
      po_number: findPoNumber(text),
      vendor_name: firstGroup(text, /Vendor\s*\n+\s*(.+)/i),
      po_date: parseUsDate(firstGroup(text, /(\d{1,2}\/\d{1,2}\/\d{2,4})/)),
      buyer_user: firstGroup(text, /Buyer\s*\n+\s*([A-Za-z]{1,20})/i),
      currency: /\bUSD\b/.test(text) ? "USD" : null,
      ship_to_name: firstGroup(text, /Ship\s*To\s*\n+\s*(.+?)(?:\s{2,}|$)/im),
      ship_to_address: null,
      // The grand total is the only $-prefixed amount and may sit just ABOVE the "Total" label
      // (pdftotext -layout); prefer the last $-amount, else a number adjacent to "Total".
      total: num(lastGroup(text, "\\$\\s*([\\d,]+\\.\\d{2})")) ??
             num(lastGroup(text, "Total[\\s\\S]{0,20}?([\\d,]+\\.\\d{2})")),
    };
    const lines = parseLineTable(text, parsePoLine).map((l, i) => ({ ...l, line_no: i + 1 }));

    if (!header.po_number) warnings.push("Could not read the PO number — enter it manually.");
    if (lines.length === 0) warnings.push("No line items recognized — use CSV or manual entry.");
    if (header.total != null && lines.length) {
      const sum = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
      if (Math.abs(sum - header.total) > 0.05) warnings.push(`Line amounts sum to ${sum.toFixed(2)} but the document total is ${header.total.toFixed(2)} — review.`);
    }
    return { kind: "po", header, lines, warnings };
  },
};

const plgAckParser: DocParser = {
  id: "plg-ack",
  label: "PLG / Lamosa Acknowledgment of Order",
  detect: (t) => /acknowledg(?:e)?ment\s+of\s+order/i.test(t),
  parse(text) {
    const warnings: string[] = [];
    const header: ParsedAckHeader = {
      ack_document_no: firstGroup(text, /DOCUMENT\s*NO\.?\s*:?\s*(\S+)/i),
      po_number: firstGroup(text, /PURCHASE\s*ORDER\s*:?\s*(\d{3,8})/i),
      vendor_name: /PLG\s*CERAMICS/i.test(text) ? "PLG CERAMICS, INC." : null,
      ack_date: parseEuDate(firstGroup(text, /DOCUMENT\s*DATE\s*:?\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4})/i)),
      order_type: firstGroup(text, /ORDER\s*TYPE\s*:?\s*(.+?)(?:\s{2,}|$)/im),
      customer_no: firstGroup(text, /CUSTOMER\s*:?\s*(\d{3,})/i),
      currency: firstGroup(text, /CURRENCY\s*:?\s*([A-Z]{3})/i) ?? (/\bUSD\b/.test(text) ? "USD" : null),
      incoterm: firstGroup(text, /INCOTERM\s*:?\s*(.+?)(?:\s{2,}|$)/im),
      payment_terms: firstGroup(text, /PAYMENT\s*COND\.?\s*:?\s*(.+?)(?:\s{2,}|$)/im),
      salesperson: firstGroup(text, /SALESPERSON\s*:?\s*(.+?)(?:\s{2,}|$)/im),
      specifier: firstGroup(text, /SPECIFIER\s*:?\s*(.+)/i),
      ship_to_address: firstGroup(text, /SHIP\s*TO\s*ADDRESS\s*:?\s*([\s\S]{0,80}?)(?:\n\s*\n|SPECIAL|$)/i),
      merchandise_value: num(firstGroup(text, /MERCHANDISE\s*VALUE\s*([\d,]+\.\d{2})/i)),
      handling: num(firstGroup(text, /HANDLING\s*([\d,]+\.\d{2})/i)),
      handling_bonus: num(firstGroup(text, /HANDLING\s*-\s*BONUS\s*([\d,]+\.\d{2})/i)),
      freight: num(firstGroup(text, /FLETE\s*([\d,]+\.\d{2})/i)),
      subtotal: num(firstGroup(text, /SUB-?TOTAL\s*([\d,]+\.\d{2})/i)),
      iva_pct: num(firstGroup(text, /IVA\s*(\d+(?:\.\d+)?)\s*%/i)),
      iva_amount: null,
      total: num(lastGroup(text, "\\bTOTAL\\s*([\\d,]+\\.\\d{2})")),
      special_instructions: firstGroup(text, /SPECIAL\s*INSTRUCTIONS\s*:?\s*(.+)/i),
    };
    const lines = parseLineTable(text, parseAckLine);

    if (!header.ack_document_no) warnings.push("Could not read the acknowledgment document number — enter it manually.");
    if (!header.po_number) warnings.push("Could not read the linked PO number — set it so the proforma matches its PO.");
    if (lines.length === 0) warnings.push("No line items recognized — use CSV or manual entry.");
    return { kind: "ack", header, lines, warnings };
  },
};

/** Format registry. Add a supplier by appending a DocParser here. */
export const PARSERS: DocParser[] = [plgAckParser, plgPoParser];

/** Best-effort parse: first registered parser whose detect() matches. Null if none recognize it. */
export function parseDocument(text: string): ParsedDoc | null {
  if (!text || !text.trim()) return null;
  for (const p of PARSERS) if (p.detect(text)) return p.parse(text);
  return null;
}
