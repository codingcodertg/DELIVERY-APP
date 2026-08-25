"use server";

import { createClient } from "@/lib/erp/supabase/server";
import { revalidatePath } from "next/cache";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createAdminClient } from "@/lib/erp/supabase/admin";
import { unwrap } from "@/lib/erp/db-result";
import { pdfToLayoutText } from "@/lib/erp/server/pdf";
import { parseDocument, type ParsedDoc } from "@/lib/erp/domain/po-parse";
import { CATALOG_PAGE } from "@/lib/erp/catalog";
import type { CatalogRow, CatalogQuery } from "@/lib/erp/catalog";
import type { StoreStats, VendorStats, CategoryStats } from "@/lib/erp/analytics";

type Result = { ok: true } | { ok: false; error: string };

// ---- Catalog: server-side search / pagination / export ----------------------------------------
// The grid no longer loads all ~6.5k rows; it pages 100 at a time, filtering/sorting/searching IN SQL
// (trgm index on name + btree on status/record_status/needs_review). #29 holds — reads go through the
// app_products masking view, so cost is NULL for staff in every path here.

// Single string LITERAL (not a concatenation) so supabase keeps the select's literal
// type. Trailing card-view fields are all non-cost; cost/margin stay masked by the view.
const CATALOG_SELECT =
  "id,sku,name,status,record_status,product_type,category_path,vendor_name,price,sell_unit,cost,margin_pct,qoh,needs_review,seo_title,seo_description,collection,size_in,finish,material,look,origin,image_url,image_urls";
const CATALOG_SORTS = new Set([
  "name", "sku", "status", "product_type", "category_path", "vendor_name", "price", "cost", "margin_pct", "qoh",
]);

type SBClient = Awaited<ReturnType<typeof createClient>>;

/** Apply the shared catalog filters (search + status/record/review) and sort to a query builder. */
function catalogFilters(supabase: SBClient, p: CatalogQuery, withCount: boolean) {
  let qb = withCount
    ? supabase.from("app_products").select(CATALOG_SELECT, { count: "exact" })
    : supabase.from("app_products").select(CATALOG_SELECT);
  if (p.recordTab && p.recordTab !== "all") qb = qb.eq("record_status", p.recordTab);
  if (p.status && p.status !== "all") qb = qb.eq("status", p.status);
  if (p.reviewOnly) qb = qb.eq("needs_review", true);
  if (p.categoryPath) {
    const c = p.categoryPath.replace(/[%,()]/g, "");
    qb = qb.ilike("category_path", `${c}%`); // category browse: L1 (prefix) or exact "L1 > L2"
  }
  const q = (p.q ?? "").trim().replace(/[%,()]/g, " ").trim();
  if (q) qb = qb.or(`name.ilike.%${q}%,sku.ilike.%${q}%,vendor_name.ilike.%${q}%`);
  return qb;
}

/** The catalog list query: same filters, ordered by the user's chosen column. */
function catalogFiltered(supabase: SBClient, p: CatalogQuery, withCount: boolean) {
  const sortId = p.sortId && CATALOG_SORTS.has(p.sortId) ? p.sortId : "name";
  return catalogFilters(supabase, p, withCount)
    .order(sortId, { ascending: !p.sortDesc })
    .order("id", { ascending: true });
}

