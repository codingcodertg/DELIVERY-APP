import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { camposCapturablesEnFila, documentoPendiente, documentosPendientes, etiquetaDePendiente, facturaPendiente, PESTANA_DOCUMENTO_PENDIENTE } from "./documento-pendiente";
import { cuentasDeOrdenes, filasDeOrdenes } from "./filas-de-ordenes";
import { ordenesVisibles, pasaLaVentanaDePendientes, type ContextoDeLista } from "./ordenes-visibles";
import { missingFields, type OrderTypeRules } from "./required";
import { mkDelivery } from "./__fixtures";
import { shiftDateISO, todayISO } from "./utils";
import type { Delivery, NamedLocation, Stage, UserRole } from "./types";

/**
 * D-NEXT · La factura pendiente es de TODA orden sin `invoice_num`, también de una Intertienda.
 *
 * El dueño, 2026-10-04: «invoice number not working there are orders without invoice and is not showing,
 * interiteda are pending». Medido ese día en producción (solo lectura): 13 Intertiendas abiertas sin factura
 * —todas con su PO— y la pastilla «Factura pendiente» decía 0.
 *
 * Los tipos son inventados, como en el resto de pruebas de esta regla: qué documento pide cada tipo es dato
 * del dueño. `EntreTiendas` hace de Intertienda (su documento es el PO).
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

const REGLAS: OrderTypeRules = {
  ACliente: { docRef: "invoice" }, EntreTiendas: { docRef: "po", storeToStore: true },
  ConEstimacion: { docRef: "estimate", storeToStore: true }, Cualquiera: { docRef: "any" }, SinDocumento: { docRef: "none" },
} as OrderTypeRules;
const TIENDAS = [{ name: "Norte" }, { name: "Sur" }] as NamedLocation[];
const HOY = todayISO();
const dia = (n: number) => shiftDateISO(HOY, n);

const entre = (over: Partial<Delivery> = {}) => mkDelivery({
  id: "e1", stage: "approved", order_type: "EntreTiendas", po2: "PO-1", invoice_num: null,
  store: "Norte", delivery_name: "Sur", delivery_date: HOY, created_by: "vendedor-1", assigned_sales_rep: null, ...over,
});

const ctx = (over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
  me: { id: "u-admin", role: "admin", store: null }, teaching: false, veTodoElHistorial: true, busqueda: "",
  reglas: REGLAS, tiendas: TIENDAS, tiendasDeAlmacen: [], ...over,
});

/** Lo que hace la pantalla: reparte las listas, cuenta la pastilla y lista sus filas. */
const pestana = (ordenes: Delivery[], c: ContextoDeLista = ctx()) => {
  const { visibles, conPendientes, atrasadas } = ordenesVisibles(ordenes, c);
  const listas = { visibles, conPendientes, atrasadas };
  const todo = () => true;
  return {
    // Fuera de la pestaña (el aviso) y dentro (la lista): los dos números y las filas.
    fuera: cuentasDeOrdenes(listas, "all", todo, REGLAS)[PESTANA_DOCUMENTO_PENDIENTE],
    dentro: cuentasDeOrdenes(listas, PESTANA_DOCUMENTO_PENDIENTE, todo, REGLAS)[PESTANA_DOCUMENTO_PENDIENTE],
    filas: filasDeOrdenes(listas, PESTANA_DOCUMENTO_PENDIENTE, todo, REGLAS).map((d) => d.id).sort(),
  };
};

describe("la pastilla «Factura pendiente» cuenta toda orden sin factura", () => {
  it("una Intertienda aprobada sin factura cuenta, aunque tenga su PO", () => {
    const d = entre();
    // Su documento sigue siendo el PO, y lo tiene: por ahí no le falta nada. Lo que le falta es la factura.
    expect(documentoPendiente(d, REGLAS)).toBeNull();
    expect(facturaPendiente(d, REGLAS)).toBe(true);
    expect(pestana([d])).toEqual({ fuera: 1, dentro: 1, filas: ["e1"] });
  });

  it("una Intertienda con factura no cuenta", () => {
    expect(facturaPendiente(entre({ invoice_num: "178137" }), REGLAS)).toBe(false);
    expect(pestana([entre({ invoice_num: "178137" })])).toEqual({ fuera: 0, dentro: 0, filas: [] });
    // Solo espacios no es una factura.
    expect(facturaPendiente(entre({ invoice_num: "   " }), REGLAS)).toBe(true);
  });

  it("en borrador, rechazada o anulada todavía no se espera la factura; en las demás etapas, sí", () => {
    const etapas: Stage[] = ["draft", "pending", "approved", "fulfilling", "ready", "picked_up", "delivered", "rejected", "canceled"];
    expect(etapas.filter((stage) => facturaPendiente(entre({ stage }), REGLAS)))
      .toEqual(["pending", "approved", "fulfilling", "ready", "picked_up", "delivered"]);
  });

  it("vale para todo tipo —estimación y «cualquiera» también— menos el configurado sin documento", () => {
    const sinFactura = (order_type: string) => facturaPendiente(entre({ order_type, po2: "PO-1", estimate_num: "E-1" }), REGLAS);
    expect(["ACliente", "EntreTiendas", "ConEstimacion", "Cualquiera"].map(sinFactura)).toEqual([true, true, true, true]);
    expect(sinFactura("SinDocumento")).toBe(false);
  });
});

