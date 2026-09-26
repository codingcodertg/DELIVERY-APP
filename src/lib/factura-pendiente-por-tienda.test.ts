import { describe, expect, it } from "vitest";
import { alcanceDePendientes, leTocaPorRol, ordenesVisibles, type ContextoDeLista } from "./ordenes-visibles";
import { cuentasDeOrdenes, filasDeOrdenes } from "./filas-de-ordenes";
import { PESTANA_DOCUMENTO_PENDIENTE } from "./documento-pendiente";
import { PASTILLA_TODAS } from "./pastillas-de-ordenes";
import { mkDelivery } from "./__fixtures";
import { seesAllHistory, shiftDateISO, todayISO } from "./utils";
import type { OrderTypeRules } from "./required";
import type { Delivery, NamedLocation, UserRole } from "./types";

/**
 * «Factura pendiente» es solo de la tienda propia (D-NEXT).
 *
 * El dueño, 2026-09-26: *«en invoice pending estrictamente solo se pueden ver órdenes de tu tienda, no
 * de otras»*. Hasta aquí D-338 hacía que la pestaña EMPEZARA por la tienda propia, pero enseñaba las
 * demás detrás. Ahora: admin y logística, todas; el resto, su tienda y las de su grupo (D-293); sin
 * tienda, ninguna. La regla de tiendas es la del Panel (D-396), no una nueva.
 *
 * Los nombres de tienda y de tipo son inventados: los de verdad son datos del dueño (Ajustes).
 */

const HOY = todayISO();
const HACE_VEINTE = shiftDateISO(HOY, -20);

const REGLAS: OrderTypeRules = { ConFactura: { docRef: "invoice" } };
// «Norte» y «Oeste» trabajan juntas (mismo grupo); «Sur» va sola.
const TIENDAS: NamedLocation[] = [
  { name: "Norte", group: "G1" },
  { name: "Oeste", group: "G1" },
  { name: "Sur" },
] as NamedLocation[];

const YO = "u-yo";
const ids = (l: readonly Delivery[]) => l.map((d) => d.id).sort();

/** Entregada hace 20 días sin factura: lo que llena la pestaña. Todas de quien mira, para que a ventas solo la separe la tienda. */
const pendiente = (id: string, store: string, over: Partial<Delivery> = {}) => mkDelivery({
  id, stage: "delivered", order_type: "ConFactura", invoice_num: null, delivery_date: HACE_VEINTE,
  store, created_by: YO, assigned_sales_rep: YO, ...over,
});

// Desordenadas a propósito: la de otra tienda va la primera.
const PENDIENTES = [
  pendiente("sur-1", "Sur"),
  pendiente("norte-1", "Norte"),
  pendiente("sur-2", "Sur"),
  pendiente("oeste-1", "Oeste"),
];

const ctxDe = (role: UserRole, store: string | null, over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
  me: { id: YO, role, store },
  teaching: false,
  veTodoElHistorial: seesAllHistory(role),
  busqueda: "",
  reglas: REGLAS,
  tiendas: TIENDAS,
  tiendasDeAlmacen: [],
  ...over,
});

const filasDePendiente = (c: ContextoDeLista, datos: readonly Delivery[] = PENDIENTES) =>
  filasDeOrdenes(ordenesVisibles(datos, c), PESTANA_DOCUMENTO_PENDIENTE, () => true, REGLAS);
const cuentaDePendiente = (c: ContextoDeLista, datos: readonly Delivery[] = PENDIENTES) =>
  cuentasDeOrdenes(ordenesVisibles(datos, c), PASTILLA_TODAS, () => true, REGLAS)[PESTANA_DOCUMENTO_PENDIENTE];