// Attach the storage thumbnail (table view) and the matched Daltile silo image
// (card view fallback) in ONE parallel pass — same fetch path for both views.
// product_external_refs is readable by `authenticated` (v4_54) and holds no cost.
async function enrichImages(supabase: SBClient, rows: CatalogRow[]): Promise<CatalogRow[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return rows;
  const [thumbRes, refRes] = await Promise.all([
    supabase.from("product_images").select("product_id,storage_path").in("product_id", ids).eq("sort_order", 0),
    supabase.from("product_external_refs").select("product_id,image_urls,match_confidence").in("product_id", ids).order("match_confidence", { ascending: false }),
  ]);
  const thumb = new Map<number, string>((thumbRes.data ?? []).map((i) => [i.product_id as number, i.storage_path as string]));
  const ext = new Map<number, string>();
  for (const r of refRes.data ?? []) {
    const pid = r.product_id as number;
    if (ext.has(pid)) continue; // ordered by confidence desc → keep the best match's image
    const urls = Array.isArray(r.image_urls) ? (r.image_urls as string[]) : [];
    const u = urls.find((x) => typeof x === "string" && /^https?:\/\//i.test(x));
    if (u) ext.set(pid, u);
  }
  return rows.map((r) => ({ ...r, image_path: thumb.get(r.id) ?? null, ext_image_url: ext.get(r.id) ?? null }));
}

/** One page of the catalog — filtered/sorted/paged in SQL. Returns the page rows (with thumbnails) and
 *  the exact total for the current filter (for "N of M" + infinite scroll). */
export async function queryCatalog(p: CatalogQuery): Promise<{ rows: CatalogRow[]; total: number; error?: string }> {
  const supabase = await createClient();
  const offset = Math.max(0, p.offset ?? 0);
  const limit = Math.min(500, Math.max(1, p.limit ?? CATALOG_PAGE));
  const { data, count, error } = await catalogFiltered(supabase, p, true).range(offset, offset + limit - 1);
  if (error) return { rows: [], total: 0, error: error.message };
  const rows = await enrichImages(supabase, (data ?? []) as CatalogRow[]);
  return { rows, total: count ?? 0 };
}

/** The FULL filtered set for CSV/XLSX export (no page cap) — paged server-side in 1000-row chunks so any
 *  catalog size works. Same filters as the grid; #29 holds. No thumbnails (not exported). */
export async function exportCatalogRows(
  p: CatalogQuery
): Promise<{ ok: true; rows: CatalogRow[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const CHUNK = 1000;
  const out: CatalogRow[] = [];
  // PRF-05 + NEW-12: keyset, not OFFSET. OFFSET re-scans and re-masks every skipped row, so the cost
  // was O(N^2) over the expensive masking view (876 ms at offset 5000, final chunks approaching the
  // 8 s statement_timeout at ~5x growth) — and because the chunks are not in one snapshot, a
  // concurrent insert or SKU change could shift rows across the boundary and silently skip or
  // duplicate one in the file. Keying off `sku` — unique and immutable — fixes both: each chunk
  // resumes from the last key rather than counting past rows.
  // Consequence, deliberate: the exported file is ordered by sku rather than by the grid's current
  // sort. The row SET is unchanged; only the order is, and it is now deterministic.
  let last: string | null = null;
  for (;;) {
    let qb = catalogFilters(supabase, p, false).order("sku", { ascending: true }).limit(CHUNK);
    if (last !== null) qb = qb.gt("sku", last);
    const { data, error } = await qb;
    if (error) return { ok: false, error: error.message };
    const batch = (data ?? []) as CatalogRow[];
    out.push(...batch);
    if (batch.length < CHUNK) break;
    last = batch[batch.length - 1].sku;
  }
  return { ok: true, rows: out };
}

// Fields a manager/admin may edit inline from the review queue, with coercion.
const NUMERIC = new Set(["price", "cost", "sf_per_box", "weight_per_box_lbs", "moq_group"]);
const INTEGER = new Set(["pieces_per_box", "boxes_per_pallet"]);
const TEXT = new Set([
  "name", "base_unit", "size_in", "size_cm", "material", "finish", "color1", "color2", "style", "mpn",
  "seo_title", "seo_description", "sell_unit",
]);

// Type coercion (string -> numeric/int) happens in the update_product RPC (jsonb -> columns).

/** Clear one review tag (recomputes needs_review). Manager/admin only (DB-enforced). */
export async function resolveTag(productId: number, tag: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_review_tag", { p_id: productId, p_tag: tag });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/review");
  return { ok: true };
}

/** Inline fix via the update_product RPC (definer; base table stays locked). Manager/admin only.
 *  Audit + price_history triggers fire on the UPDATE inside the RPC. */
export async function inlineFix(productId: number, patch: Record<string, unknown>): Promise<Result> {
  const allowed = new Set<string>([...NUMERIC, ...INTEGER, ...TEXT, "category_id", "status"]);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) if (allowed.has(k)) clean[k] = v == null ? "" : String(v);
  if (Object.keys(clean).length === 0) return { ok: false, error: "no editable fields" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_product", { p_id: productId, patch: clean });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/review");
  revalidatePath(`/product/${productId}`);
  return { ok: true };
}