describe("la ventana de la pestaña: la abierta entra con cualquier fecha, la entregada vieja no", () => {
  it("una Intertienda ABIERTA sin factura cuenta aunque su fecha sea de hace una semana", () => {
    for (const stage of ["pending", "approved", "fulfilling", "ready", "picked_up"] as Stage[]) {
      const d = entre({ stage, delivery_date: dia(-7) });
      expect(pasaLaVentanaDePendientes(d, ctx()), stage).toBe(true);
      expect(pestana([d]).filas, stage).toEqual(["e1"]);
    }
  });

  it("una Intertienda ENTREGADA vieja sin factura no cuenta; la entregada ayer, sí (D-407)", () => {
    expect(pestana([entre({ stage: "delivered", delivery_date: dia(-2) })])).toEqual({ fuera: 0, dentro: 0, filas: [] });
    expect(pestana([entre({ stage: "delivered", delivery_date: dia(-1) })]).filas).toEqual(["e1"]);
  });

  it("con la forma de los datos del 2026-10-04 la pastilla dice 13: las 13 abiertas, ninguna de las 49 entregadas viejas", () => {
    // 13 Intertiendas abiertas (9 aprobadas, 4 listas): 8 de antes de ayer, 4 de ayer y 1 de mañana.
    const abiertas = [-7, -7, -7, -7, -4, -4, -3, -3, -1, -1, -1, -1, 1].map((n, i) =>
      entre({ id: `abierta-${i}`, stage: i % 3 === 0 ? "ready" : "approved", delivery_date: dia(n) }));
    const entregadas = Array.from({ length: 44 }, (_, i) => entre({ id: `entregada-${i}`, stage: "delivered", delivery_date: dia(-10 - i) }));
    const clientes = Array.from({ length: 5 }, (_, i) => entre({ id: `cliente-${i}`, order_type: "ACliente", po2: null, stage: "delivered", delivery_date: dia(-30 - i) }));
    const borradores = [entre({ id: "borrador", order_type: "ACliente", po2: null, stage: "draft" })];
    const r = pestana([...abiertas, ...entregadas, ...clientes, ...borradores]);
    expect(r.fuera).toBe(13);
    expect(r.dentro).toBe(13);
    expect(r.filas).toEqual(abiertas.map((d) => d.id).sort());
  });

  it("los cortes por rol y por tienda no se relajan: la abierta vieja de otra tienda no le sale al gerente", () => {
    const gerente = ctx({ me: { id: "u-g", role: "manager", store: "Norte" }, veTodoElHistorial: false });
    const suya = entre({ id: "suya", delivery_date: dia(-7) });
    const ajena = entre({ id: "ajena", store: "Oeste", delivery_name: "Este", pickup_name: "Oeste", delivery_date: dia(-7) });
    expect(pestana([suya, ajena], gerente).filas).toEqual(["suya"]);
  });
});

