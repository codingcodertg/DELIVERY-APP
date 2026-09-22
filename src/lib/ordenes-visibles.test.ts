import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { coincideConLaBusqueda, leTocaPorRol, ordenesVisibles, pasaLaVentana, type ContextoDeLista } from "./ordenes-visibles";
import { documentoPendiente } from "./documento-pendiente";
import { mkDelivery } from "./__fixtures";
import { shiftDateISO, todayISO } from "./utils";
import type { OrderTypeRules } from "./required";
import type { Delivery, NamedLocation } from "./types";

/**
 * Las dos listas de Órdenes (D-313).
 *
 * El dueño: *«invoice pending must be visible for office too»*. No era permiso: la pestaña cuenta
 * sobre lo que la persona ve, y lo que office ve lo corta la ventana de D-239. Las pendientes están
 * todas entregadas —o sea, viejas—, así que la cuenta era 0 y la pestaña ni se pintaba.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

const HOY = todayISO();
const ANTIER = shiftDateISO(HOY, -20);
const AYER = shiftDateISO(HOY, -1);
const HACE_CINCUENTA = shiftDateISO(HOY, -50);

// Tipos inventados: qué documento pide cada tipo es dato del dueño (Ajustes) y no se afirma aquí.
const REGLAS: OrderTypeRules = {
  ConFactura: { docRef: "invoice" },
  SinDocumento: { docRef: "none" },
  Entre: { docRef: "po", storeToStore: true },
};
const TIENDAS: NamedLocation[] = [{ name: "Norte" }, { name: "Sur" }] as NamedLocation[];

const ctx = (over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
  me: { id: "u-office", role: "accounting", store: null },
  teaching: false,
  veTodoElHistorial: false,
  busqueda: "",
  sueloDeVentas: shiftDateISO(HOY, -30),
  reglas: REGLAS,
  tiendas: TIENDAS,
  ...over,
});

/** Entregada hace 20 días, de tipo «pide factura», sin factura: trabajo vivo con la orden ya vieja. */
const pendienteVieja = (over: Partial<Delivery> = {}) => mkDelivery({
  id: "vieja", stage: "delivered", order_type: "ConFactura", invoice_num: null,
  delivery_date: ANTIER, store: "Norte", created_by: "u-otro", ...over,
});

const ids = (l: Delivery[]) => l.map((d) => d.id).sort();

describe("lo que el dueño pidió: office ve sus facturas pendientes", () => {
  it("una entregada de hace 20 días sin factura sale en la pestaña y NO en «Todas»", () => {
    const d = pendienteVieja();
    // Control: sin la exención se caería por la ventana, que es lo que pasaba.
    expect(documentoPendiente(d, REGLAS)).not.toBeNull();
    const { visibles, conPendientes } = ordenesVisibles([d], ctx());
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual(["vieja"]);
  });

  it("con la factura puesta no sale en ninguna de las dos: ya no es trabajo vivo", () => {
    const d = pendienteVieja({ invoice_num: "F-1" });
    expect(documentoPendiente(d, REGLAS)).toBeNull();
    const { visibles, conPendientes } = ordenesVisibles([d], ctx());
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual([]);
  });

  it("la vista normal NO se relaja: una entregada vieja CON su factura sigue fuera", () => {
    // Si la exención valiera para toda la tabla, a office se le llenaría la lista de entregadas de
    // hace un mes, que es justo lo que D-239 vino a quitar.
    const conDoc = pendienteVieja({ id: "condoc", invoice_num: "F-2" });
    const sinDoc = pendienteVieja({ id: "sindoc", order_type: "SinDocumento" });
    const { visibles } = ordenesVisibles([conDoc, sinDoc], ctx());
    expect(ids(visibles)).toEqual([]);
  });

  it("lo de dentro de la ventana sigue en las dos listas", () => {
    const reciente = pendienteVieja({ id: "reciente", delivery_date: AYER });
    const { visibles, conPendientes } = ordenesVisibles([reciente], ctx());
    expect(ids(visibles)).toEqual(["reciente"]);
    expect(ids(conPendientes)).toEqual(["reciente"]);
  });

  it("`conPendientes` contiene a `visibles`: la pestaña nunca enseña menos que la lista", () => {
    const lista = [
      pendienteVieja({ id: "a" }),
      pendienteVieja({ id: "b", delivery_date: AYER }),
      pendienteVieja({ id: "c", invoice_num: "F-3" }),
      pendienteVieja({ id: "d", delivery_date: AYER, invoice_num: "F-4" }),
    ];
    const { visibles, conPendientes } = ordenesVisibles(lista, ctx());
    for (const v of visibles) expect([v.id, conPendientes.includes(v)]).toEqual([v.id, true]);
  });
});