/** bro = same collection diff size · cuz = same size diff color · sub = substitute. */
export type FamilyRelation = "bro" | "cuz" | "sub";

/** Add a symmetric bros/cuz/sub family link (mgr/admin, RPC-enforced + audited). */
export async function addFamilyLink(productId: number, relatedId: number, relation: FamilyRelation): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_product_relation", {
    p_product_id: productId, p_related_id: relatedId, p_relation: relation,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/product/${productId}`);
  revalidatePath(`/product/${relatedId}`);
  return { ok: true };
}

/** Remove a family link in both directions (mgr/admin, RPC-enforced). */
export async function removeFamilyLink(productId: number, relatedId: number, relation: FamilyRelation): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_product_relation", {
    p_product_id: productId, p_related_id: relatedId, p_relation: relation,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/product/${productId}`);
  revalidatePath(`/product/${relatedId}`);
  return { ok: true };
}

/** Re-file a mis-categorized relation (e.g. a Brother that belongs under Cousins):
 *  remove from `from`, add to `to`. Manager/admin only (both RPCs are gated). */
export async function refileFamilyLink(
  productId: number, relatedId: number, from: FamilyRelation, to: FamilyRelation,
): Promise<Result> {
  if (from === to) return { ok: false, error: "same relation" };
  const removed = await removeFamilyLink(productId, relatedId, from);
  if (!removed.ok) return removed;
  return addFamilyLink(productId, relatedId, to);
}

/** Staff "suggest a fix" — files a lightweight product_request (type 'edit', empty
 *  payload + a note) into the existing M1.5 approvals loop. On approve the manager
 *  marks the item human-reviewed (decide_request bumps verified_level). */
export async function suggestFix(productId: number, reason: string, store?: string): Promise<Result> {
  if (!reason.trim()) return { ok: false, error: "Describe the fix" };
  return submitRequest({ type: "edit", product_id: productId, reason: reason.trim(), payload: {}, store });
}

/** Merge: archive loser, alias loser SKU -> survivor. Manager/admin only (RPC-enforced). */
export async function mergeProducts(survivorId: number, loserId: number): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_products", { survivor_id: survivorId, loser_id: loserId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/review/merge");
  revalidatePath("/catalog");
  return { ok: true };
}

/** Publish a draft (interim approvals, #30). Admin only (RPC-enforced). */
export async function publishProduct(productId: number): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_product", { p_id: productId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/catalog");
  revalidatePath(`/product/${productId}`);
  return { ok: true };
}

export type NewItemInput = {
  sku: string;
  name: string;
  product_type: string;
  status: string;
  category_id?: number | null;
  vendor_id?: number | null;
  mpn?: string;
  material?: string;
  finish?: string;
  size_in?: string;
  base_unit?: string;
  sf_per_box?: string;
  store?: string;
  reason?: string;
};

/** New-item request → creates a draft product (record_status='draft') + logs a product_request. */
export async function submitNewItem(
  input: NewItemInput
): Promise<{ ok: true; sku: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const sku = (input.sku || "").trim().toUpperCase();
  if (!sku || !input.name?.trim() || !input.product_type || !input.status) {
    return { ok: false, error: "SKU, name, product type and status are required" };
  }

  const row = {
    sku,
    name: input.name.trim(),
    status: input.status,
    record_status: "draft",
    product_type: input.product_type,
    category_id: input.category_id || null,
    vendor_id: input.vendor_id || null,
    mpn: input.mpn?.trim() || null,
    material: input.material || null,
    finish: input.finish || null,
    size_in: input.size_in?.trim() || null,
    base_unit: input.base_unit || null,
    sf_per_box: input.sf_per_box ? Number(input.sf_per_box) : null,
    needs_review: false,
    review_tags: [] as string[],
    taxable: true,
    created_by: user.id,
  };

  const { error } = await supabase.from("products").insert(row);
  if (error) return { ok: false, error: error.message };

  await supabase.from("product_requests").insert({
    type: "new",
    requester: user.id,
    requester_store: input.store || null,
    payload: row,
    reason: input.reason || null,
  });
  revalidatePath("/catalog");
  return { ok: true, sku };
}

