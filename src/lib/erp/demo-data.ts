/**
 * La semilla del modo demo de Inventario (D-941): datos INVENTADOS, ni una tienda, proveedor ni cliente real. Pura y sin
 * azar: la fecha entra por argumento, así una captura de hoy y otra de mañana enseñan lo mismo y las pruebas la fijan.
 *
 * Los agregados (panel, facetas, analítica, reorden) se CALCULAN de los productos, no se escriben a mano: lo que dice el
 * panel y lo que se ve en el catálogo no pueden contradecirse en un manual.
 */
export { AVISO_DEL_DEMO } from "@/lib/home/demo-data";

export type Fila = Record<string, unknown>;

export const PERFIL_ERP_DEMO = {
  id: "demo-erp-admin", full_name: "Demo Admin", email: "admin@demo.example", role: "admin", erp_role: "admin",
  module_access: ["erp"], recruiting_role: null, timetracker_role: null, store: "T1",
};

export const TIENDAS_DEMO = [
  { id: "T1", name: "Demo Tienda Norte" },
  { id: "T2", name: "Demo Tienda Sur" },
  { id: "W1", name: "Demo Bodega" },
];

export const PROVEEDORES_DEMO = [
  { id: 1, name: "Demo Ceramics Co" },
  { id: 2, name: "Ejemplo Stone Works" },
  { id: 3, name: "Muestra Flooring Inc" },
  { id: 4, name: "Sample Setting Supply" },
];

export const CATEGORIAS_DEMO = [
  { id: 1, path: "Stone > Marble" },
  { id: 2, path: "Stone > Travertine" },
  { id: 3, path: "Supplies > Grout" },
  { id: 4, path: "Supplies > Thinset" },
  { id: 5, path: "Tile > Ceramic" },
  { id: 6, path: "Tile > Porcelain" },
  { id: 7, path: "Wood > Laminate" },
  { id: 8, path: "Wood > Vinyl" },
];

type Base = {
  sku: string; name: string; cat: number; prov: number; size: string | null; material: string; finish: string | null; color: string;
  price: number; cost: number; sf: number | null; status?: string; record?: string; tags?: string[]; qoh: [number, number, number]; mpn: string;
};