describe("la fila: qué pastillas salen y quién escribe la factura de una Intertienda", () => {
  const yo = (role: UserRole, id = "vendedor-1") => ({ id, role });
  const campos = (d: Delivery) => documentosPendientes(d, REGLAS).map((p) => p.campo);

  it("con su PO y sin factura: una pastilla, «Factura pendiente»", () => {
    expect(campos(entre())).toEqual(["invoice_num"]);
    expect(documentosPendientes(entre(), REGLAS).map((p) => etiquetaDePendiente(p, "es"))).toEqual(["Factura pendiente"]);
    expect(documentosPendientes(entre(), REGLAS).map((p) => etiquetaDePendiente(p, "en"))).toEqual(["Invoice pending"]);
  });

  it("sin PO ni factura: las dos, el PO primero; con las dos cosas, ninguna; y la factura no sale dos veces", () => {
    expect(campos(entre({ po2: null }))).toEqual(["po2", "invoice_num"]);
    expect(campos(entre({ po2: null, invoice_num: "F-1" }))).toEqual(["po2"]);
    expect(campos(entre({ invoice_num: "F-1" }))).toEqual([]);
    expect(campos(entre({ order_type: "ACliente", po2: null }))).toEqual(["invoice_num"]);
    expect(campos(entre({ stage: "draft", po2: null }))).toEqual([]);
  });

  it("quién puede escribir la factura de una Intertienda desde la fila", () => {
    const d = entre({ stage: "ready" });
    // Quien ya edita la orden en esa etapa, en cualquier orden.
    for (const role of ["admin", "manager", "accounting"] as UserRole[]) {
      expect(camposCapturablesEnFila(yo(role, "otro"), d, REGLAS), role).toEqual(["invoice_num"]);
    }
    // Ventas: en SU orden (la 125 no mira el tipo); en la de otro, no.
    expect(camposCapturablesEnFila(yo("sales"), d, REGLAS)).toEqual(["invoice_num"]);
    expect(camposCapturablesEnFila(yo("sales", "vendedor-2"), d, REGLAS)).toEqual([]);
    // Chofer, almacén y logística ven la pastilla y nada más.
    for (const role of ["driver", "warehouse", "logistics"] as UserRole[]) {
      expect(camposCapturablesEnFila(yo(role), d, REGLAS), role).toEqual([]);
    }
  });

  it("ventas, en una Intertienda suya sin PO ni factura: escribe la factura y no el PO", () => {
    expect(camposCapturablesEnFila(yo("sales"), entre({ po2: null }), REGLAS)).toEqual(["invoice_num"]);
    expect(camposCapturablesEnFila(yo("manager", "otro"), entre({ po2: null }), REGLAS)).toEqual(["po2", "invoice_num"]);
  });
});

describe("la pantalla usa estas reglas, y crear una Intertienda sigue sin exigir factura", () => {
  it("la pastilla de la fila pinta una por documento pendiente y escribe el campo de la que se pulsó", () => {
    const pastilla = plano(leer("src/components/DocumentoPendiente.tsx"));
    expect(pastilla).toContain("const pendientes = documentosPendientes(d, reglas);");
    expect(pastilla).toContain("const capturables = camposCapturablesEnFila(me, d, reglas);");
    expect(pastilla).toContain("pendientes.map((doc) => <UnDocumentoPendiente key={doc.campo} d={d} doc={doc} capturable={capturables.includes(doc.campo)} />)");
    // Dos pastillas van una debajo de otra: en la misma línea la segunda salía cortada por el ancho de la columna.
    expect(pastilla).toContain('pendientes.length > 1 ? <span className="doc-pend-varias">{pastillas}</span> : <>{pastillas}</>');
    expect(plano(leer("src/app/globals.css"))).toContain(".doc-pend-varias { display: inline-flex; flex-direction: column;");
    expect(pastilla).toContain("const campo = doc.campo;");
    expect(pastilla).toContain("await ponerDocumento(d.id, campo, valor)");
  });

  it("la pestaña cuenta y lista con `facturaPendiente`, sobre la lista que reparte `pasaLaVentanaDePendientes`", () => {
    const filas = plano(leer("src/lib/filas-de-ordenes.ts"));
    expect(filas).toContain("const pendientes = listas.conPendientes.filter((d) => facturaPendiente(d, reglas));");
    expect(plano(leer("src/lib/ordenes-visibles.ts"))).toContain("if (pasaLaVentanaDePendientes(d, ctx) && esDelAlcance(d, alcancePendientes, ctx.reglas)) conPendientes.push(d);");
  });

  it("al crear o enviar una Intertienda la factura NO es obligatoria: lo que se le pide sigue siendo el PO", () => {
    const completa = { order_type: "EntreTiendas", store: "Norte", pickup_name: "Norte", pickup_address: "1 Calle", delivery_name: "Sur",
      delivery_address: "2 Calle", delivery_date: HOY, delivery_windows: "AM", est_pallets: 2, po2: "PO-1", invoice_num: null };
    expect(missingFields(completa, REGLAS).map((m) => m.key)).toEqual([]);
    expect(missingFields({ ...completa, po2: null }, REGLAS).map((m) => m.key)).toEqual(["po2"]);
  });
});