/** Edit / reactivate / deactivate request against an existing product. Edit carries a payload of
 *  proposed field changes; the review UI shows current-vs-proposed and applies it on approve. */
export async function submitRequest(input: {
  type: "edit" | "reactivate" | "deactivate";
  product_id: number;
  reason?: string;
  payload?: Record<string, unknown>;
  store?: string;
}): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { error } = await supabase.from("product_requests").insert({
    type: input.type,
    product_id: input.product_id,
    requester: user.id,
    requester_store: input.store || null,
    reason: input.reason || null,
    payload: input.payload || {},
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/request");
  revalidatePath("/requests");
  return { ok: true };
}

/** Approve (apply) or reject a pending product_request. Manager/admin only (RPC-enforced). */
export async function decideRequest(requestId: number, approve: boolean, note?: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/requests");
  revalidatePath("/catalog");
  return { ok: true };
}

export type PoLine = { mpn?: string; name?: string; size?: string; cost?: string; qty?: string };
export type PoMatch = {
  line: PoLine;
  product: { id: number; sku: string; name: string; cost: number | null; mpn: string | null };
};

/** Match PO lines to products via the ladder: MPN exact, then name (fuzzy). Read-only. */
export async function matchPoLines(lines: PoLine[]): Promise<{ matched: PoMatch[]; unmatched: PoLine[] }> {
  const supabase = await createClient();
  const matched: PoMatch[] = [];
  const unmatched: PoLine[] = [];
  for (const line of lines) {
    let product: PoMatch["product"] | null = null;
    const mpn = line.mpn?.trim();
    // Unwrapped (ARC-02): a swallowed read error used to demote the line to "unmatched",
    // which is the input to createPoDrafts — i.e. it silently created a duplicate draft
    // product for an item that already exists.
    if (mpn) {
      const data = unwrap(
        await supabase.from("app_products").select("id,sku,name,cost,mpn").eq("mpn", mpn).limit(1),
        "matchPoLines: app_products by mpn",
      );
      if (data && data.length) product = data[0] as PoMatch["product"];
    }
    if (!product && line.name?.trim()) {
      const data = unwrap(
        await supabase
          .from("app_products")
          .select("id,sku,name,cost,mpn")
          .ilike("name", `%${line.name.trim()}%`)
          .limit(1),
        "matchPoLines: app_products by name",
      );
      if (data && data.length) product = data[0] as PoMatch["product"];
    }
    if (product) matched.push({ line, product });
    else unmatched.push(line);
  }
  return { matched, unmatched };
}

/** Create pre-filled draft products from unmatched PO lines (extraction + draft only, #31).
 *  vendor + cost + MPN captured at source; cost is captured into price_history by the trigger (#43). */
export async function createPoDrafts(
  vendorId: number | null,
  productType: string,
  lines: PoLine[]
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  if (lines.length === 0) return { ok: false, error: "No unmatched lines to import" };
  const stamp = Date.now().toString(36).toUpperCase();
  const rows = lines.map((line, i) => ({
    sku: `PO-${stamp}-${i + 1}`,
    name: (line.name || line.mpn || "PO item").trim().slice(0, 200),
    status: "active",
    record_status: "draft",
    product_type: productType || "other",
    vendor_id: vendorId || null,
    mpn: line.mpn?.trim() || null,
    size_in: line.size?.trim() || null,
    cost: line.cost && !Number.isNaN(Number(line.cost)) ? Number(line.cost) : null,
    needs_review: true,
    review_tags: ["PO IMPORT"],
    taxable: true,
    created_by: user.id,
  }));
  const { error } = await supabase.from("products").insert(rows);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/catalog");
  revalidatePath("/review");
  return { ok: true, count: rows.length };
}

/** Assign/confirm a real SKU on a PO-import draft. Manager/admin (RPC-enforced). */
export async function assignDraftSku(productId: number, sku: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_draft_sku", { p_id: productId, p_sku: sku });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/product/${productId}`);
  revalidatePath("/catalog");
  revalidatePath("/review");
  return { ok: true };
}

/** Link a PO-import draft to an existing product (alias + cost + archive draft). Manager/admin. */
export async function linkDraftToProduct(draftId: number, targetId: number): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_draft_to_product", { draft_id: draftId, target_id: targetId });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/product/${draftId}`);
  revalidatePath(`/product/${targetId}`);
  revalidatePath("/catalog");
  return { ok: true };
}

