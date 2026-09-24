import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankDelivery } from "./blank-delivery";
import { CLAVE_ID, etiquetaDelGestor, valorDelGestor, type DeOrdenes } from "./valores-del-gestor";
import { COLUMNAS_DEL_GESTOR } from "./routes-columns";
import { ordenaFilas, filtraFilas } from "./orden-y-filtro";
import { fmtDate, fmtMoney } from "./utils";
import type { Delivery } from "./types";

/** Ordenar, filtrar y abrir la orden en las tablas del Gestor de Rutas (D-360). */

const mk = (over: Partial<Delivery>) => blankDelivery(over);

/**
 * Un catálogo de Órdenes de prueba con la FORMA del real: cada columna lee su campo, y la etapa depende del contexto (el
 * idioma), como en Órdenes. El real vive en un componente con JSX que vitest no carga; que la página pase ESE catálogo lo
 * fija la prueba de estructura de `routes-columns.test.ts`.
 */
type Ctx = { lang: "en" | "es" };
const ordenes: DeOrdenes<Ctx> = {
  ctx: { lang: "es" },
  catalogo: [
    { key: "stage", value: (d, c) => `${c.lang}:${d.stage}` },
    { key: "type", value: (d) => d.order_type },
    { key: "so", value: (d) => d.so_num },
    { key: "po", value: (d) => d.po2 },
    { key: "fee", value: (d) => d.delivery_fee, filterLabel: (v) => (v == null ? "—" : fmtMoney(Number(v))) },
    { key: "contact", value: (d) => d.contact },
    // Columnas de Órdenes que el Gestor pinta a su manera: su valor NO debe usarse aunque el catálogo lo tenga.
    { key: "invoice", value: () => "de-ordenes" },
    { key: "account", value: () => "de-ordenes" },
  ],
};

describe("valorDelGestor", () => {
  it("cada columna de «Sin asignar» saca un valor de la orden, y el ID también", () => {
    const d = mk({
      order_no: 501, invoice_num: "88123", account: "Cuenta A", delivery_address: "Calle 1", pickup_name: "Bodega N", pickup_address: "Calle 2",
      store: "T1", actual_pallets: 3, est_pallets: 5, delivery_date: "2026-09-22", delivery_windows: "9-12", stage: "approved",
      order_type: "Customer", so_num: "SO-1", po2: "PO-1", delivery_fee: 45, contact: "Persona",
    });
    const claves = COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("sinAsignar")).map((c) => c.key);
    for (const k of claves) expect(valorDelGestor(k, d, ordenes), k).not.toBeNull();
    expect(valorDelGestor(CLAVE_ID, d)).toBe("501");
    expect(valorDelGestor("pickup", d)).toBe("Bodega N");
    expect(valorDelGestor("pallets", d)).toBe(3);
  });
  it("sin recogida con nombre cae a la dirección; sin real, al estimado; una clave desconocida da nulo", () => {
    const d = mk({ pickup_name: null, pickup_address: "Calle 2", actual_pallets: null, est_pallets: 5 });
    expect(valorDelGestor("pickup", d)).toBe("Calle 2");
    expect(valorDelGestor("pallets", d)).toBe(5);
    expect(valorDelGestor("no_existe", d, ordenes)).toBeNull();
  });
  it("D-376: las que vienen de Órdenes toman el valor de SU columna de Órdenes, con el contexto que pasa la página", () => {
    const d = mk({ stage: "approved", order_type: "Intertienda", so_num: "SO-9", po2: "PO-9", delivery_fee: 0, contact: "Otra" });
    expect(valorDelGestor("status", d, ordenes)).toBe("es:approved");
    expect(valorDelGestor("status", d, { ...ordenes, ctx: { lang: "en" } })).toBe("en:approved");
    expect(valorDelGestor("type", d, ordenes)).toBe("Intertienda");
    expect(valorDelGestor("so", d, ordenes)).toBe("SO-9");
    expect(valorDelGestor("po", d, ordenes)).toBe("PO-9");
    // El $0 es un valor, no un «sin valor»: ordena y filtra como cero.
    expect(valorDelGestor("fee", d, ordenes)).toBe(0);
    expect(valorDelGestor("contact", d, ordenes)).toBe("Otra");
    // Las que el Gestor pinta a su manera siguen con su valor, aunque Órdenes tenga una columna con esa clave.
    expect(valorDelGestor("invoice", mk({ invoice_num: "77" }), ordenes)).toBe("77");
    expect(valorDelGestor("account", mk({ account: "Cuenta B" }), ordenes)).toBe("Cuenta B");
  });
  it("la fecha se lista formateada pero filtra por el ISO; el costo se lista como dinero, como en Órdenes", () => {
    expect(etiquetaDelGestor("date")!("2026-09-22")).toBe(fmtDate("2026-09-22"));
    expect(etiquetaDelGestor("date")!("2026-09-22")).not.toBe("2026-09-22");
    expect(valorDelGestor("date", mk({ delivery_date: "2026-09-22" }))).toBe("2026-09-22");
    expect(etiquetaDelGestor("account", ordenes)).toBeUndefined();
    expect(etiquetaDelGestor("fee", ordenes)!(45)).toBe(fmtMoney(45));
    expect(etiquetaDelGestor("fee", ordenes)!(null)).toBe("—");
  });
  it("con la librería: ordenar por costo deja las sin costo al final, y filtrar por tipo cruza con el valor real", () => {
    const filas = [mk({ id: "a", delivery_fee: 40, order_type: "Customer" }), mk({ id: "b", delivery_fee: null, order_type: "Transfer" }), mk({ id: "c", delivery_fee: 90, order_type: "Transfer" })];
    const valorDe = (k: string, d: Delivery) => valorDelGestor(k, d, ordenes);
    expect(ordenaFilas(filas, (d) => valorDe("fee", d), "desc").map((d) => d.id)).toEqual(["c", "a", "b"]);
    expect(ordenaFilas(filas, (d) => valorDe("fee", d), "asc").map((d) => d.id)).toEqual(["a", "c", "b"]);
    expect(filtraFilas(filas, { type: new Set(["Transfer"]) }, valorDe).map((d) => d.id)).toEqual(["b", "c"]);
  });
});