const BASES: Base[] = [
  { sku: "DM-1001", name: "Demo Carrara Porcelain 12x24", cat: 6, prov: 1, size: "12x24", material: "Porcelain", finish: "Matte", color: "White", price: 3.49, cost: 1.95, sf: 15.5, qoh: [120, 80, 310], mpn: "DC-CAR-1224" },
  { sku: "DM-1002", name: "Demo Slate Porcelain 12x24", cat: 6, prov: 3, size: "12x24", material: "Porcelain", finish: "Matte", color: "Gray", price: 3.29, cost: 2.1, sf: 15.5, qoh: [18, 25, 140], mpn: "MF-SLA-1224" },
  { sku: "DM-1003", name: "Demo Oak Look Porcelain 8x48", cat: 6, prov: 1, size: "8x48", material: "Porcelain", finish: "Textured", color: "Brown", price: 4.25, cost: 2.6, sf: 13.2, qoh: [64, 12, 96], tags: ["missing_image"], mpn: "DC-OAK-848" },
  { sku: "DM-1004", name: "Demo Concrete Porcelain 24x24", cat: 6, prov: 3, size: "24x24", material: "Porcelain", finish: "Polished", color: "Gray", price: 4.75, cost: 2.95, sf: 16, status: "special_order", qoh: [0, 0, 44], mpn: "MF-CON-2424" },
  { sku: "DM-1005", name: "Demo Subway Ceramic 3x6", cat: 5, prov: 1, size: "3x6", material: "Ceramic", finish: "Glossy", color: "White", price: 2.15, cost: 0.98, sf: 10, qoh: [210, 175, 500], mpn: "DC-SUB-36" },
  { sku: "DM-1006", name: "Demo Hex Ceramic 4x4", cat: 5, prov: 2, size: "4x4", material: "Ceramic", finish: "Matte", color: "Black", price: 3.1, cost: 1.7, sf: 8, tags: ["missing_sf_per_box"], qoh: [33, 15, 60], mpn: "ES-HEX-44" },
  { sku: "DM-1007", name: "Demo Terracotta Ceramic 12x12", cat: 5, prov: 2, size: "12x12", material: "Ceramic", finish: "Matte", color: "Red", price: 1.95, cost: 1.12, sf: 11, status: "inactive", qoh: [4, 0, 8], mpn: "ES-TER-1212" },
  { sku: "DM-1008", name: "Demo Calacatta Marble 12x24", cat: 1, prov: 2, size: "12x24", material: "Marble", finish: "Polished", color: "White", price: 12.5, cost: 7.8, sf: 8, qoh: [22, 16, 70], mpn: "ES-CAL-1224" },
  { sku: "DM-1009", name: "Demo Emperador Marble 18x18", cat: 1, prov: 2, size: "18x18", material: "Marble", finish: "Honed", color: "Brown", price: 10.9, cost: 6.4, sf: 9, tags: ["size_mismatch", "missing_image"], qoh: [9, -3, 30], mpn: "ES-EMP-1818" },
  { sku: "DM-1010", name: "Demo Ivory Travertine 18x18", cat: 2, prov: 2, size: "18x18", material: "Travertine", finish: "Honed", color: "Beige", price: 6.75, cost: 3.9, sf: 9, qoh: [48, 52, 120], mpn: "ES-IVO-1818" },
  { sku: "DM-1011", name: "Demo Walnut Travertine 16x16", cat: 2, prov: 2, size: "16x16", material: "Travertine", finish: "Tumbled", color: "Brown", price: 5.95, cost: 3.45, sf: 8.9, status: "discontinued", qoh: [6, 2, 0], mpn: "ES-WAL-1616" },
  { sku: "DM-1012", name: "Demo Rustic Oak Laminate", cat: 7, prov: 3, size: "7x48", material: "Laminate", finish: "Textured", color: "Brown", price: 2.45, cost: 1.35, sf: 23.6, qoh: [140, 95, 280], mpn: "MF-RUS-748" },
  { sku: "DM-1013", name: "Demo Gray Ash Laminate", cat: 7, prov: 3, size: "7x48", material: "Laminate", finish: "Matte", color: "Gray", price: 2.65, cost: 1.5, sf: 23.6, qoh: [30, 21, 75], mpn: "MF-ASH-748" },
  { sku: "DM-1014", name: "Demo Lakeside Vinyl Plank", cat: 8, prov: 3, size: "9x60", material: "Vinyl", finish: "Matte", color: "Beige", price: 3.15, cost: 1.8, sf: 22, qoh: [75, 60, 190], mpn: "MF-LAK-960" },
  { sku: "DM-1015", name: "Demo Harbor Vinyl Plank", cat: 8, prov: 1, size: "9x60", material: "Vinyl", finish: "Textured", color: "Gray", price: 3.35, cost: 1.92, sf: 22, tags: ["low_margin"], qoh: [12, 38, 66], mpn: "DC-HAR-960" },
  { sku: "DM-1016", name: "Demo Sanded Grout Bright White 25 lb", cat: 3, prov: 4, size: null, material: "Grout", finish: null, color: "White", price: 21.5, cost: 12.25, sf: null, qoh: [55, 44, 200], mpn: "SS-GRT-25W" },
  { sku: "DM-1017", name: "Demo Unsanded Grout Charcoal 10 lb", cat: 3, prov: 4, size: null, material: "Grout", finish: null, color: "Black", price: 14.25, cost: 7.9, sf: null, qoh: [26, 19, 90], mpn: "SS-GRT-10C" },
  { sku: "DM-1018", name: "Demo Premium Thinset 50 lb", cat: 4, prov: 4, size: null, material: "Thinset", finish: null, color: "Gray", price: 28.95, cost: 16.4, sf: null, qoh: [88, 70, 260], mpn: "SS-THN-50" },
  { sku: "DM-1019", name: "Demo Mosaic Draft 2x2", cat: 5, prov: 1, size: "2x2", material: "Ceramic", finish: "Glossy", color: "Blue", price: 6.2, cost: 3.5, sf: 10, record: "draft", qoh: [0, 0, 0], mpn: "DC-MOS-22" },
  { sku: "DM-1020", name: "Demo Linen Porcelain 24x48", cat: 6, prov: 1, size: "24x48", material: "Porcelain", finish: "Matte", color: "Beige", price: 6.45, cost: 3.85, sf: 15.5, record: "pending_approval", qoh: [0, 0, 24], mpn: "DC-LIN-2448" },
  // El par de la fusión de duplicados: mismo MPN que DM-1001, con la marca ~MERGE que dejó la carga.
  { sku: "DM-1001~MERGE", name: "Demo Carrara Porcelain 12x24 (duplicate)", cat: 6, prov: 1, size: "12x24", material: "Porcelain", finish: "Matte", color: "White", price: 3.39, cost: 2.0, sf: 15.5, tags: ["duplicate_sku"], qoh: [0, 0, 0], mpn: "DC-CAR-1224" },
];

