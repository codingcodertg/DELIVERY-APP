// Single source of truth for the Excel round-trip "full product master" (see
// excel-round-trip-mirror-spec.md). The export route, the import parser, and the review UI all read
// this registry, and the SQL apply path (packages/db/migrations/v4_57_master_round_trip.sql) mirrors
// the SAME editable allowlist + types — keep them in sync.
//
// Key = `sku` (the schema's unified product code), locked. EDITABLE fields round-trip through the
// audited apply RPC. REFERENCE fields are exported for context but marked "do not edit" and ignored
// on import. A BLANK editable cell means "no change" (never null-out). #29: the single `cost` field is
// flagged `cost` — it appears only in a manager/admin export and only a manager/admin can write it.

export type MasterFieldType =
  | "text"
  | "number"
  | "int"
  | "enum"
  | "date"
  | "boolean"
  | "fk_vendor" // exported/edited as vendor NAME; the RPC resolves name -> vendor_id
  | "fk_category" // exported/edited as category PATH; the RPC resolves path -> category_id
  | "relation" // comma/space-separated SKU tokens (bros/cuz/subs); each must resolve
  | "ref"; // reference/derived — read-only

export type MasterField = {
  /** app_products column to read (export) and canonical key sent to the apply RPC (import). */
  key: string;
  /** Excel column header. */
  header: string;
  group: "key" | "editable" | "reference";
  type: MasterFieldType;
  /** #29 — only `cost`; included solely in a manager/admin export, writable only by manager/admin. */
  cost?: boolean;
  /** Allowed values for an enum/domain field (drives the in-sheet dropdown). */
  enumValues?: readonly string[];
  note?: string;
};

export const STATUS_VALUES = ["active", "special_order", "discontinued", "inactive"] as const;
export const PRODUCT_TYPE_VALUES = ["tile", "trim", "setting_material", "tool", "accessory", "other"] as const;
export const SELL_UNIT_VALUES = ["sqft", "piece", "box", "bag", "bucket", "linear_ft", "each"] as const;
export const PRICE_KIND_VALUES = ["general", "specific"] as const;
export const PRICE_MODE_VALUES = ["fixed", "leveled"] as const;
export const BOOL_VALUES = ["yes", "no"] as const;

/** The hidden, locked per-row version stamp (products.updated_at at export time) — powers the staleness guard. */
export const VERSION_COL = "__row_version";
export const KEY_FIELD = "sku";

