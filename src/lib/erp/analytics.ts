// Shared analytics types + period helpers (plain module — not "use server").

export type TrendItem = { label: string; value: number };

export type StoreStats = {
  period: string;
  store: string | null;
  range_start: string | null;
  range_end: string | null;
  net_sales: number;
  units: number;
  txns: number;
  avg_sale: number;
  cogs: number;
  gm: number;
  margin_pct: number | null;
  trend_sales: TrendItem[];
  trend_units: TrendItem[];
  top_products: TrendItem[];
};

export type VendorRow = {
  vendor_id: number;
  vendor: string;
  net_sales: number;
  units: number;
  gm: number;
  margin_pct: number | null;
  product_count: number;
  inventory_value: number;
  avg_margin_pct: number | null;
  below_cost: number;
  needs_review: number;
};
export type VendorStats = { period: string; trend_sales: TrendItem[]; vendors: VendorRow[] };

export type CategoryRow = Omit<VendorRow, "vendor_id" | "vendor"> & { category: string };
export type CategoryStats = { period: string; parent: string | null; trend_sales: TrendItem[]; categories: CategoryRow[] };

export const PERIODS = [
  { v: "week", l: "Week" },
  { v: "month", l: "Month" },
  { v: "quarter", l: "Quarter" },
  { v: "year", l: "Year" },
] as const;

export type Period = "week" | "month" | "quarter" | "year";
export const normalizePeriod = (p?: string): Period =>
  (["week", "month", "quarter", "year"].includes(p ?? "") ? (p as Period) : "month");