/** Los productos empiezan en este id; `/erp/product/1` es DM-1001. */
export const ID_PRODUCTO_DEMO = 1;
export const PUNTO_DE_REORDEN = 30;

const redondea = (n: number) => Math.round(n * 100) / 100;
const fraccion = (n: number) => Math.round(n * 10000) / 10000;
const dia = (ahora: Date, atras: number) => new Date(ahora.getTime() - atras * 86_400_000).toISOString().slice(0, 10);
const instante = (ahora: Date, atras: number) => new Date(ahora.getTime() - atras * 86_400_000).toISOString();
const proveedor = (id: number) => PROVEEDORES_DEMO.find((p) => p.id === id)?.name ?? null;
const categoria = (id: number) => CATEGORIAS_DEMO.find((c) => c.id === id)?.path ?? null;
const margenDe = (b: Base) => redondea(((b.price - b.cost) / b.price) * 100);

export function productosDemo(ahora: Date): Fila[] {
  return BASES.map((b, i) => ({
    id: i + 1, sku: b.sku, name: b.name, status: b.status ?? "active", record_status: b.record ?? "published",
    product_type: "stock", category_id: b.cat, category_path: categoria(b.cat), vendor_id: b.prov, vendor_name: proveedor(b.prov),
    price: b.price, sell_unit: b.sf ? "SF" : "EA", base_unit: b.sf ? "BOX" : "EA", cost: b.cost, margin_pct: margenDe(b),
    qoh: b.qoh[0] + b.qoh[1] + b.qoh[2], needs_review: (b.tags?.length ?? 0) > 0, review_tags: b.tags ?? [], verified_level: i % 3,
    seo_title: b.name, seo_description: `Demo description for ${b.name}.`, collection: `Demo ${b.material}`, size_in: b.size, size_cm: null, finish: b.finish, material: b.material,
    look: null, origin: "Demo", color1: b.color, color2: null, style: "Modern", color_observation: null, substitute_color: null, shape: b.size ? "Rectangle" : null, mpn: b.mpn, sf_per_box: b.sf,
    pieces_per_box: b.sf ? 8 : 1, boxes_per_pallet: b.sf ? 40 : 60, weight_per_box_lbs: b.sf ? 42 : 25, moq_group: null, lead_time_days: 21, moq: 10, description: `Demo product: ${b.name}.`,
    image_url: null, image_urls: null, product_url: null, folder_url: null, price_erp: b.price, price_sales: redondea(b.price * 0.95), price_mgr: redondea(b.price * 0.9), price_vol: redondea(b.price * 0.85),
    price_kind: "list", price_mode: "fixed", price_approved: true, taxable: true, barcode_upc: `0000000${1000 + i}`, discontinue_reason: b.status === "discontinued" ? "Demo: series closed" : null, date_added: dia(ahora, 200 - i * 5),
  }));
}

export function existenciasDemo(): Fila[] {
  return BASES.flatMap((b, i) => TIENDAS_DEMO.map((t, k) => ({
    product_id: i + 1, store_id: t.id, qoh: b.qoh[k], qb_code: `${b.sku}-${t.id}`, qb_description: b.name, assortment_active: b.qoh[k] > 0,
    store_price: b.price, qoh_verified: i % 2 === 0, store_cost: b.cost, store_margin_pct: margenDe(b),
  })));
}

const cuenta = (filas: Fila[], f: (x: Fila) => boolean) => filas.filter(f).length;
function ranking(valores: unknown[]) {
  const m = new Map<string, number>();
  for (const v of valores) if (v) m.set(String(v), (m.get(String(v)) ?? 0) + 1);
  return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}
const nivel1 = (p: unknown) => String(p ?? "").split(" > ")[0];
const etiquetasDe = (p: Fila[]) => p.flatMap((x) => x.review_tags as string[]);

export function panelDemo(ahora: Date) {
  const p = productosDemo(ahora);
  const porEstado = (s: string) => cuenta(p, (x) => x.status === s);
  return {
    total: p.length, active: porEstado("active"), special_order: porEstado("special_order"), inactive: porEstado("inactive"), discontinued: porEstado("discontinued"),
    needs_review: cuenta(p, (x) => x.needs_review === true), categorized: cuenta(p, (x) => !!x.category_path), priced: cuenta(p, (x) => x.price != null), with_image: 0,
    by_status: ranking(p.map((x) => x.status)), by_tag: ranking(etiquetasDe(p)), top_categories: ranking(p.map((x) => x.category_path)), top_vendors: ranking(p.map((x) => x.vendor_name)),
  };
}