type BulkRow = { id: number; action: "updated" | "skipped" | "error"; reason?: string };
type BulkResult =
  | { ok: true; updated: number; skipped: number; errored: number; rows: BulkRow[] }
  | { ok: false; error: string };

/** Bulk-apply a field patch to many products (mgr/admin). Per-row in the RPC; audit+price_history fire. */
export async function bulkUpdate(ids: number[], patch: Record<string, unknown>): Promise<BulkResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_update_products", { p_ids: ids, patch });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/catalog");
  revalidatePath("/review");
  // `errored` + `rows` are v4_59 (COR-11): a row that raised used to be folded into `skipped` with no
  // reason, so a partial apply was indistinguishable from a clean one.
  return {
    ok: true,
    updated: data?.updated ?? 0,
    skipped: data?.skipped ?? 0,
    errored: data?.errored ?? 0,
    rows: (data?.rows ?? []) as BulkRow[],
  };
}

/** Bulk-clear a review tag from many products (mgr/admin). */
export async function bulkResolveTag(ids: number[], tag: string): Promise<BulkResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_resolve_tag", { p_ids: ids, p_tag: tag });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/catalog");
  revalidatePath("/review");
  return { ok: true, updated: data?.updated ?? 0, skipped: data?.skipped ?? 0, errored: 0, rows: [] };
}

export type DecisionRow = Record<string, string>;
export type DecisionChange = { field: string; from: unknown; to: unknown };
export type DecisionRowResult = {
  sku: string | null;
  action: "preview" | "applied" | "skip" | "error";
  reason?: string;
  changes?: DecisionChange[];
};
export type DecisionResult = {
  dry_run: boolean;
  total: number;
  applied: number;
  skipped: number;
  errored: number;
  will_apply: number;
  rows: DecisionRowResult[];
};

/** CSV decisions bulk-apply: preview (dry_run) or apply, in ≤1000-row chunks so any catalog size
 *  works with no row cap. mgr/admin only (RPC-enforced); audit + price_history fire per applied row. */
export async function runDecisions(
  rows: DecisionRow[],
  dryRun: boolean
): Promise<{ ok: true; result: DecisionResult } | { ok: false; error: string }> {
  const supabase = await createClient();
  const CHUNK = 1000;
  const merged: DecisionResult = { dry_run: dryRun, total: 0, applied: 0, skipped: 0, errored: 0, will_apply: 0, rows: [] };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await supabase.rpc("apply_decisions", { p_rows: rows.slice(i, i + CHUNK), p_dry_run: dryRun });
    if (error) return { ok: false, error: error.message };
    const r = data as DecisionResult;
    merged.total += r.total;
    merged.applied += r.applied;
    merged.skipped += r.skipped;
    merged.errored += r.errored;
    merged.will_apply += r.will_apply;
    merged.rows.push(...r.rows);
  }
  if (!dryRun) {
    revalidatePath("/catalog");
    revalidatePath("/review");
  }
  return { ok: true, result: merged };
}

