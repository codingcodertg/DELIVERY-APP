import { describe, expect, it } from "vitest";
import { origenFijo, origenesPermitidos, reglasAlGuardar, type FilaDeTipo } from "./origen-libre";
import { esMia, ordenesVisibles, type ContextoDeLista } from "./ordenes-visibles";
import { mkDelivery } from "./__fixtures";
import { todayISO } from "./utils";
import type { NamedLocation } from "./types";

/**
 * Origen libre (D-537). El dueño, 2026-10-13: *«OCUPO CREAR UNA NUEVA ORDER TYPE QUE SE LLAMARA OTHER,
 * YA T EDIRE LAS REGLAS SOLO SE QUE INICIANDO SE PUEDE ELEGIR OTRA TIENDA DE ORIGIEN NO NECESARIAMENTE
 * LA DEL ORIGIN DEL SALES GUY»*. Tiendas y tipos inventados: los reales son datos de Ajustes.
 */

const TIENDAS = [{ name: "Norte", group: "g" }, { name: "Centro", group: "g" }, { name: "Sur" }, { name: "Este" }] as NamedLocation[];
const TODAS = ["Norte", "Centro", "Sur", "Este"];
const VENDEDOR_SUR = { role: "sales" as const, store: "Sur" };

describe("el selector de «Vendido desde»", () => {
  it("con origen libre, el vendedor elige cualquier tienda y el selector no queda fijo", () => {
    expect(origenesPermitidos(TODAS, VENDEDOR_SUR, { anyOrigin: true }, "Sur", TIENDAS)).toEqual(TODAS);
    expect(origenFijo(VENDEDOR_SUR, { anyOrigin: true }, TIENDAS)).toBe(false);
  });

  it("sin la bandera, nada cambia: Sur vende desde Sur y su selector queda fijo", () => {
    expect(origenesPermitidos(TODAS, VENDEDOR_SUR, {}, "Sur", TIENDAS)).toEqual(["Sur"]);
    expect(origenesPermitidos(TODAS, VENDEDOR_SUR, { anyOrigin: false }, "Sur", TIENDAS)).toEqual(["Sur"]);
    expect(origenFijo(VENDEDOR_SUR, {}, TIENDAS)).toBe(true);
  });

  it("la tienda que ya tiene la orden se conserva aunque no sea de las suyas (D-267)", () => {
    expect(origenesPermitidos(TODAS, VENDEDOR_SUR, {}, "Este", TIENDAS)).toEqual(["Sur", "Este"]);
  });
});

describe("Datos → Tipos de orden: guardar conserva lo que la tabla no enseña", () => {
  const previas = {
    Proveedorx: { docRef: "hidden" as const, hasCustomer: false, storeToStore: false },
    Otro: { docRef: "none" as const, anyOrigin: true },
  };
  const fila = (over: Partial<FilaDeTipo>): FilaDeTipo => ({
    orig: null, name: "", storeToStore: false, docRef: "invoice", homeIsDestination: false, anyOrigin: false, ...over,
  });

  it("guardar sin tocar nada deja hasCustomer: false donde estaba (antes se perdía)", () => {
    const { rules } = reglasAlGuardar([fila({ orig: "Proveedorx", name: "Proveedorx", docRef: "hidden" })], previas);
    expect(rules.Proveedorx.hasCustomer).toBe(false);
  });

  it("renombrar un tipo se lleva sus banderas al nombre nuevo", () => {
    const { names, rules } = reglasAlGuardar([fila({ orig: "Proveedorx", name: "Supplier", docRef: "hidden" })], previas);
    expect(names).toEqual(["Supplier"]);
    expect(rules.Supplier.hasCustomer).toBe(false);
  });

  it("lo que la tabla enseña gana a lo que había: quitar el origen libre lo quita", () => {
    const { rules } = reglasAlGuardar([fila({ orig: "Otro", name: "Otro", docRef: "none", anyOrigin: false })], previas);
    expect(rules.Otro.anyOrigin).toBe(false);
  });

  it("una fila nueva no hereda nada, y vacías y repetidas no se guardan", () => {
    const { names, rules } = reglasAlGuardar([fila({ name: "Nuevo" }), fila({ name: "  " }), fila({ name: "Nuevo", anyOrigin: true })], previas);
    expect(names).toEqual(["Nuevo"]);
    expect(rules.Nuevo).toEqual({ storeToStore: false, docRef: "invoice", homeIsDestination: false, anyOrigin: false });
  });
});

describe("la lista de Órdenes: quien crea la orden la sigue viendo", () => {
  const ctx = (over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
    me: { id: "u-sur", role: "sales", store: "Sur" },
    teaching: false, veTodoElHistorial: false, busqueda: "",
    reglas: { Otro: { docRef: "none", anyOrigin: true } },
    tiendas: TIENDAS, tiendasDeAlmacen: [], ...over,
  });
  // Un borrador lo ve ventas aunque no sea suyo (`ventasVeLaOrden`), así que el de otro desde Este
  // solo lo corta la tienda: es el caso que distingue «la tienda corta» de «el rol corta».
  const desdeEste = (id: string, over: Record<string, unknown>) => mkDelivery({
    id, order_type: "Otro", store: "Este", pickup_name: "Este", delivery_name: "Cliente",
    delivery_date: todayISO(), stage: "draft", assigned_sales_rep: null, ...over,
  });

  it("el vendedor de Sur ve la orden que creó desde Este, y no el borrador de otro desde Este", () => {
    const { visibles } = ordenesVisibles([
      desdeEste("mia", { created_by: "u-sur" }),
      desdeEste("de-otro", { created_by: "u-otro" }),
    ], ctx());
    expect(visibles.map((d) => d.id)).toEqual(["mia"]);
  });

  it("también la que office creó a su nombre desde Este", () => {
    const { visibles } = ordenesVisibles([desdeEste("a-mi-nombre", { created_by: "u-office", assigned_sales_rep: "u-sur", stage: "pending" })], ctx());
    expect(visibles.map((d) => d.id)).toEqual(["a-mi-nombre"]);
  });

  it("en un tipo SIN origen libre, la suya de otra tienda sigue sin salir (D-405)", () => {
    const c = ctx({ reglas: { Otro: { docRef: "none", anyOrigin: true }, Normal: { docRef: "invoice" } } });
    const { visibles } = ordenesVisibles([
      desdeEste("otro-mia", { created_by: "u-sur" }),
      desdeEste("normal-mia", { created_by: "u-sur", order_type: "Normal" }),
    ], c);
    expect(visibles.map((d) => d.id)).toEqual(["otro-mia"]);
  });

  it("sin saber quién mira, no abre nada; y una orden sin autor no es de nadie", () => {
    expect(esMia({ created_by: null, assigned_sales_rep: null }, { id: "u-sur" })).toBe(false);
    expect(esMia({ created_by: "u-sur", assigned_sales_rep: null }, null)).toBe(false);
    expect(esMia({ created_by: "u-sur", assigned_sales_rep: null }, { id: "" })).toBe(false);
  });
});