export function facetasDelCatalogo(ahora: Date) {
  const p = productosDemo(ahora);
  const r = (s: string) => cuenta(p, (x) => x.record_status === s);
  return {
    total: p.length, active: cuenta(p, (x) => x.status === "active"), special_order: cuenta(p, (x) => x.status === "special_order"), needs_review: cuenta(p, (x) => x.needs_review === true),
    by_record: { all: p.length, published: r("published"), draft: r("draft"), pending_approval: r("pending_approval"), archived: r("archived") },
  };
}

export function facetasDeRevision(ahora: Date) {
  const p = productosDemo(ahora);
  return { total: cuenta(p, (x) => x.needs_review === true), tags: ranking(etiquetasDe(p)).map((x) => ({ tag: x.label, n: x.value })) };
}

export function vocabularioDemo() {
  const unicos = (f: (b: Base) => string | null) => [...new Set(BASES.map(f).filter((v): v is string => !!v))].sort();
  return { base_unit: ["BOX", "EA"], material: unicos((b) => b.material), finish: unicos((b) => b.finish), style: ["Modern"], color: unicos((b) => b.color) };
}

export function categoriasParaExplorar(ahora: Date) {
  const p = productosDemo(ahora);
  return [...new Set(p.map((x) => nivel1(x.category_path)))].sort().map((category) => {
    const miembros = p.filter((x) => nivel1(x.category_path) === category);
    return { category, product_count: miembros.length, sample: miembros.slice(0, 3).map((m) => ({ id: m.id, name: m.name })) };
  });
}

const vendible = (p: Fila) => p.record_status === "published" && !String(p.sku).includes("~MERGE");