// ---- PO / proforma logging (M1.5) -------------------------------------------------------------
// Both call SECURITY DEFINER, mgr/admin-gated RPCs (v4_28); cost never leaves the server (#29).
// The client sends an already-reviewed {header, lines} object (parsed by lib/domain/po-parse, then
// edited by the manager); the RPC coerces, MPN-matches lines, and writes via the audited path.

type IngestResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };

/** Upsert a purchase order + its lines (idempotent on po_number). */
export async function logPurchaseOrder(
  header: Record<string, unknown>,
  lines: Record<string, unknown>[]
): Promise<IngestResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_purchase_order", { p_header: header, p_lines: lines });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/purchasing/orders");
  return { ok: true, result: (data ?? {}) as Record<string, unknown> };
}

/** Upsert a supplier acknowledgment + its lines (idempotent on ack_document_no); links to its PO. */
export async function logAcknowledgment(
  header: Record<string, unknown>,
  lines: Record<string, unknown>[]
): Promise<IngestResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_acknowledgment", { p_header: header, p_lines: lines });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/purchasing/orders");
  return { ok: true, result: (data ?? {}) as Record<string, unknown> };
}

/** Extract a dragged PO/proforma PDF to text (unpdf, serverless) and parse it with the format
 *  registry, returning the structured doc for the manager to review before saving. mgr/admin only
 *  (the PDF carries cost — #29); no DB write happens here. */
export async function parsePdfUpload(
  form: FormData
): Promise<
  | { ok: true; doc: ParsedDoc; storagePath: string | null; storageNote?: string }
  | { ok: false; error: string }