// Ordered: KEY → EDITABLE (full master) → REFERENCE (context, do-not-edit). The version stamp is appended
// as a hidden column by the export. `key` matches the app_products column AND the apply-RPC patch key.
export const MASTER_FIELDS: readonly MasterField[] = [
  { key: "sku", header: "SKU (key — do not edit)", group: "key", type: "text", note: "locked key" },

  // ── editable: identity / classification ─────────────────────────────────────────────────────────
  { key: "name", header: "Name", group: "editable", type: "text" },
  { key: "description", header: "Description", group: "editable", type: "text" },
  { key: "status", header: "Status", group: "editable", type: "enum", enumValues: STATUS_VALUES },
  { key: "discontinue_reason", header: "Discontinue reason", group: "editable", type: "text" },
  { key: "product_type", header: "Product type", group: "editable", type: "enum", enumValues: PRODUCT_TYPE_VALUES },
  { key: "category_path", header: "Category path", group: "editable", type: "fk_category" },
  { key: "vendor_name", header: "Vendor", group: "editable", type: "fk_vendor" },
  { key: "mpn", header: "MPN", group: "editable", type: "text" },

  // ── editable: attributes ────────────────────────────────────────────────────────────────────────
  { key: "material", header: "Material", group: "editable", type: "text" },
  { key: "finish", header: "Finish", group: "editable", type: "text" },
  { key: "color1", header: "Color 1", group: "editable", type: "text" },
  { key: "color2", header: "Color 2", group: "editable", type: "text" },
  { key: "look", header: "Look", group: "editable", type: "text" },
  { key: "color_observation", header: "Color observation", group: "editable", type: "text" },
  { key: "substitute_color", header: "Substitute color", group: "editable", type: "text" },
  { key: "style", header: "Style", group: "editable", type: "text" },
  { key: "size_in", header: "Size (in)", group: "editable", type: "text" },
  { key: "size_cm", header: "Size (cm)", group: "editable", type: "text" },
  { key: "origin", header: "Origin", group: "editable", type: "text" },
  { key: "collection", header: "Collection", group: "editable", type: "text" },

  // ── editable: packaging / units ─────────────────────────────────────────────────────────────────
  { key: "base_unit", header: "Base unit (buy/stock)", group: "editable", type: "text" },
  { key: "sell_unit", header: "Sell unit", group: "editable", type: "enum", enumValues: SELL_UNIT_VALUES },
  { key: "sf_per_box", header: "SF per box", group: "editable", type: "number" },
  { key: "pieces_per_box", header: "Pieces per box", group: "editable", type: "int" },
  { key: "boxes_per_pallet", header: "Boxes per pallet", group: "editable", type: "int" },
  { key: "weight_per_box_lbs", header: "Lbs per box", group: "editable", type: "number" },
  { key: "lbs_per_pallet", header: "Lbs per pallet", group: "editable", type: "number" },

  // ── editable: relationships (SKU tokens) ────────────────────────────────────────────────────────
  { key: "bros", header: "Bros (SKUs)", group: "editable", type: "relation" },
  { key: "cuz", header: "Cuz (SKUs)", group: "editable", type: "relation" },
  { key: "subs", header: "Subs (SKUs)", group: "editable", type: "relation" },

  // ── editable: web / SEO ─────────────────────────────────────────────────────────────────────────
  { key: "tags", header: "Tags", group: "editable", type: "text" },
  { key: "barcode_upc", header: "Barcode / UPC", group: "editable", type: "text" },
  { key: "shopify_handle", header: "Shopify handle", group: "editable", type: "text" },
  { key: "seo_title", header: "SEO title", group: "editable", type: "text" },
  { key: "seo_description", header: "SEO description", group: "editable", type: "text" },
  { key: "image_url", header: "Image URL", group: "editable", type: "text" },
  { key: "folder_url", header: "Folder URL", group: "editable", type: "text" },
  { key: "product_url", header: "Product URL", group: "editable", type: "text" },
  { key: "date_added", header: "Date added", group: "editable", type: "date" },

  // ── editable: pricing tiers + flags (SALE prices — not cost) ─────────────────────────────────────
  { key: "price", header: "Price (sell)", group: "editable", type: "number" },
  { key: "price_erp", header: "Price — ERP", group: "editable", type: "number" },
  { key: "price_sales", header: "Price — Sales", group: "editable", type: "number" },
  { key: "price_mgr", header: "Price — Manager", group: "editable", type: "number" },
  { key: "price_vol", header: "Price — Volume", group: "editable", type: "number" },
  { key: "price_kind", header: "Price kind", group: "editable", type: "enum", enumValues: PRICE_KIND_VALUES },
  { key: "price_mode", header: "Price mode", group: "editable", type: "enum", enumValues: PRICE_MODE_VALUES },
  { key: "moq_group", header: "MOQ group", group: "editable", type: "number" },
  { key: "taxable", header: "Taxable", group: "editable", type: "boolean", enumValues: BOOL_VALUES },

  // ── editable: cost (#29 — manager/admin only) ───────────────────────────────────────────────────
  { key: "cost", header: "Cost (per base unit)", group: "editable", type: "number", cost: true },

  // ── reference / derived (exported for context, NEVER edited — ignored on import) ─────────────────
  { key: "id", header: "id (ref — do not edit)", group: "reference", type: "ref" },
  { key: "record_status", header: "Record status (ref)", group: "reference", type: "ref" },
  { key: "needs_review", header: "Needs review (ref)", group: "reference", type: "ref" },
  { key: "review_tags", header: "Review tags (ref)", group: "reference", type: "ref" },
  { key: "verified_level", header: "Verified level (ref)", group: "reference", type: "ref" },
  { key: "price_approved", header: "Price approved (ref)", group: "reference", type: "ref" },
  { key: "margin_pct", header: "Margin % (ref, derived)", group: "reference", type: "ref", cost: true },
  { key: "gm_amount", header: "GM $ (ref, derived)", group: "reference", type: "ref", cost: true },
  { key: "qoh", header: "QOH (ref)", group: "reference", type: "ref" },
  { key: "image_urls", header: "Image URLs (ref)", group: "reference", type: "ref" },
  { key: "sellable_units", header: "Sellable units (ref)", group: "reference", type: "ref" },
  { key: "updated_at", header: "Updated at (ref)", group: "reference", type: "ref" },
  { key: "created_at", header: "Created at (ref)", group: "reference", type: "ref" },
] as const;