export function gruposDeCompra(ahora: Date, limite = 25, desde = 0) {
  const m = new Map<string, Fila[]>();
  for (const x of productosDemo(ahora).filter((y) => y.size_in && vendible(y))) {
    const k = `${x.size_in}|${x.material}`;
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  const todos = [...m].filter(([, v]) => v.length >= 2).map(([group_key, v]) => ({
    group_key, member_count: v.length, label: group_key.replace("|", " · "),
    members: v.map((x) => ({
      id: x.id, sku: x.sku, name: x.name, vendor: x.vendor_name, cost: x.cost, last_price: x.cost, last_price_date: dia(ahora, 30), lead_time_days: x.lead_time_days, moq: x.moq, qoh: x.qoh,
      reorder_point: PUNTO_DE_REORDEN, min_level: 20, max_level: 200, size_in: x.size_in, shape: x.shape, color: x.color1, finish: x.finish, material: x.material, image: null,
    })),
  }));
  return { total_groups: todos.length, total_grouped_products: todos.reduce((s, g) => s + g.member_count, 0), groups: todos.slice(desde, desde + limite) };
}

export function reordenDemo(ahora: Date, tienda: string | null) {
  const p = productosDemo(ahora);
  const items = existenciasDemo()
    .filter((e) => (tienda === null || e.store_id === tienda) && (e.qoh as number) <= PUNTO_DE_REORDEN)
    .map((e) => ({ e, x: p[(e.product_id as number) - 1] }))
    .filter(({ x }) => x.status === "active" && vendible(x))
    .map(({ x, e }) => ({
      product_id: x.id, sku: x.sku, name: x.name, vendor: x.vendor_name, store_id: e.store_id, qoh: e.qoh, reorder_point: PUNTO_DE_REORDEN, demand: 12, lead_time_months: 1,
      abc_class: (x.id as number) % 2 ? "A" : "B", suggested_qty: PUNTO_DE_REORDEN * 2 - (e.qoh as number), cost: x.cost,
    }));
  return { total: items.length, store: tienda, items };
}

// ---- Órdenes de compra ---- [producto, cantidad, precio, cantidad confirmada, precio confirmado, ya recibido]
type LineaOc = [number, number, number, number | null, number | null, number];
type Oc = { id: number; po_number: string; prov: number; atras: number; status: string; ack?: string; lineas: LineaOc[] };
export const OCS_DEMO: Oc[] = [
  { id: 101, po_number: "PO-DEMO-101", prov: 1, atras: 3, status: "draft", lineas: [[5, 200, 0.98, null, null, 0], [15, 80, 1.92, null, null, 0]] },
  { id: 102, po_number: "PO-DEMO-102", prov: 2, atras: 9, status: "sent", lineas: [[8, 60, 7.8, null, null, 0], [10, 120, 3.9, null, null, 0]] },
  { id: 103, po_number: "PO-DEMO-103", prov: 3, atras: 20, status: "acknowledged", ack: "ACK-DEMO-103", lineas: [[2, 150, 2.1, 150, 2.35, 0], [12, 300, 1.35, 280, 1.35, 0], [14, 90, 1.8, 90, 1.8, 0]] },
  { id: 104, po_number: "PO-DEMO-104", prov: 4, atras: 28, status: "partial", ack: "ACK-DEMO-104", lineas: [[16, 100, 12.25, 100, 12.25, 40], [18, 200, 16.4, 200, 16.4, 0]] },
  { id: 105, po_number: "PO-DEMO-105", prov: 1, atras: 60, status: "received", ack: "ACK-DEMO-105", lineas: [[1, 240, 1.95, 240, 1.95, 240]] },
];
/** La orden que el manual abre para enseñar la recepción: tiene líneas pendientes. */
export const OC_PARA_RECIBIR = 104;

export function conciliacionDemo(ahora: Date, id: number) {
  const oc = OCS_DEMO.find((o) => o.id === id);
  if (!oc) return null;
  const p = productosDemo(ahora);
  const tolerances = { price_pct: 0.02, qty_pct: 0.02, total_pct: 0.02 };
  const lines = oc.lineas.map(([pid, qty, rate, aq, ap], i) => {
    const x = p[pid - 1];
    const conAck = aq !== null && ap !== null;
    const price_pct = conAck ? fraccion((ap - rate) / rate) : null;
    const qty_pct = conAck ? fraccion((aq - qty) / qty) : null;
    const po_amount = redondea(qty * rate);
    const ack_amount = conAck ? redondea(aq * ap) : null;
    const total_diff = ack_amount === null ? null : redondea(ack_amount - po_amount);
    const total_pct = total_diff === null ? null : fraccion(total_diff / po_amount);
    return {
      mpn: x.mpn, description: x.name, sf_per_box: x.sf_per_box, line_status: conAck ? "matched" : "po_only", po_line_no: i + 1, po_qty: qty, po_uom: x.base_unit, po_unit_rate: rate, po_amount, po_unit_per_pi2: null, po_boxes: qty,
      ack_line_no: conAck ? i + 1 : null, ack_uom: conAck ? x.base_unit : null, ack_quantity: aq, ack_boxes: aq, ack_unit_price: ap, ack_amount, price_pct, price_flag: Math.abs(price_pct ?? 0) > tolerances.price_pct,
      qty_diff: conAck ? aq - qty : null, qty_pct, qty_flag: Math.abs(qty_pct ?? 0) > tolerances.qty_pct, total_diff, total_pct, total_flag: Math.abs(total_pct ?? 0) > tolerances.total_pct, product_id: pid, po_line_id: id * 10 + i, ack_line_id: conAck ? id * 100 + i : null,
    };
  });
  const po_total = redondea(lines.reduce((s, l) => s + l.po_amount, 0));
  const hayAck = !!oc.ack;
  const ack_merchandise = hayAck ? redondea(lines.reduce((s, l) => s + (l.ack_amount ?? 0), 0)) : null;
  const freight = hayAck ? 150 : null;
  const ack_total = ack_merchandise === null ? null : redondea(ack_merchandise + 150);
  const flagged_lines = lines.filter((l) => l.price_flag || l.qty_flag || l.total_flag).length;
  const merch_gap = ack_merchandise === null ? null : redondea(ack_merchandise - po_total);
  const total_gap = ack_total === null ? null : redondea(ack_total - po_total);
  return {
    po: { id, po_number: oc.po_number, vendor_name: proveedor(oc.prov), po_date: dia(ahora, oc.atras), buyer_user: "Demo Admin", currency: "USD", status: oc.status, ship_to_name: "Demo Bodega", total: po_total, source_pdf_ref: null },
    ack: hayAck ? { ack_document_no: oc.ack as string, ack_date: dia(ahora, oc.atras - 2), order_type: "Stock", incoterm: "FOB", payment_terms: "Net 30", salesperson: "Demo Rep", currency: "USD", freight, iva_pct: 0, total: ack_total, source_pdf_ref: null } : null,
    lines,
    summary: {
      line_count: lines.length, matched: lines.filter((l) => l.line_status === "matched").length, po_only: lines.filter((l) => l.line_status === "po_only").length, ack_only: 0,
      price_flags: lines.filter((l) => l.price_flag).length, qty_flags: lines.filter((l) => l.qty_flag).length, total_flags: lines.filter((l) => l.total_flag).length, flagged_lines,
      po_total, ack_total, total_gap, total_gap_pct: total_gap === null ? null : fraccion(total_gap / po_total), ack_merchandise, merch_gap, merch_gap_pct: merch_gap === null ? null : fraccion(merch_gap / po_total), tax_and_freight: freight, ack_count: hayAck ? 1 : 0, has_discrepancies: flagged_lines > 0,
    },
    tolerances,
  };
}

export function ordenesDemo(ahora: Date) {
  return {
    orders: OCS_DEMO.map((o) => {
      const r = conciliacionDemo(ahora, o.id) as NonNullable<ReturnType<typeof conciliacionDemo>>;
      return {
        id: o.id, po_number: o.po_number, vendor_name: r.po.vendor_name, po_date: r.po.po_date, status: o.status, currency: "USD", total: r.po.total, po_line_count: r.lines.length, ack_count: r.summary.ack_count,
        ack_document_no: r.ack?.ack_document_no ?? null, ack_date: r.ack?.ack_date ?? null, ack_total: r.summary.ack_total, total_gap: r.summary.total_gap, merch_gap: r.summary.merch_gap, flagged_lines: r.summary.flagged_lines, has_discrepancies: r.summary.has_discrepancies,
      };
    }),
  };
}

export function recepcionDemo(ahora: Date, id: number) {
  const oc = OCS_DEMO.find((o) => o.id === id);
  if (!oc) return null;
  const p = productosDemo(ahora);
  return {
    po_id: id, po_number: oc.po_number, status: oc.status, vendor_name: proveedor(oc.prov), currency: "USD", store_id: "W1", ack_freight: oc.ack ? 150 : null,
    lines: oc.lineas.map(([pid, qty, rate, , , recibido], i) => ({
      po_line_id: id * 10 + i, line_no: i + 1, vendor_item_no: p[pid - 1].mpn, product_id: pid, sku: p[pid - 1].sku, name: p[pid - 1].name, description: p[pid - 1].name,
      uom: p[pid - 1].base_unit, qty, unit_rate: rate, amount: redondea(qty * rate), received_qty: recibido, remaining: qty - recibido,
    })),
  };
}

export function solicitudesDemo(ahora: Date): Fila[] {
  const yo = PERFIL_ERP_DEMO.id;
  return [
    { id: 1, type: "edit", product_id: 2, payload: { price: 3.49, finish: "Polished" }, reason: "Demo: el proveedor subió el precio.", requester: "demo-ana", requester_store: "T1", requester_status: "ready", status: "pending", decision_note: null, created_at: instante(ahora, 4) },
    { id: 2, type: "deactivate", product_id: 7, payload: {}, reason: "Demo: sin ventas este año.", requester: "demo-beto", requester_store: "T2", requester_status: "not_ready", status: "pending", decision_note: null, created_at: instante(ahora, 3) },
    { id: 3, type: "reactivate", product_id: 11, payload: {}, reason: "Demo: el cliente la volvió a pedir.", requester: yo, requester_store: "T1", requester_status: "ready", status: "pending", decision_note: null, created_at: instante(ahora, 2) },
    { id: 4, type: "new", product_id: 19, payload: { name: "Demo Mosaic Draft 2x2" }, reason: "Demo: artículo nuevo.", requester: yo, requester_store: "T1", requester_status: "ready", status: "pending", decision_note: null, created_at: instante(ahora, 1) },
    { id: 5, type: "edit", product_id: 5, payload: { price: 2.25 }, reason: "Demo: ajuste de precio.", requester: yo, requester_store: "T1", requester_status: "ready", status: "approved", decision_note: "Demo: aprobado.", created_at: instante(ahora, 12) },
  ];
}

export function conteosDemo(ahora: Date) {
  const p = productosDemo(ahora);
  const fila = (id: number, pid: number, store_id: string, counted_qty: number, system_qty: number, status: string, atras: number) => ({
    id, product_id: pid, sku: p[pid - 1].sku, name: p[pid - 1].name, store_id, counted_qty, system_qty, variance: counted_qty - system_qty, tolerance_pct: 2, status,
    counted_at: instante(ahora, atras), reconciled_at: status === "reconciled" ? instante(ahora, atras - 1) : null,
  });
  return [fila(1, 1, "T1", 118, 120, "pending", 2), fila(2, 5, "T2", 175, 175, "reconciled", 6), fila(3, 8, "W1", 66, 70, "pending", 1)];
}

export function saldosNegativos(ahora: Date) {
  const p = productosDemo(ahora);
  return existenciasDemo().filter((e) => (e.qoh as number) < 0).map((e) => {
    const x = p[(e.product_id as number) - 1];
    return { product_id: x.id, sku: x.sku, name: x.name, store_id: e.store_id, qoh: e.qoh };
  });
}

// ---- Analítica: ventas calculadas del catálogo, sin azar ----
const SEMANAS: Record<string, number> = { week: 1, month: 4, quarter: 13, year: 52 };
type Venta = { p: Fila; store: string; units: number; net: number; cogs: number };

function ventas(ahora: Date, periodo: string): Venta[] {
  const k = SEMANAS[periodo] ?? 4;
  return productosDemo(ahora).filter(vendible).flatMap((p) => TIENDAS_DEMO.map((t, i) => {
    const units = (((p.id as number) * 3 + i * 2) % 9 + 3) * k;
    return { p, store: t.id, units, net: redondea(units * (p.price as number)), cogs: redondea(units * (p.cost as number)) };
  }));
}

/** Seis tramos con peso creciente; el último absorbe el redondeo para que la suma sea exactamente el total. */
function tendencia(ahora: Date, periodo: string, total: number) {
  const n = 6, peso = 21, paso = Math.max(1, Math.round(((SEMANAS[periodo] ?? 4) * 7) / n));
  let acumulado = 0;
  return Array.from({ length: n }, (_, i) => {
    const value = i === n - 1 ? redondea(total - acumulado) : redondea((total * (i + 1)) / peso);
    acumulado = redondea(acumulado + value);
    return { label: dia(ahora, (n - 1 - i) * paso), value };
  });
}

const suma = (v: Venta[], f: (x: Venta) => number) => redondea(v.reduce((s, x) => s + f(x), 0));
const margen = (net: number, gm: number) => (net ? redondea((gm / net) * 100) : null);

function agregado(v: Venta[]) {
  const net_sales = suma(v, (x) => x.net), gm = redondea(net_sales - suma(v, (x) => x.cogs));
  const miembros = [...new Map(v.map((x) => [x.p.id as number, x.p])).values()];
  return {
    net_sales, units: suma(v, (x) => x.units), gm, margin_pct: margen(net_sales, gm), product_count: miembros.length,
    inventory_value: redondea(miembros.reduce((s, p) => s + Math.max(0, p.qoh as number) * (p.cost as number), 0)),
    avg_margin_pct: redondea(miembros.reduce((s, p) => s + (p.margin_pct as number), 0) / (miembros.length || 1)),
    below_cost: miembros.filter((p) => (p.price as number) < (p.cost as number)).length, needs_review: miembros.filter((p) => p.needs_review === true).length,
  };
}

export function analiticaDeTienda(ahora: Date, periodo: string, tienda: string | null) {
  const v = ventas(ahora, periodo).filter((x) => tienda === null || x.store === tienda);
  const a = agregado(v), cogs = suma(v, (x) => x.cogs);
  const porProducto = new Map<string, number>();
  for (const x of v) porProducto.set(x.p.name as string, redondea((porProducto.get(x.p.name as string) ?? 0) + x.net));
  return {
    period: periodo, store: tienda, range_start: dia(ahora, (SEMANAS[periodo] ?? 4) * 7), range_end: dia(ahora, 0), net_sales: a.net_sales, units: a.units, txns: v.length * 5,
    avg_sale: redondea(a.net_sales / (v.length * 5)), cogs, gm: a.gm, margin_pct: a.margin_pct, trend_sales: tendencia(ahora, periodo, a.net_sales), trend_units: tendencia(ahora, periodo, a.units),
    top_products: [...porProducto].map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value).slice(0, 8),
  };
}

