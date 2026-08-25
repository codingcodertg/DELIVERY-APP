// Shared catalog types + constants. Kept out of lib/actions.ts because a "use server" module may only
// export async functions (not consts/types).

export const CATALOG_PAGE = 100;

export type CatalogRow = {
  id: number;
  sku: string;
  name: string;
  status: string;
  record_status: string;
  product_type: string | null;
  category_path: string | null;
  vendor_name: string | null;
  price: number | null;
  cost: number | null;
  margin_pct: number | null;
  qoh: number | null;
  needs_review: boolean;
  sell_unit?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  image_path?: string | null;
  // ── card-view fields (non-cost) — populated for both views in one fetch ──
  collection?: string | null;
  size_in?: string | null;
  finish?: string | null;
  material?: string | null;
  look?: string | null;
  origin?: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  ext_image_url?: string | null; // matched Daltile silo image (product_external_refs), fallback only
};

export type CatalogQuery = {
  q?: string;
  status?: string;
  recordTab?: string;
  reviewOnly?: boolean;
  sortId?: string;
  sortDesc?: boolean;
  offset?: number;
  limit?: number;
  categoryPath?: string;
};

export type CatalogFacets = {
  total: number;
  active: number;
  special_order: number;
  needs_review: number;
  by_record: { all: number; published: number; draft: number; pending_approval: number; archived: number };
};
