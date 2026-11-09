import { describe, expect, it } from "vitest";
import {
  analiticaDeCategorias, analiticaDeProveedores, analiticaDeTienda, conciliacionDemo, existenciasDemo, facetasDelCatalogo, facetasDeRevision, gruposDeCompra,
  OC_PARA_RECIBIR, OCS_DEMO, ordenesDemo, panelDemo, productosDemo, PUNTO_DE_REORDEN, recepcionDemo, reordenDemo, rpcsDemoErp, saldosNegativos, tablasDemoErp, TIENDAS_DEMO,
} from "./demo-data";
import { clienteDemoDelErp } from "./cliente-demo";

// La semilla del demo de Inventario, con la fecha fija: lo que afirman estas pruebas es lo que el manual enseña.
const AHORA = new Date("2026-11-09T15:00:00Z");

describe("la semilla de Inventario", () => {
  const p = productosDemo(AHORA);

  it("tiene unos 20 productos con SKU único, proveedor, precio y existencias por tienda", () => {
    expect(p.length).toBeGreaterThanOrEqual(20);
    expect(new Set(p.map((x) => x.sku)).size).toBe(p.length);
    for (const x of p) { expect(x.vendor_name).toBeTruthy(); expect(x.category_path).toBeTruthy(); expect(x.price).toBeGreaterThan(0); }
    expect(existenciasDemo()).toHaveLength(p.length * TIENDAS_DEMO.length);
  });

  it("el stock del producto es la suma de sus tiendas", () => {
    for (const x of p) {
      const suma = existenciasDemo().filter((e) => e.product_id === x.id).reduce((s, e) => s + (e.qoh as number), 0);
      expect(suma, String(x.sku)).toBe(x.qoh);
    }
  });

  it("el panel y las facetas cuentan lo que hay en el catálogo", () => {
    const panel = panelDemo(AHORA), f = facetasDelCatalogo(AHORA);
    expect(panel.total).toBe(p.length);
    expect(panel.needs_review).toBe(p.filter((x) => (x.review_tags as string[]).length > 0).length);
    expect(panel.active + panel.special_order + panel.inactive + panel.discontinued).toBe(p.length);
    const r = f.by_record;
    expect(r.published + r.draft + r.pending_approval + r.archived).toBe(r.all);
    expect(facetasDeRevision(AHORA).total).toBe(panel.needs_review);
  });

  it("hay un ~MERGE con un candidato vivo del mismo MPN, para la fusión", () => {
    const perdedor = p.find((x) => String(x.sku).includes("~MERGE"))!;
    expect(p.filter((x) => x.mpn === perdedor.mpn && x.id !== perdedor.id).length).toBeGreaterThan(0);
  });

  it("el reorden solo trae lo que está en o bajo su punto, y respeta la tienda", () => {
    const todo = reordenDemo(AHORA, null), t1 = reordenDemo(AHORA, "T1");
    expect(todo.total).toBeGreaterThan(t1.total);
    expect(t1.total).toBeGreaterThan(0);
    for (const i of todo.items) expect(i.qoh as number).toBeLessThanOrEqual(PUNTO_DE_REORDEN);
    expect(t1.items.every((i) => i.store_id === "T1")).toBe(true);
  });

  it("hay un saldo negativo, sacado de las existencias", () => {
    expect(saldosNegativos(AHORA).map((s) => [s.sku, s.store_id, s.qoh])).toEqual([["DM-1009", "T2", -3]]);
  });

  it("los grupos de compra comparan el mismo físico entre proveedores y paginan", () => {
    const g = gruposDeCompra(AHORA, 25, 0);
    expect(g.total_groups).toBeGreaterThan(1);
    for (const x of g.groups) expect(x.member_count).toBeGreaterThanOrEqual(2);
    expect(g.groups.some((x) => new Set(x.members.map((m) => m.vendor)).size > 1)).toBe(true);
    expect(gruposDeCompra(AHORA, 1, 1).groups).toEqual(g.groups.slice(1, 2));
  });
});

describe("órdenes de compra del demo", () => {
  it("la lista sale de la conciliación: varios estados y una con discrepancias", () => {
    const { orders } = ordenesDemo(AHORA);
    expect(new Set(orders.map((o) => o.status)).size).toBeGreaterThanOrEqual(4);
    for (const o of orders) expect(o.flagged_lines).toBe(conciliacionDemo(AHORA, o.id)!.summary.flagged_lines);
    expect(orders.find((o) => o.id === 103)!.has_discrepancies).toBe(true);
    expect(orders.find((o) => o.id === 105)!.has_discrepancies).toBe(false);
  });

  it("marca el precio que se pasa de la tolerancia y no el que cuadra", () => {
    const l = conciliacionDemo(AHORA, 103)!.lines;
    expect(l[0].price_flag).toBe(true);
    expect(l[2].price_flag).toBe(false);
  });

  it("la orden para recibir tiene líneas pendientes y lo pendiente es pedido menos recibido", () => {
    const r = recepcionDemo(AHORA, OC_PARA_RECIBIR)!;
    expect(r.lines.some((l) => l.remaining > 0)).toBe(true);
    expect(r.lines[0]).toMatchObject({ qty: 100, received_qty: 40, remaining: 60 });
    expect(OCS_DEMO.find((o) => o.id === OC_PARA_RECIBIR)!.status).toBe("partial");
  });

  it("una orden que no existe no se inventa", () => {
    expect(conciliacionDemo(AHORA, 999)).toBeNull();
    expect(recepcionDemo(AHORA, 999)).toBeNull();
  });
});