export function analiticaDeProveedores(ahora: Date, periodo: string) {
  const v = ventas(ahora, periodo);
  const vendors = PROVEEDORES_DEMO.map((p) => ({ vendor_id: p.id, vendor: p.name, ...agregado(v.filter((x) => x.p.vendor_id === p.id)) })).sort((a, b) => b.net_sales - a.net_sales);
  return { period: periodo, trend_sales: tendencia(ahora, periodo, suma(v, (x) => x.net)), vendors };
}

export function analiticaDeCategorias(ahora: Date, periodo: string, padre: string | null) {
  const v = ventas(ahora, periodo).filter((x) => padre === null || nivel1(x.p.category_path) === padre);
  const clave = (x: Venta) => (padre === null ? nivel1(x.p.category_path) : String(x.p.category_path));
  const categories = [...new Set(v.map(clave))].sort().map((category) => ({ category, ...agregado(v.filter((x) => clave(x) === category)) }));
  return { period: periodo, parent: padre, trend_sales: tendencia(ahora, periodo, suma(v, (x) => x.net)), categories };
}

const REFERENCIA = (id: number, product_id: number, clave: string, titulo: string, tam: string, acabado: string, color: string, metodo: string, confianza: number, estado: string) => ({
  id, product_id, external_sku: `EXT-${clave}`, external_url: `https://example.com/demo/${clave.toLowerCase()}`, external_title: titulo, series_name: "Demo Series", nominal_size: tam, finish: acabado, color_name: color,
  specs: { feature_tags: ["Floor", "Wall"], is_made_in_usa: false }, image_urls: null, match_method: metodo, match_confidence: confianza, match_status: estado,
});