> {
  const session = await getSessionInfo();
  if (!session || !canSeeCost(session.role)) return { ok: false, error: "not authorized" };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No PDF file provided." };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "PDF too large (max 10 MB)." };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = await pdfToLayoutText(bytes);
    const doc = parseDocument(text);
    if (!doc) return { ok: false, error: "Couldn't recognize this PDF as a PO or acknowledgment. Try paste / CSV / manual." };
    // Persist the original in the PRIVATE po-docs bucket (it carries cost — service role, #29).
    // Non-fatal: if storage fails, parsing still succeeds, just without a saved document.
    let storagePath: string | null = null;
    let storageNote: string | undefined;
    try {
      const path = `uploads/${crypto.randomUUID()}.pdf`;
      const { error } = await createAdminClient().storage.from("po-docs")
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error(error.message);
      storagePath = path;
    } catch (e) {
      // Still non-fatal — the parse is the valuable part and the manager can save the PO without
      // the original attached. But it is REPORTED now: a dead service key used to land here and
      // leave no trace at all, so every upload silently stopped being kept and nobody could tell.
      storageNote = e instanceof Error ? e.message : "unknown storage error";
      console.error("[parsePdfUpload] po-docs upload failed:", storageNote);
    }
    return { ok: true, doc, storagePath, storageNote };
  } catch (e) {
    return { ok: false, error: `Couldn't read the PDF: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

export type PoLineSuggestion = { id: number; sku: string; name: string; size_in: string | null; reason: string };

/** Link a PO line to a catalog product (mgr/admin, RPC-enforced + audited); optional vendor_sku alias. */
export async function setPoLineProduct(poLineId: number, productId: number, writeAlias: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_po_line_product", {
    p_po_line_id: poLineId, p_product_id: productId, p_write_alias: writeAlias,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/purchasing/orders");
  return { ok: true };
}

/** Ranked candidate products for a PO line (vendor_sku → MPN → name similarity). mgr/admin; no cost. */
export async function getPoLineSuggestions(
  poLineId: number
): Promise<{ ok: true; suggestions: PoLineSuggestion[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suggest_po_line_matches", { p_po_line_id: poLineId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, suggestions: (data ?? []) as PoLineSuggestion[] };
}

// ---- M3 receiving (PR2) ------------------------------------------------------------------------
// All via SECURITY DEFINER, mgr/admin-gated RPCs (v4_39). Lot landed cost never leaves the server for
// staff (#29); movements are append-only — each receive inserts a 'receive' movement and the ledger
// trigger bumps store_products.qoh.

export type PoReceivingLine = {
  po_line_id: number; line_no: number | null; vendor_item_no: string | null;
  product_id: number | null; sku: string | null; name: string | null; description: string | null;
  uom: string | null; qty: number | null; unit_rate: number | null; amount: number | null;
  received_qty: number; remaining: number;
};
export type PoReceiving = {
  po_id: number; po_number: string; status: string; vendor_name: string | null;
  currency: string | null; store_id: string | null; ack_freight: number | null; lines: PoReceivingLine[];
};

/** Load a PO's lines with ordered/received/remaining + the ack freight, for the receiving screen. mgr/admin. */
export async function getPoReceiving(
  poId: number
): Promise<{ ok: true; data: PoReceiving } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("po_receiving_detail", { p_po_id: poId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as PoReceiving };
}

/** Receive quantities against a PO → lots (landed cost) + 'receive' movements; advances PO status. mgr/admin. */
export async function receivePo(
  poId: number,
  storeId: string,
  receipts: { po_line_id: number; qty: number }[],
  freightTotal?: number | null,
  dutyTotal?: number | null,
  /** Idempotency key (v4_58). Reuse the SAME key when retrying a receipt that may already have
   *  committed — a serverless timeout, a double-click — and the RPC replays the original result
   *  instead of posting a second set of lots and movements (COR-02). */
  receiptKey?: string | null
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_po", {
    p_po_id: poId,
    p_store_id: storeId,
    p_receipts: receipts,
    p_freight_total: freightTotal ?? null,
    p_duty_total: dutyTotal ?? null,
    p_receipt_key: receiptKey ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/purchasing/receiving");
  revalidatePath("/purchasing/orders");
  revalidatePath(`/purchasing/orders/${poId}`);
  return { ok: true, result: (data ?? {}) as Record<string, unknown> };
}

/** Manual receive (no PO): create a lot with the given per-unit costs + a 'receive' movement. mgr/admin. */
export async function receiveManual(input: {
  productId: number;
  storeId: string;
  qty: number;
  baseCost?: number | null;
  freightCost?: number | null;
  dutyCost?: number | null;
  lotNumber?: string | null;
  receivedDate?: string | null;
  reference?: string | null;
}): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_manual", {
    p_product_id: input.productId,
    p_store_id: input.storeId,
    p_qty: input.qty,
    p_base_cost: input.baseCost ?? null,
    p_freight_cost: input.freightCost ?? 0,
    p_duty_cost: input.dutyCost ?? 0,
    p_lot_number: input.lotNumber ?? null,
    p_received_date: input.receivedDate ?? null,
    p_reference: input.reference ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/product/${input.productId}`);
  revalidatePath("/purchasing/receiving");
  return { ok: true, result: (data ?? {}) as Record<string, unknown> };
}

export type ProductSearchHit = { id: number; sku: string; name: string; base_unit: string | null; cost: number | null };

