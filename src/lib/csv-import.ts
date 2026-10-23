import type { Delivery } from "@/lib/types";
import { problemaDeFecha, textoDelProblema } from "@/lib/dia-de-entrega";
import { todayISO } from "@/lib/utils";

// ============================================================
// CSV import for bulk order entry (#ops). Accepts the same column headers the
// app EXPORTS (see lib/utils deliveryColumns), so an exported file — or a
// spreadsheet built from those headers — can be re-imported. Tolerant: unknown
// columns are ignored, and formatted values (money, HH:MM windows, dates) are
// normalized back to what the app stores.
// ============================================================

/** Minimal RFC-4180-ish parser: handles quoted fields, escaped quotes (""),
 * commas and newlines inside quotes, and CRLF. Returns non-empty rows. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\r") {
      // ignore — handled by the \n branch
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// Export header → Delivery field. Only these columns are imported; anything
// else in the file (ID, Stage, Route Miles, timestamps…) is ignored.
const HEADER_TO_FIELD: Record<string, keyof Delivery> = {
  "Order Type": "order_type",
  "Store (Sold From)": "store",
  "Store": "store",
  "PO #": "po2",
  "SO #": "so_num",
  "Invoice #": "invoice_num",
  "Estimate #": "estimate_num",
  "Delivery Date": "delivery_date",
  "Pickup Name": "pickup_name",
  "Pickup Address": "pickup_address",
  "Delivery Fee": "delivery_fee",
  "Est. Pallets (sales)": "est_pallets",
  "Est. Pallets": "est_pallets",
  "Delivery Address": "delivery_address",
  "Delivery Military Time Windows": "delivery_windows",
  "Windows": "delivery_windows",
  "Account": "account",
  "Contact": "contact",
  "Delivery Phone Number": "delivery_phone",
  "Delivery Notes": "delivery_notes",
};

const NUMERIC = new Set<keyof Delivery>(["delivery_fee", "est_pallets"]);

/** Normalize an exported/typed value back to what the app stores. */
function normalize(field: keyof Delivery, raw: string): string | number | null {
  const v = raw.trim();
  if (!v) return null;
  if (NUMERIC.has(field)) {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (field === "delivery_windows") {
    // "08:30-17:30" → "0830-1730"; keep only digits, dashes and commas.
    return v.replace(/[^0-9,\-]/g, "");
  }
  if (field === "delivery_date") {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    return v; // leave as-is; flagged as a warning by the caller
  }
  return v;
}

export interface ImportResult {
  drafts: Partial<Delivery>[];
  /** Human-readable, per-row issues (row still imports unless it has no data). */
  warnings: string[];
  /** Headers that were recognized and mapped. */
  mappedHeaders: string[];
  /** Headers present in the file but ignored. */
  ignoredHeaders: string[];
}

/** Turn parsed CSV rows (first row = headers) into order drafts. `hoy` (Texas) decides which years are possible. */
export function mapRowsToDrafts(rows: string[][], hoy: string = todayISO()): ImportResult {
  if (rows.length < 2) return { drafts: [], warnings: ["The file has no data rows."], mappedHeaders: [], ignoredHeaders: [] };
  const headers = rows[0].map((h) => h.trim());
  const fields = headers.map((h) => HEADER_TO_FIELD[h] ?? null);
  const mappedHeaders = headers.filter((_, i) => fields[i]);
  const ignoredHeaders = headers.filter((_, i) => !fields[i]);

  const drafts: Partial<Delivery>[] = [];
  const warnings: string[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const draft: Partial<Delivery> = { stage: "draft" };
    for (let c = 0; c < headers.length; c++) {
      const field = fields[c];
      if (!field) continue;
      const val = normalize(field, cells[c] ?? "");
      if (val !== null) (draft as Record<string, unknown>)[field] = val;
    }
    // A row with no account AND no delivery address is almost certainly blank
    // or malformed — skip it rather than create an empty order.
    if (!draft.account && !draft.delivery_address && !draft.store) {
      warnings.push(`Row ${r + 1}: skipped (no account, address or store).`);
      continue;
    }
    // Ni domingo ni un año imposible (D-658): la fila no entra, con su motivo. Sin caso especial: un archivo no lo pide.
    const problema = problemaDeFecha(draft.delivery_date, { hoy });
    if (problema) {
      warnings.push(`Row ${r + 1}: skipped (delivery date ${draft.delivery_date}). ${textoDelProblema(problema, null, { hoy }).en}`);
      continue;
    }
    if (!draft.delivery_address) warnings.push(`Row ${r + 1}: no delivery address.`);
    drafts.push(draft);
  }
  return { drafts, warnings, mappedHeaders, ignoredHeaders };
}
