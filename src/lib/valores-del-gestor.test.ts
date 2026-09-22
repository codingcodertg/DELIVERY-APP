import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankDelivery } from "./blank-delivery";
import { CLAVE_ID, etiquetaDelGestor, valorDelGestor, type ContextoDelGestor } from "./valores-del-gestor";
import { COLUMNAS_DEL_GESTOR } from "./routes-columns";
import { ordenaFilas, filtraFilas } from "./orden-y-filtro";
import { fmtDate } from "./utils";
import { stageLabel } from "./constants";
import type { Delivery } from "./types";

/** Ordenar, filtrar y abrir la orden en las tablas del Gestor de Rutas (D-NEXT). */

const ctx: ContextoDelGestor = {
  lang: "es",
  cargaDe: (d) => (d.assigned_driver === "Ruta temporal" ? null : 2),
  paradaDe: (d) => (d.route_seq == null ? null : 4),
};
const mk = (over: Partial<Delivery>) => blankDelivery(over);

describe("valorDelGestor", () => {
  it("cada columna del catálogo de las dos tablas saca un valor de la orden, y el ID también", () => {
    const d = mk({
      order_no: 501, invoice_num: "88123", account: "Cuenta A", delivery_address: "Calle 1", pickup_name: "Bodega N", pickup_address: "Calle 2",
      store: "T1", assigned_driver: "Chofer X", actual_pallets: 3, est_pallets: 5, delivery_date: "2026-09-22", delivery_windows: "9-12", stage: "approved", route_seq: 0,
    });
    const claves = COLUMNAS_DEL_GESTOR.filter((c) => !c.tablas.includes("paradas")).map((c) => c.key);
    for (const k of claves) expect(valorDelGestor(k, d, ctx), k).not.toBeNull();
    expect(valorDelGestor(CLAVE_ID, d, ctx)).toBe("501");
    expect(valorDelGestor("pickup", d, ctx)).toBe("Bodega N");
    expect(valorDelGestor("pallets", d, ctx)).toBe(3);
    expect(valorDelGestor("load", d, ctx)).toBe(2);
    expect(valorDelGestor("stop", d, ctx)).toBe(4);
    expect(valorDelGestor("status", d, ctx)).toBe(stageLabel("approved", "es"));
    expect(stageLabel("approved", "es")).not.toBe(stageLabel("approved", "en"));
  });
  it("sin recogida con nombre cae a la dirección; sin real, al estimado; la ruta temporal y la orden sin secuencia dan nulo", () => {
    const d = mk({ pickup_name: null, pickup_address: "Calle 2", actual_pallets: null, est_pallets: 5, assigned_driver: "Ruta temporal", route_seq: null });
    expect(valorDelGestor("pickup", d, ctx)).toBe("Calle 2");
    expect(valorDelGestor("pallets", d, ctx)).toBe(5);
    expect(valorDelGestor("load", d, ctx)).toBeNull();
    expect(valorDelGestor("stop", d, ctx)).toBeNull();
    expect(valorDelGestor("no_existe", d, ctx)).toBeNull();
  });
  it("la etapa va en el idioma de quien mira, y la fecha se lista formateada pero filtra por el ISO", () => {
    expect(valorDelGestor("status", mk({ stage: "approved" }), { ...ctx, lang: "en" })).toBe(stageLabel("approved", "en"));
    expect(etiquetaDelGestor("date")!("2026-09-22")).toBe(fmtDate("2026-09-22"));
    expect(etiquetaDelGestor("date")!("2026-09-22")).not.toBe("2026-09-22");
    expect(valorDelGestor("date", mk({ delivery_date: "2026-09-22" }), ctx)).toBe("2026-09-22");
    expect(etiquetaDelGestor("account")).toBeUndefined();
  });
  it("con la librería: ordenar por pallets deja las sin pallets al final, y filtrar por tienda cruza con el valor real", () => {
    const filas = [mk({ id: "a", est_pallets: 4, store: "T2" }), mk({ id: "b", est_pallets: null, store: "T1" }), mk({ id: "c", est_pallets: 1, store: "T1" })];
    const valorDe = (k: string, d: Delivery) => valorDelGestor(k, d, ctx);
    expect(ordenaFilas(filas, (d) => valorDe("pallets", d), "desc").map((d) => d.id)).toEqual(["a", "c", "b"]);
    expect(filtraFilas(filas, { store: new Set(["T1"]) }, valorDe).map((d) => d.id)).toEqual(["b", "c"]);
  });
});

describe("el Gestor de Rutas usa el menú en las dos tablas y abre la orden desde el ID y la factura (D-NEXT)", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n");
  const entre = (desde: string, hasta: string) => {
    const i = pagina.indexOf(desde);
    expect(i, desde).toBeGreaterThan(-1);
    const j = pagina.indexOf(hasta, i);
    expect(j, hasta).toBeGreaterThan(i);
    return pagina.slice(i, j);
  };
  const programadas = () => entre("{/* ---------- Scheduled (assigned) orders list ---------- */}", "{/* ---------- Day timeline (Gantt) ---------- */}");
  const sinAsignar = () => entre("{/* ---------- Unassigned pool ---------- */}", "{/* ---------- Per-driver routes ---------- */}");

  it("dos estados, uno por tabla, sobre las filas que cada tabla ya tenía", () => {
    expect(pagina).toContain("const ordenProgramadas = useOrdenYFiltro(scheduled, valorDelGestorAqui);");
    expect(pagina).toContain("const ordenSinAsignar = useOrdenYFiltro(unassignedShown, valorDelGestorAqui);");
  });
  it("cada tabla pinta SUS filas visibles, sus cabeceras con menú, su menú abierto y su barra de filtros", () => {
    for (const [tramo, estado] of [[programadas(), "ordenProgramadas"], [sinAsignar(), "ordenSinAsignar"]] as const) {
      expect(tramo).toContain(`{${estado}.visibles.map((d) => {`);
      expect(tramo).toContain(`<CabeceraConMenu estado={${estado}} col={COL_ID}`);
      expect(tramo).toContain(`<CabeceraConMenu estado={${estado}} col={c}`);
      expect(tramo).toContain(`<MenuDeColumnaAbierto estado={${estado}}`);
      expect(tramo).toContain(`<FiltrosPuestos estado={${estado}}`);
      expect(tramo).not.toContain("{scheduled.map((d) => {");
      expect(tramo).not.toContain("{unassignedShown.map((d) => {");
    }
  });
  it("el ID y la factura abren la orden con el mismo gesto que la tabla de paradas, parando el clic", () => {
    const gesto = entre("const abreLaOrden = (d: Delivery) => ({", "});");
    expect(gesto).toContain("onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpenOrder(d); }");
    expect(gesto).toContain('textDecorationStyle: "dotted"');
    expect(gesto).toContain('title: t("Open this order", "Abrir esta orden")');
    for (const tramo of [programadas(), sinAsignar()]) {
      expect(tramo).toContain('<td className="ordno" {...abreLaOrden(d)}>#{orderLabel(d)}</td>');
      expect(tramo).toContain('c.key === "invoice" ? (d.invoice_num ? <span {...abreLaOrden(d)}>{d.invoice_num}</span> : "—")');
    }
  });
  it("en «Sin asignar», seleccionar todo es lo que se ve con los filtros puestos", () => {
    const casilla = entre('aria-label={t("Select all", "Seleccionar todo")}', "/>");
    expect(casilla).toContain("ordenSinAsignar.visibles.every((d) => selectedOrders.has(d.id))");
    expect(casilla).not.toContain("unassignedShown.every");
  });
});