describe("la analítica del demo", () => {
  it("cada tendencia suma exactamente el total", () => {
    for (const periodo of ["week", "month", "quarter", "year"]) {
      const s = analiticaDeTienda(AHORA, periodo, null);
      expect(Math.round(s.trend_sales.reduce((a, x) => a + x.value, 0) * 100) / 100).toBe(s.net_sales);
    }
  });

  it("proveedores y categorías reparten las mismas ventas que la tienda", () => {
    const total = analiticaDeTienda(AHORA, "month", null).net_sales;
    const cerca = (x: number) => expect(Math.abs(x - total)).toBeLessThan(0.05);
    cerca(analiticaDeProveedores(AHORA, "month").vendors.reduce((s, v) => s + v.net_sales, 0));
    cerca(analiticaDeCategorias(AHORA, "month", null).categories.reduce((s, c) => s + c.net_sales, 0));
  });

  it("filtra por tienda y baja de nivel por categoría", () => {
    const todas = analiticaDeTienda(AHORA, "month", null), una = analiticaDeTienda(AHORA, "month", "T1");
    expect(una.net_sales).toBeGreaterThan(0);
    expect(una.net_sales).toBeLessThan(todas.net_sales);
    expect(analiticaDeCategorias(AHORA, "month", "Tile").categories.map((c) => c.category)).toEqual(["Tile > Ceramic", "Tile > Porcelain"]);
  });
});

describe("el cliente del demo", () => {
  const sb = clienteDemoDelErp(AHORA);

  it("una búsqueda filtra de verdad y cuenta antes de paginar", async () => {
    const r = await sb.from("app_products").select("*", { count: "exact" }).or("name.ilike.%marble%,sku.ilike.%marble%").order("name").range(0, 0);
    expect(r.count).toBe(2);
    expect(r.data).toHaveLength(1);
    expect((r.data as { name: string }[])[0].name).toBe("Demo Calacatta Marble 12x24");
  });

  it("ordena descendente con datos que no vienen ordenados", async () => {
    const r = await sb.from("app_products").select("id,price").order("price", { ascending: false }).limit(2);
    expect((r.data as { price: number }[]).map((x) => x.price)).toEqual([28.95, 21.5]);
  });

  it("el id de la URL llega como texto y encuentra su fila", async () => {
    const r = await sb.from("app_products").select("*").eq("id", "1").maybeSingle();
    expect((r.data as { sku: string }).sku).toBe("DM-1001");
  });

  it("~MERGE se encuentra por ilike y contains mira la etiqueta", async () => {
    expect((await sb.from("app_products").select("*").ilike("sku", "%~MERGE%")).data).toHaveLength(1);
    expect((await sb.from("app_products").select("*").contains("review_tags", ["missing_image"])).data).toHaveLength(2);
  });

  it("escribir en una tabla, en una función o en un archivo contesta el aviso", async () => {
    const aviso = { data: null, error: { message: "Not available in the demo." }, count: null };
    expect(await sb.from("saved_views").insert().select()).toEqual(aviso);
    expect(await sb.from("app_products").update().eq("id", 1)).toEqual(aviso);
    expect(await sb.rpc("update_product", { p_id: 1 })).toEqual(aviso);
    expect(await sb.storage.from("po-docs").upload()).toEqual(aviso);
  });

  it("cada función de lectura de las pantallas existe; ninguna de escritura", () => {
    const f = rpcsDemoErp(AHORA);
    for (const n of ["dashboard_stats", "catalog_facets", "review_tag_facets", "product_vocabulary", "category_browse", "purchasing_groups", "reorder_report", "list_purchase_orders", "reconcile_po", "po_receiving_detail", "list_cycle_counts", "negative_balances", "analytics_store_stats", "analytics_vendor_stats", "analytics_category_stats"]) expect(f[n], n).toBeTypeOf("function");
    for (const n of ["update_product", "receive_po", "decide_request", "merge_products", "adjust_inventory"]) expect(f[n], n).toBeUndefined();
  });

  it("la sesión es la del admin demo, con rol del ERP", async () => {
    const { data } = await sb.schema().from("profiles").select("*").eq("id", (await sb.auth.getUser()).data.user.id).single();
    expect(data).toMatchObject({ role: "admin", erp_role: "admin" });
  });

  it("no lleva datos reales: todos los correos y enlaces son de ejemplo", () => {
    const texto = JSON.stringify(tablasDemoErp(AHORA));
    for (const m of texto.match(/https?:\/\/[^"]+/g) ?? []) expect(m).toMatch(/^https:\/\/example\.com\//);
    for (const m of texto.match(/[\w.]+@[\w.]+/g) ?? []) expect(m).toMatch(/@demo\.example$/);
  });
});
