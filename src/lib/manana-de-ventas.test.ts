import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { esMananaDeTodos, ordenesVisibles, type ContextoDeLista } from "./ordenes-visibles";
import { COLUMNAS_DE_MANANA_PARA_VENTAS, mananaDeTodosParaVentas } from "./manana-de-ventas";
import { puedeAbrirLaOrden } from "./abrir-la-orden";
import { COLUMNAS_DEL_GESTOR } from "./routes-columns";
import { ORDER_COLUMNS } from "@/components/OrdersTable";
import { mkDelivery } from "./__fixtures";
import { shiftDateISO, todayISO } from "./utils";
import type { OrderTypeRules } from "./required";
import type { Delivery, NamedLocation } from "./types";

/**
 * D-588 · Ventas con el chip «Mañana». El dueño, 2026-10-18: «when they clicked todas and hoy but when they clicked mananna
 * sales people will eb able to see all order from everyone for tomorrow but the columsn they will see the same columns as
 * the ones showed in rutas de hoy and if the the order is not from them when trying to open it to see the full details it
 * wont open if its not theres».
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const HOY = todayISO();
const MANANA = shiftDateISO(HOY, 1);
const PASADO = shiftDateISO(HOY, 2);
// Tipos inventados: qué documento pide cada tipo es dato del dueño (Ajustes) y no se afirma aquí.
const REGLAS: OrderTypeRules = { Cliente: { docRef: "invoice" } };
const TIENDAS: NamedLocation[] = [{ name: "Norte" }, { name: "Sur" }] as NamedLocation[];
const YO = { id: "u-vende", role: "sales" as const, store: "Norte" };

const ctx = (over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
  me: YO, teaching: false, veTodoElHistorial: false, busqueda: "", reglas: REGLAS, tiendas: TIENDAS, tiendasDeAlmacen: [], ...over,
});
const orden = (id: string, over: Partial<Delivery> = {}) =>
  mkDelivery({ id, stage: "approved", order_type: "Cliente", store: "Sur", created_by: "u-otro", assigned_sales_rep: "u-otro", delivery_date: MANANA, ...over });
const ids = (l: Delivery[]) => l.map((d) => d.id).sort();

const miaHoy = orden("mia-hoy", { store: "Norte", created_by: YO.id, assigned_sales_rep: YO.id, delivery_date: HOY });
const miaManana = orden("mia-manana", { store: "Norte", created_by: YO.id, assigned_sales_rep: YO.id });
const ajenaMiTiendaHoy = orden("ajena-mi-tienda-hoy", { store: "Norte", delivery_date: HOY });
const ajenaOtraTiendaManana = orden("ajena-otra-tienda-manana");
const ajenaOtraTiendaHoy = orden("ajena-otra-tienda-hoy", { delivery_date: HOY });
const ajenaOtraTiendaPasado = orden("ajena-otra-tienda-pasado", { delivery_date: PASADO });
const ajenaSinFecha = orden("ajena-sin-fecha", { delivery_date: null });
const ajenaAnuladaManana = orden("ajena-anulada-manana", { stage: "canceled" });
const TODAS = [miaHoy, miaManana, ajenaMiTiendaHoy, ajenaOtraTiendaManana, ajenaOtraTiendaHoy, ajenaOtraTiendaPasado, ajenaSinFecha, ajenaAnuladaManana];

describe("ventas: con «Mañana» ve las de TODOS para mañana; con «Todas» y «Hoy», solo las suyas de su tienda (D-405)", () => {
  it("«Mañana»: entran las ajenas de otra tienda con fecha de mañana — y nada más que eso de lo ajeno", () => {
    const { visibles } = ordenesVisibles(TODAS, ctx({ chip: "tomorrow" }));
    expect(ids(visibles)).toEqual(["ajena-otra-tienda-manana", "mia-hoy", "mia-manana"]);
  });
  it("«Hoy»: su tienda y las suyas, como siempre; ninguna ajena", () => {
    const { visibles } = ordenesVisibles(TODAS, ctx({ chip: "today" }));
    expect(ids(visibles)).toEqual(["mia-hoy", "mia-manana"]);
  });
  it("«Todas» y sin chip: lo mismo que «Hoy» — el chip solo amplía con «tomorrow»", () => {
    expect(ids(ordenesVisibles(TODAS, ctx({ chip: "all" })).visibles)).toEqual(["mia-hoy", "mia-manana"]);
    expect(ids(ordenesVisibles(TODAS, ctx()).visibles)).toEqual(["mia-hoy", "mia-manana"]);
  });
  it("lo ampliado va SOLO a la lista normal: ni «Outdated» ni «Factura pendiente» crecen", () => {
    const r = ordenesVisibles(TODAS, ctx({ chip: "tomorrow" }));
    expect(ids(r.atrasadas)).toEqual([]);
    expect(ids(r.conPendientes)).not.toContain("ajena-otra-tienda-manana");
  });
  it("la búsqueda sigue mandando también sobre lo ampliado", () => {
    const { visibles } = ordenesVisibles(TODAS, ctx({ chip: "tomorrow", busqueda: "nada-que-coincida" }));
    expect(visibles).toEqual([]);
  });
  it("no es de ventas: el chip «Mañana» no amplía nada (office con su alcance de siempre)", () => {
    const office = ctx({ me: { id: "u-office", role: "accounting", store: "Norte" }, chip: "tomorrow" });
    expect(esMananaDeTodos(ajenaOtraTiendaManana, office)).toBe(false);
    expect(esMananaDeTodos(ajenaOtraTiendaManana, ctx({ me: null, chip: "tomorrow" }))).toBe(false);
  });
  it("`esMananaDeTodos`, pieza a pieza: ventas + «tomorrow» + fecha de mañana + no anulada; el día se inyecta", () => {
    const c = ctx({ chip: "tomorrow" });
    expect(esMananaDeTodos({ delivery_date: "2026-10-19", stage: "approved" }, c, "2026-10-18")).toBe(true);
    expect(esMananaDeTodos({ delivery_date: "2026-10-18", stage: "approved" }, c, "2026-10-18")).toBe(false);
    expect(esMananaDeTodos({ delivery_date: "2026-10-20", stage: "approved" }, c, "2026-10-18")).toBe(false);
    expect(esMananaDeTodos({ delivery_date: null, stage: "approved" }, c, "2026-10-18")).toBe(false);
    expect(esMananaDeTodos({ delivery_date: "2026-10-19", stage: "canceled" }, c, "2026-10-18")).toBe(false);
    expect(esMananaDeTodos({ delivery_date: "2026-10-19", stage: "approved" }, ctx({ chip: "today" }), "2026-10-18")).toBe(false);
  });
});

describe("abrir una ajena desde «Mañana»: no (D-544, la puerta de la ficha)", () => {
  it("el vendedor no abre la ajena de mañana; la suya sí; un borrador ajeno sí (D-286)", () => {
    expect(puedeAbrirLaOrden(YO, ajenaOtraTiendaManana)).toBe(false);
    expect(puedeAbrirLaOrden(YO, miaManana)).toBe(true);
    expect(puedeAbrirLaOrden(YO, { ...ajenaOtraTiendaManana, stage: "draft" })).toBe(true);
  });
  it("la pantalla no abre por su cuenta: monta la ficha con puerta (`OrderModalLazy`), que avisa y cierra", () => {
    const pagina = leer("src/app/(app)/page.tsx");
    expect(pagina).toContain('import { OrderModal } from "@/components/OrderModalLazy";');
    const puerta = leer("src/components/OrderModalLazy.tsx");
    expect(puerta).toContain("!puedeAbrirLaOrden(props.me, props.existing, { teaching })");
    expect(puerta).toContain("notify(t(AVISO_SOLO_TUS_ORDENES.en, AVISO_SOLO_TUS_ORDENES.es));");
  });
});

describe("las columnas son las de la tabla de paradas de «Ruta de hoy», derivadas del catálogo", () => {
  it("fijas de paradas (Factura #, Pallets) + las del catálogo «paradas» no ocultas, traducidas a Órdenes; la llegada queda fuera", () => {
    expect([...COLUMNAS_DE_MANANA_PARA_VENTAS]).toEqual(["invoice", "pallets", "type", "store", "address", "windows"]);
  });
  it("todas existen en la tabla de Órdenes, sin repetidas", () => {
    const claves = new Set(ORDER_COLUMNS.map((c) => c.key));
    for (const k of COLUMNAS_DE_MANANA_PARA_VENTAS) expect(claves.has(k), k).toBe(true);
    expect(new Set(COLUMNAS_DE_MANANA_PARA_VENTAS).size).toBe(COLUMNAS_DE_MANANA_PARA_VENTAS.length);
  });
  it("salen del catálogo: una columna de paradas que deje de salir por defecto, deja de salir aquí", () => {
    const porDefecto = COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("paradas") && !c.oculta).map((c) => c.key);
    expect(porDefecto).toEqual(["p_type", "p_ciudad_recogida", "p_address", "p_eta", "p_windows"]);
    // Una oculta del catálogo (Cuenta, SO, PO…) NO está aquí, aunque sea columna de Órdenes. («Tienda» sí, pero por
    // «Ciudad de recogida», que sale por defecto — no por la oculta `p_store`.)
    for (const c of COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("paradas") && c.oculta && c.deOrdenes && c.key !== "p_store")) {
      expect(COLUMNAS_DE_MANANA_PARA_VENTAS, c.key).not.toContain(c.deOrdenes);
    }
    expect(COLUMNAS_DE_MANANA_PARA_VENTAS).not.toContain("account");
  });
  it("la pantalla las pone solo para ventas con «Mañana», y pasa el chip a la lista", () => {
    expect(mananaDeTodosParaVentas(YO, "tomorrow")).toBe(true);
    expect(mananaDeTodosParaVentas(YO, "today")).toBe(false);
    expect(mananaDeTodosParaVentas({ role: "accounting" }, "tomorrow")).toBe(false);
    expect(mananaDeTodosParaVentas(null, "tomorrow")).toBe(false);
    const pagina = leer("src/app/(app)/page.tsx");
    expect(pagina).toContain("const mananaDeTodos = mananaDeTodosParaVentas(me, preset);");
    expect(pagina).toContain("visible={mananaDeTodos ? [...COLUMNAS_DE_MANANA_PARA_VENTAS] : cols}");
    expect(pagina).toContain("      chip: preset,\n    }),\n    [deliveries, q, me, teaching, veTodoElHistorial, settings.order_type_rules, settings.stores, preset],");
  });
});
