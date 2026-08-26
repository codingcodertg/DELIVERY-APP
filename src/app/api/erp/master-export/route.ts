// Round-trip XLSX export of the FULL editable product master (excel-round-trip-mirror-spec.md §Export).
// Server-side + session-bound (anon key + JWT) so the #29 cost mask applies; manager/admin only — staff
// get 403 (and the feature is hidden from them). One row per product keyed by the locked `sku`. Editable
// cells are unlocked; the key + every reference/derived column is locked ("do not edit"); enum columns get
// in-sheet dropdowns; a hidden, locked `__row_version` column carries products.updated_at to power the
// staleness guard on re-import. A "_meta" sheet stamps export_id + timestamp so the import knows the
// baseline. Cost columns appear only for manager/admin.

import { getSessionInfo } from "@/lib/erp/auth";
import { canSeeCost } from "@/lib/erp/domain/roles";
import { createClient } from "@/lib/erp/supabase/server";
import { exportFields, selectColumns, VERSION_COL, type MasterField } from "@/lib/erp/master/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

/** Render a cell value for the sheet by field type (arrays joined, booleans yes/no, numbers numeric). */
function cellValue(f: MasterField, raw: unknown): string | number | null {
  if (raw === null || raw === undefined) return null;
  if (f.key === "review_tags" || f.key === "image_urls" || f.key === "sellable_units") {
    return Array.isArray(raw) ? (raw as unknown[]).join(", ") : String(raw);
  }
  if (f.type === "boolean" || f.key === "needs_review" || f.key === "price_approved") {
    if (typeof raw === "boolean") return raw ? "yes" : "no";
    return String(raw);
  }
  if (f.type === "number" || f.type === "int" || f.key === "qoh" || f.key === "margin_pct" || f.key === "gm_amount") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : String(raw);
  }
  return String(raw);
}

export async function GET() {
  const session = await getSessionInfo();
  if (!session) return new Response("Not signed in", { status: 401 });
  if (!canSeeCost(session.role)) return new Response("Forbidden", { status: 403 }); // bulk write surface (#29)
  const cost = canSeeCost(session.role);

  // Pull the whole catalog through the masking view (chunked; no row cap). #29 holds — cost is the
  // user's session, so staff would get NULL (and never reach here anyway).
  const supabase = await createClient();
  const select = selectColumns(cost).join(",");
  const rows: Row[] = [];
  const CHUNK = 1000;
  // PRF-05 + NEW-12: keyset, not OFFSET. OFFSET made each chunk re-scan and re-mask every row it
  // skipped (O(N^2) over the masking view), and the chunks are not one snapshot, so a concurrent
  // write could shift a row across a boundary and skip or duplicate it in the workbook. `sku` is
  // unique and immutable and the query was already ordered by it, so this is a direct swap.
  let last: string | null = null;
  for (;;) {
    let qb = supabase.from("app_products").select(select).order("sku", { ascending: true }).limit(CHUNK);
    if (last !== null) qb = qb.gt("sku", last);
    const { data, error } = await qb;
    if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });
    const batch = (data ?? []) as unknown as Row[];
    rows.push(...batch);
    if (batch.length < CHUNK) break;
    last = String(batch[batch.length - 1].sku);
  }

  const fields = exportFields(cost);
  const exportId = crypto.randomUUID();
  const exportedAt = new Date().toISOString();

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "RTG ERP — Excel round-trip";
  wb.created = new Date();

  // ── _meta sheet: the import reads export_id/timestamp to know the baseline ──────────────────────
  const meta = wb.addWorksheet("_meta");
  meta.columns = [{ width: 22 }, { width: 60 }];
  meta.addRows([
    ["export_id", exportId],
    ["exported_at", exportedAt],
    ["exported_by", session.fullName ?? session.user.email ?? session.user.id],
    ["role", session.role],
    ["row_count", rows.length],
    ["cost_included", cost ? "yes" : "no"],
    ["sheet", "Products"],
    ["key_column", "SKU (locked, do not change)"],
    ["version_column", `${VERSION_COL} (hidden, do not change) — powers the staleness guard`],
    ["", ""],
    ["HOW TO USE", "Edit only the unlocked (editable) columns on the Products sheet, then re-import the SAME file."],
    ["Blank cell", "Means 'no change' — it never clears a value."],
    ["Reference columns", "Marked '(ref)' / '(do not edit)' — ignored on import."],
    ["New rows", "A new SKU becomes a draft for approval (never a silent live product)."],
    ["Deletions", "Removing a row does NOT delete the product. Deactivate via the Status column."],
  ]);
  meta.getColumn(1).font = { bold: true };
  meta.state = "veryHidden"; // keep it out of the way; managers edit Products only

  // ── Products sheet ──────────────────────────────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Products", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  const headerRow = ws.addRow([...fields.map((f) => f.header), VERSION_COL]);
  const versionColIdx = fields.length + 1;

  for (const row of rows) {
    const values = fields.map((f) => cellValue(f, row[f.key]));
    const updatedAt = row["updated_at"] == null ? "" : String(row["updated_at"]);
    ws.addRow([...values, updatedAt]);
  }

  // Column widths + per-cell protection. Sheet is protected; editable cells (incl. empty ones, so the
  // manager can type) are unlocked, the key + reference columns locked, enum cells get a dropdown.
  fields.forEach((f, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(Math.max(f.header.length + 2, 12), 40);
    const editable = f.group === "editable";
    const list = editable && f.enumValues?.length ? `"${f.enumValues.join(",")}"` : null;
    col.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
      if (rowNumber === 1) return; // header styled below
      cell.protection = { locked: !editable };
      if (!editable) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      if (list) cell.dataValidation = { type: "list", allowBlank: true, formulae: [list] };
    });
  });

  // Hidden, locked version-stamp column (text format so the timestamp round-trips exactly).
  const vcol = ws.getColumn(versionColIdx);
  vcol.hidden = true;
  vcol.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
    if (rowNumber === 1) return;
    cell.protection = { locked: true };
    cell.numFmt = "@";
  });

  // Header styling: editable = clay accent, key/reference = slate. All header cells locked.
  headerRow.eachCell((cell, colNumber) => {
    const f = fields[colNumber - 1];
    const isEditable = f?.group === "editable";
    cell.font = { bold: true, color: { argb: isEditable ? "FF7C3F1D" : "FF475569" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isEditable ? "FFFDF3EC" : "FFE2E8F0" } };
    cell.protection = { locked: true };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  headerRow.height = 28;

  // Protect the sheet: locked cells (key + reference + version) can't be edited; unlocked (editable) can.
  // Soft guard (no password) — selection/format/sort stay allowed for usability.
  await ws.protect("", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatColumns: true,
    formatRows: true,
    insertRows: true, // managers can add an unknown-SKU row → routed to a draft on import
    sort: true,
    autoFilter: true,
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: versionColIdx } };

  const buf = await wb.xlsx.writeBuffer();
  const stamp = exportedAt.slice(0, 10);
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rtg-master-roundtrip-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
      "X-Export-Id": exportId,
    },
  });
}