describe("el Gestor de Rutas usa el menú en «Sin asignar» y abre la orden desde el ID y la factura (D-360)", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n");
  const entre = (desde: string, hasta: string) => {
    const i = pagina.indexOf(desde);
    expect(i, desde).toBeGreaterThan(-1);
    const j = pagina.indexOf(hasta, i);
    expect(j, hasta).toBeGreaterThan(i);
    return pagina.slice(i, j);
  };
  const sinAsignar = () => entre("{/* ---------- Unassigned pool ---------- */}", "{/* ---------- Per-driver routes ---------- */}");

  it("un estado sobre las filas que la tabla ya tenía", () => {
    expect(pagina).toContain("const ordenSinAsignar = useOrdenYFiltro(unassignedShown, valorDelGestorAqui);");
  });
  it("la tabla pinta SUS filas visibles, sus cabeceras con menú, su menú abierto y su barra de filtros", () => {
    const tramo = sinAsignar();
    expect(tramo).toContain("{ordenSinAsignar.visibles.map((d) => {");
    expect(tramo).toContain("<CabeceraConMenu estado={ordenSinAsignar} col={COL_ID}");
    expect(tramo).toContain("<CabeceraConMenu estado={ordenSinAsignar} col={c}");
    expect(tramo).toContain("<MenuDeColumnaAbierto estado={ordenSinAsignar}");
    expect(tramo).toContain("<FiltrosPuestos estado={ordenSinAsignar}");
    expect(tramo).not.toContain("{unassignedShown.map((d) => {");
  });
  it("el ID y la factura abren la orden con el mismo gesto que la tabla de paradas, parando el clic", () => {
    const gesto = entre("const abreLaOrden = (d: Delivery) => ({", "});");
    expect(gesto).toContain("onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpenOrder(d); }");
    expect(gesto).toContain('textDecorationStyle: "dotted"');
    expect(gesto).toContain('title: t("Open this order", "Abrir esta orden")');
    const tramo = sinAsignar();
    expect(tramo).toContain('<td className="ordno" {...abreLaOrden(d)}>#{orderLabel(d)}</td>');
    expect(tramo).toContain('c.key === "invoice" ? (d.invoice_num ? <span {...abreLaOrden(d)}>{d.invoice_num}</span> : "—")');
  });
  it("en «Sin asignar», seleccionar todo es lo que se ve con los filtros puestos", () => {
    const casilla = entre('aria-label={t("Select all", "Seleccionar todo")}', "/>");
    expect(casilla).toContain("ordenSinAsignar.visibles.every((d) => selectedOrders.has(d.id))");
    expect(casilla).not.toContain("unassignedShown.every");
  });
});