describe("una factura pendiente no es una llave para ver órdenes de otro", () => {
  const vendedor = { id: "u-vend", role: "sales" as const, store: "Norte" };

  it("la orden de otro vendedor no sale, ni en la pestaña", () => {
    const deOtro = pendienteVieja({ id: "de-otro", created_by: "u-otro", assigned_sales_rep: "u-otro", store: "Sur" });
    // Control: le falta el documento, así que lo único que la deja fuera es el corte por rol.
    expect(documentoPendiente(deOtro, REGLAS)).not.toBeNull();
    const { visibles, conPendientes } = ordenesVisibles([deOtro], ctx({ me: vendedor }));
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual([]);
  });

  it("la suya, vieja y sin factura, sí sale en la pestaña", () => {
    const suya = pendienteVieja({ id: "suya", created_by: "u-vend", assigned_sales_rep: "u-vend" });
    const { visibles, conPendientes } = ordenesVisibles([suya], ctx({ me: vendedor }));
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual(["suya"]);
  });

  it("una anulada suya sigue sin salir, y es el corte por rol quien la quita", () => {
    // Dentro de la ventana A PROPÓSITO: con una anulada vieja la prueba pasaría igual sin el corte
    // —la ventana ya la tiraba— y no mediría nada. Medido: con el corte quitado, esta cae.
    const anulada = pendienteVieja({ id: "anulada", stage: "canceled", delivery_date: AYER, created_by: "u-vend" });
    expect(pasaLaVentana(anulada, ctx({ me: vendedor }), false)).toBe(true);
    const { visibles, conPendientes } = ordenesVisibles([anulada], ctx({ me: vendedor }));
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual([]);
  });

  it("almacén sigue sin ver lo anterior a la aprobación aunque le falte el documento", () => {
    const almacen = { id: "u-alm", role: "warehouse" as const, store: "Norte" };
    const pendiente = pendienteVieja({ id: "pend", stage: "pending", delivery_date: AYER });
    const aprobada = pendienteVieja({ id: "apr", stage: "approved", delivery_date: AYER });
    const { visibles, conPendientes } = ordenesVisibles([pendiente, aprobada], ctx({ me: almacen }));
    expect(ids(visibles)).toEqual(["apr"]);
    expect(ids(conPendientes)).toEqual(["apr"]);
  });
});

describe("el suelo de 30 días de ventas", () => {
  const vendedor = { id: "u-vend", role: "sales" as const, store: "Norte" };
  const suya = (over: Partial<Delivery> = {}) => pendienteVieja({ created_by: "u-vend", assigned_sales_rep: "u-vend", ...over });

  it("buscando, corta lo anterior a 30 días", () => {
    const antigua = suya({ id: "antigua", delivery_date: HACE_CINCUENTA, invoice_num: "F-9", account: "ACME" });
    const { visibles } = ordenesVisibles([antigua], ctx({ me: vendedor, busqueda: "acme" }));
    expect(ids(visibles)).toEqual([]);
  });

  it("pero no tapa la pestaña: su pendiente de hace 50 días se busca igual ahí dentro", () => {
    // El suelo es del historial; una factura pendiente es trabajo vivo, y el trabajo vivo no
    // caduca a los 30 días.
    const antigua = suya({ id: "antigua", delivery_date: HACE_CINCUENTA, account: "ACME" });
    const { visibles, conPendientes } = ordenesVisibles([antigua], ctx({ me: vendedor, busqueda: "acme" }));
    expect(ids(visibles)).toEqual([]);
    expect(ids(conPendientes)).toEqual(["antigua"]);
  });

  it("a office el suelo no le aplica: busca su historial entero", () => {
    const antigua = pendienteVieja({ id: "antigua", delivery_date: HACE_CINCUENTA, invoice_num: "F-9", account: "ACME" });
    const { visibles } = ordenesVisibles([antigua], ctx({ busqueda: "acme" }));
    expect(ids(visibles)).toEqual(["antigua"]);
  });
});