describe("office, gerente y ventas: solo su tienda y las de su grupo", () => {
  for (const role of ["accounting", "manager", "sales"] as const) {
    it(`${role} de Norte: Norte y Oeste (su grupo), nunca Sur; y el número = filas`, () => {
      const c = ctxDe(role, "Norte");
      expect(ids(filasDePendiente(c))).toEqual(["norte-1", "oeste-1"]);
      expect(cuentaDePendiente(c)).toBe(2);
    });

    it(`${role} de Sur (va sola): solo Sur`, () => {
      const c = ctxDe(role, "Sur");
      expect(ids(filasDePendiente(c))).toEqual(["sur-1", "sur-2"]);
      expect(cuentaDePendiente(c)).toBe(2);
    });
  }

  it("ventas: la suya de otra tienda ya no sale en la pestaña (D-374 le deja verla en la lista, aquí no)", () => {
    // Control: por rol le tocan las cuatro, porque son todas suyas; lo único que quita Sur es la tienda.
    const c = ctxDe("sales", "Norte");
    expect(PENDIENTES.every((d) => leTocaPorRol(d, c))).toBe(true);
    expect(ids(filasDePendiente(c))).not.toContain("sur-1");
  });

  it("ventas: la de otro vendedor de su tienda tampoco (el corte por rol sigue antes)", () => {
    const deOtro = pendiente("norte-otro", "Norte", { created_by: "u-otro", assigned_sales_rep: "u-otro" });
    expect(ids(filasDePendiente(ctxDe("sales", "Norte"), [...PENDIENTES, deOtro]))).toEqual(["norte-1", "oeste-1"]);
  });

  it("almacén de Norte, lo mismo: su tienda y su grupo", () => {
    const c = ctxDe("warehouse", "Norte", { tiendasDeAlmacen: ["norte", "oeste"] });
    expect(ids(filasDePendiente(c))).toEqual(["norte-1", "oeste-1"]);
  });
});

describe("el corte es solo de la pestaña: la lista normal no cambia", () => {
  it("office de Norte sigue viendo en «Todas» una orden de Sur de hoy", () => {
    const deHoySur = mkDelivery({ id: "hoy-sur", stage: "approved", order_type: "ConFactura", invoice_num: null, delivery_date: HOY, store: "Sur", created_by: YO });
    const { visibles, conPendientes } = ordenesVisibles([deHoySur], ctxDe("accounting", "Norte"));
    expect(ids(visibles)).toEqual(["hoy-sur"]);
    expect(ids(conPendientes)).toEqual([]);
  });
});

describe("quien queda fuera de la regla", () => {
  for (const role of ["admin", "logistics"] as const) {
    it(`${role}: todas, tenga tienda o no`, () => {
      expect(ids(filasDePendiente(ctxDe(role, null)))).toEqual(["norte-1", "oeste-1", "sur-1", "sur-2"]);
      expect(ids(filasDePendiente(ctxDe(role, "Norte")))).toEqual(["norte-1", "oeste-1", "sur-1", "sur-2"]);
      expect(cuentaDePendiente(ctxDe(role, "Norte"))).toBe(4);
    });
  }

  it("el sandbox de enseñanza no tiene cortes, tampoco este", () => {
    expect(ids(filasDePendiente(ctxDe("accounting", null, { teaching: true })))).toEqual(["norte-1", "oeste-1", "sur-1", "sur-2"]);
  });
});

describe("sin tienda: ninguna, y la pantalla lo sabe por el mismo valor", () => {
  for (const role of ["accounting", "manager", "sales"] as const) {
    it(`${role} sin tienda: 0 filas, 0 en la pastilla, y alcance «sin-tienda»`, () => {
      const c = ctxDe(role, null);
      expect(filasDePendiente(c)).toEqual([]);
      expect(cuentaDePendiente(c)).toBe(0);
      expect(ordenesVisibles(PENDIENTES, c).alcancePendientes).toEqual({ tipo: "sin-tienda" });
    });
  }

  it("`alcanceDePendientes` es el que devuelve `ordenesVisibles`", () => {
    const c = ctxDe("accounting", "Norte");
    expect(ordenesVisibles([], c).alcancePendientes).toEqual(alcanceDePendientes(c));
    expect(alcanceDePendientes(c)).toMatchObject({ tipo: "tiendas", normalizadas: ["norte", "oeste"] });
  });
});