/** Editable fields, minus the cost field for non-cost (staff never reach this feature, but defense-in-depth). */
export function editableFields(canSeeCost: boolean): MasterField[] {
  return MASTER_FIELDS.filter((f) => f.group === "editable" && (canSeeCost || !f.cost));
}

/** Full ordered export column set: key, editable (cost-gated), reference (cost-gated derived). */
export function exportFields(canSeeCost: boolean): MasterField[] {
  return MASTER_FIELDS.filter((f) => canSeeCost || !f.cost);
}

/** app_products columns the export must SELECT (reference ids resolved to path/name happen in the view). */
export function selectColumns(canSeeCost: boolean): string[] {
  const cols = new Set<string>(["sku", "updated_at"]);
  for (const f of exportFields(canSeeCost)) cols.add(f.key);
  return [...cols];
}

// Header (lowercased, trimmed) → canonical key, for import. Includes the sheet headers we emit plus a
// few lenient aliases so the owner's master-Excel columns map too (one mechanism, two uses — spec §5).
export function buildHeaderMap(): Map<string, string> {
  const m = new Map<string, string>();
  const put = (h: string, key: string) => m.set(h.trim().toLowerCase(), key);
  for (const f of MASTER_FIELDS) put(f.header, f.key);
  // canonical key spellings + common owner-master aliases
  put("sku", "sku");
  put("unified_code", "sku");
  put("unified code", "sku");
  put("code", "sku");
  put("name", "name");
  put("product name", "name");
  put("status", "status");
  put("category", "category_path");
  put("category_path", "category_path");
  put("vendor", "vendor_name");
  put("vendor_name", "vendor_name");
  put("supplier", "vendor_name");
  put("mpn", "mpn");
  put("material", "material");
  put("finish", "finish");
  put("look", "look");
  put("size", "size_in");
  put("size_in", "size_in");
  put("size (in)", "size_in");
  put("size_cm", "size_cm");
  put("base_unit", "base_unit");
  put("base unit", "base_unit");
  put("uom", "base_unit");
  put("sell_unit", "sell_unit");
  put("sf_per_box", "sf_per_box");
  put("sf/box", "sf_per_box");
  put("pieces_per_box", "pieces_per_box");
  put("pcs/box", "pieces_per_box");
  put("price", "price");
  put("retail", "price");
  put("cost", "cost");
  put("unit cost", "cost");
  put("price_erp", "price_erp");
  put("price_sales", "price_sales");
  put("price_mgr", "price_mgr");
  put("price_vol", "price_vol");
  put("price_kind", "price_kind");
  put("price_mode", "price_mode");
  put("taxable", "taxable");
  put("collection", "collection");
  put("bros", "bros");
  put("cuz", "cuz");
  put("subs", "subs");
  put("seo_title", "seo_title");
  put("seo_description", "seo_description");
  put("date_added", "date_added");
  put(VERSION_COL, VERSION_COL);
  return m;
}

/** Set of keys that are legitimately importable (editable + the key + the version stamp). */
export function importableKeys(): Set<string> {
  const s = new Set<string>([KEY_FIELD, VERSION_COL]);
  for (const f of MASTER_FIELDS) if (f.group === "editable") s.add(f.key);
  return s;
}