describe("las piezas por separado", () => {
  it("`pasaLaVentana` sin la exención es la retención de siempre", () => {
    const vieja = pendienteVieja();
    expect(pasaLaVentana(vieja, ctx(), false)).toBe(false);
    expect(pasaLaVentana(vieja, ctx(), true)).toBe(true);
    // Y la exención no inventa nada donde no hay documento pendiente.
    expect(pasaLaVentana(pendienteVieja({ invoice_num: "F-1" }), ctx(), true)).toBe(false);
  });

  it("quien ve el historial entero pasa las dos, y el sandbox de enseñanza también", () => {
    const vieja = pendienteVieja({ invoice_num: "F-1" });
    expect(pasaLaVentana(vieja, ctx({ veTodoElHistorial: true }), false)).toBe(true);
    expect(pasaLaVentana(vieja, ctx({ teaching: true }), false)).toBe(true);
    expect(leTocaPorRol(vieja, ctx({ me: { id: "x", role: "sales", store: "Sur" }, teaching: true }))).toBe(true);
  });

  it("`coincideConLaBusqueda` mira los campos de la orden, y sin búsqueda todo coincide", () => {
    const d = mkDelivery({ account: "Ferretería Sur", invoice_num: "F-77" });
    expect(coincideConLaBusqueda(d, "")).toBe(true);
    expect(coincideConLaBusqueda(d, "  ")).toBe(true);
    expect(coincideConLaBusqueda(d, "ferretería")).toBe(true);
    expect(coincideConLaBusqueda(d, "F-77")).toBe(true);
    expect(coincideConLaBusqueda(d, "norte")).toBe(false);
  });

  it("la búsqueda se aplica ANTES de la exención: la pestaña no ignora lo tecleado", () => {
    const vieja = pendienteVieja({ account: "ACME" });
    const { conPendientes } = ordenesVisibles([vieja], ctx({ busqueda: "otra cosa" }));
    expect(ids(conPendientes)).toEqual([]);
  });
});

describe("la pantalla le pide las dos listas a la función", () => {
  const pagina = leer("src/app/(app)/page.tsx");
  const llano = plano(pagina);

  it("no arma la lista a mano: la pide, con sus siete datos", () => {
    expect(llano).toContain("const { visibles: visible, conPendientes } = useMemo(");
    const i = llano.indexOf("ordenesVisibles(deliveries, {");
    expect(i).toBeGreaterThan(-1);
    const args = llano.slice(i, llano.indexOf("})", i));
    for (const dato of ["me,", "teaching,", "veTodoElHistorial,", "busqueda: q,", "sueloDeVentas: salesSearchFloor,",
      "reglas: settings.order_type_rules ?? {},", "tiendas: settings.stores,"]) {
      expect(args, dato).toContain(dato);
    }
  });

  it("la cuenta de la pestaña y sus filas salen de `conPendientes`, no de `visible`", () => {
    // Las dos tienen que salir de la MISMA lista: con la cuenta sobre una y las filas sobre otra, la
    // pestaña diría un número y enseñaría otro.
    expect(llano).toContain("c[PESTANA_DOCUMENTO_PENDIENTE] = conPendientes.filter((d) => facturaPendiente(d, settings.order_type_rules ?? {})).length;");
    expect(llano).toContain("const desde = activeFilter === PESTANA_DOCUMENTO_PENDIENTE ? conPendientes : visible;");
    expect(llano).toContain("return desde.filter((d) => {");
  });

  it("y las cuentas de etapa y «Todas» siguen saliendo de la lista normal", () => {
    // Si «Todas» contara sobre `conPendientes`, su número dejaría de cuadrar con lo que la tabla
    // enseña al pulsarla.
    // Desde D-357 pasan además por el chip de fechas, el mismo que filtra la lista; siguen sin mirar `conPendientes`.
    expect(llano).toContain("const enElPreset = visible.filter(pasaElPreset);");
    expect(llano).toContain("const c: Record<string, number> = { all: enElPreset.length };");
    expect(llano).not.toContain("{ all: conPendientes.length }");
  });
});