/** Todas las tablas que leen las pantallas de `/erp/**`. Lo que no esté aquí vale como vacío. */
export function tablasDemoErp(ahora: Date): Record<string, Fila[]> {
  return {
    profiles: [{ ...PERFIL_ERP_DEMO }, { id: "demo-ana", full_name: "Ana Demo" }, { id: "demo-beto", full_name: "Beto Demo" }],
    app_products: productosDemo(ahora),
    app_store_products: existenciasDemo(),
    stores: TIENDAS_DEMO.map((t) => ({ ...t })),
    vendors: PROVEEDORES_DEMO.map((v) => ({ ...v })),
    categories: CATEGORIAS_DEMO.map((c) => ({ ...c })),
    product_requests: solicitudesDemo(ahora),
    product_images: [],
    product_relations: [{ product_id: 1, related_product_id: 2, relation: "bro" }, { product_id: 1, related_product_id: 4, relation: "cuz" }, { product_id: 1, related_product_id: 3, relation: "sub" }],
    app_price_history: [0, 90, 180].map((atras, i) => ({ id: i + 1, product_id: 1, effective_from: dia(ahora, atras), store_id: null, price: redondea(3.49 - i * 0.1), cost: redondea(1.95 - i * 0.05), source: "demo" })),
    app_lots: [{ id: 1, product_id: 1, lot_number: "LOT-DEMO-1", received_date: dia(ahora, 60), status: "open", base_cost: 1.95, freight_cost: 0.08, duty_cost: 0.04, landed_cost: 2.07 }],
    saved_views: [{ id: 1, name: "Demo: para revisar", scope: "catalog", state: { reviewOnly: true }, created_at: instante(ahora, 30) }, { id: 2, name: "Demo: sin imagen", scope: "review", state: { issue: "missing_image" }, created_at: instante(ahora, 20) }],
    product_external_refs: [
      REFERENCIA(1, 5, "SUB-36", "Demo Subway 3x6", "3x6", "Glossy", "White", "mpn", 0.97, "auto"),
      REFERENCIA(2, 3, "OAK-848", "Demo Oak Plank 8x48", "8x48", "Textured", "Brown", "name_size", 0.72, "auto"),
      REFERENCIA(3, 1, "CAR-1224", "Demo Carrara 12x24", "12x24", "Matte", "White", "sku", 1, "confirmed"),
    ],
  };
}