/** Search published products by name/SKU for the manual-receive / adjustment pickers (mgr/admin). */
export async function searchProducts(query: string): Promise<ProductSearchHit[]> {
  const safe = query.trim().replace(/[%,()]/g, "");
  if (safe.length < 2) return [];
  const supabase = await createClient();
  const data = unwrap(
    await supabase
      .from("app_products")
      .select("id,sku,name,base_unit,cost")
      .or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`)
      .limit(10),
    "searchProducts: app_products",
  );
  return (data ?? []) as ProductSearchHit[];
}

// ---- M3 adjustments + cycle counts (PR3) ------------------------------------------------------
// All via SECURITY DEFINER, mgr/admin-gated RPCs (v4_41). Append-only — each adjustment / count
// reconcile posts a movement that bumps store_products.qoh via the ledger trigger; the movement IS the
// audit row (actor + reason + note + at). QOH is not cost (#29) — these are quantity ops only.

export type CycleCountRow = {
  id: number; product_id: number; sku: string; name: string; store_id: string;
  counted_qty: number; system_qty: number; variance: number; tolerance_pct: number | null;
  status: string; counted_at: string | null; reconciled_at: string | null;
};
export type NegativeBalance = { product_id: number; sku: string; name: string; store_id: string; qoh: number };

/** Post a signed inventory adjustment (adjustment | damage | shrinkage) with a note. mgr/admin. */
export async function adjustInventory(input: {
  productId: number; storeId: string; qtyDelta: number;
  reason: "adjustment" | "damage" | "shrinkage"; note?: string;
}): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adjust_inventory", {
    p_product_id: input.productId, p_store_id: input.storeId, p_qty_delta: input.qtyDelta,
    p_reason: input.reason, p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  revalidatePath(`/product/${input.productId}`);
  return { ok: true, result: (data ?? {}) as Record<string, unknown> };
}

/** Record a physical cycle count vs the ledger system qty (leaves it open for reconcile). mgr/admin. */
export async function recordCycleCount(input: {
  productId: number; storeId: string; countedQty: number; tolerancePct?: number | null;
}): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_cycle_count", {
    p_product_id: input.productId, p_store_id: input.storeId, p_counted_qty: input.countedQty,
    p_tolerance_pct: input.tolerancePct ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  return { ok: true, result: (data ?? {}) as Record<string, unknown> };
}

/** Reconcile an open count → posts a count_adjustment for the delta + marks the on-hand verified. mgr/admin. */
export async function reconcileCycleCount(
  countId: number
): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reconcile_cycle_count", { p_count_id: countId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inventory");
  return { ok: true, result: (data ?? {}) as Record<string, unknown> };
}

/** Recent cycle counts (most recent first). mgr/admin. */
export async function listCycleCounts(limit = 50, offset = 0): Promise<CycleCountRow[]> {
  const supabase = await createClient();
  const data = unwrap(await supabase.rpc("list_cycle_counts", { p_limit: limit, p_offset: offset }), "listCycleCounts");
  return (data ?? []) as CycleCountRow[];
}

/** Every (product, store) whose on-hand has gone negative (a flag). mgr/admin. */
export async function getNegativeBalances(): Promise<NegativeBalance[]> {
  const supabase = await createClient();
  // Unwrapped (ARC-02): this is a safety flag — "no negative balances" must never be
  // what a failed read looks like.
  const data = unwrap(await supabase.rpc("negative_balances"), "getNegativeBalances");
  return (data ?? []) as NegativeBalance[];
}

/** Per-store on-hand for a product (for the count/adjust screens). QOH is not cost (#29). */
export async function getProductStoreQoh(
  productId: number
): Promise<{ store_id: string; qoh: number | null; qoh_verified: boolean }[]> {
  const supabase = await createClient();
  const data = unwrap(
    await supabase.from("app_store_products").select("store_id,qoh,qoh_verified").eq("product_id", productId),
    "getProductStoreQoh: app_store_products",
  );
  return (data ?? []) as { store_id: string; qoh: number | null; qoh_verified: boolean }[];
}

// ---- Analytics (manager/admin only — cost/margin surface, #29) ---------------------------------
// Each calls a mgr/admin SECURITY DEFINER aggregation RPC (v4_43). Staff can't reach these (the page
// redirects them and the RPC fails closed), so cost/margin never enters a staff payload.

export async function getStoreStats(period: string, store: string | null): Promise<StoreStats | null> {
  const supabase = await createClient();
  const data = unwrap(await supabase.rpc("analytics_store_stats", { p_period: period, p_store: store }), "getStoreStats");
  return (data ?? null) as StoreStats | null;
}

export async function getVendorStats(period: string): Promise<VendorStats | null> {
  const supabase = await createClient();
  const data = unwrap(await supabase.rpc("analytics_vendor_stats", { p_period: period }), "getVendorStats");
  return (data ?? null) as VendorStats | null;
}

export async function getCategoryStats(period: string, parent: string | null): Promise<CategoryStats | null> {
  const supabase = await createClient();
  const data = unwrap(await supabase.rpc("analytics_category_stats", { p_period: period, p_parent: parent }), "getCategoryStats");
  return (data ?? null) as CategoryStats | null;
}