type Args = Record<string, unknown> | undefined;

/** Las funciones de la base que LEEN. Las que escriben no están: contestan el aviso del demo. */
export function rpcsDemoErp(ahora: Date): Record<string, (a: Args) => unknown> {
  const num = (a: Args, k: string) => Number(a?.[k]);
  const texto = (a: Args, k: string) => (typeof a?.[k] === "string" ? (a[k] as string) : null);
  return {
    dashboard_stats: () => panelDemo(ahora),
    catalog_facets: () => facetasDelCatalogo(ahora),
    review_tag_facets: () => facetasDeRevision(ahora),
    product_vocabulary: () => vocabularioDemo(),
    category_browse: () => categoriasParaExplorar(ahora),
    purchasing_groups: (a) => gruposDeCompra(ahora, num(a, "p_limit"), num(a, "p_offset")),
    reorder_report: (a) => reordenDemo(ahora, texto(a, "p_store")),
    list_purchase_orders: () => ordenesDemo(ahora),
    reconcile_po: (a) => conciliacionDemo(ahora, num(a, "p_po_id")),
    po_receiving_detail: (a) => recepcionDemo(ahora, num(a, "p_po_id")),
    suggest_po_line_matches: () => [],
    list_cycle_counts: () => conteosDemo(ahora),
    negative_balances: () => saldosNegativos(ahora),
    analytics_store_stats: (a) => analiticaDeTienda(ahora, texto(a, "p_period") ?? "month", texto(a, "p_store")),
    analytics_vendor_stats: (a) => analiticaDeProveedores(ahora, texto(a, "p_period") ?? "month"),
    analytics_category_stats: (a) => analiticaDeCategorias(ahora, texto(a, "p_period") ?? "month", texto(a, "p_parent")),
  };
}
