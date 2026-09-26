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
 * «Factura pendiente» es solo de la tienda propia (D-404).
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
const AYER = shiftDateISO(HOY, -1);

const REGLAS: OrderTypeRules = { ConFactura: { docRef: "invoice" } };
// «Norte» y «Oeste» trabajan juntas (mismo grupo); «Sur» va sola.
const TIENDAS: NamedLocation[] = [
  { name: "Norte", group: "G1" },
  { name: "Oeste", group: "G1" },
  { name: "Sur" },
] as NamedLocation[];

const YO = "u-yo";
const ids = (l: readonly Delivery[]) => l.map((d) => d.id).sort();

/**
 * Entregada AYER sin factura: lo que llena la pestaña. Todas de quien mira, para que a ventas solo la
 * separe la tienda.
 *
 * Hasta D-407 eran de hace 20 días (la exención de D-313 las dejaba entrar). Desde D-407 la pestaña
 * lleva solo de ayer en adelante —*«invoice pending solo muestra yesterday, today y tomorrow y
 * future»*, 2026-09-26—, así que con esa fecha no saldrían en ningún rol y estas pruebas de TIENDA
 * medirían la fecha. Lo de 20 días tiene su propia prueba abajo.
 */
const pendiente = (id: string, store: string, over: Partial<Delivery> = {}) => mkDelivery({
  id, stage: "delivered", order_type: "ConFactura", invoice_num: null, delivery_date: AYER,
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

/**
 * D-407. El dueño, 2026-09-26: *«invoice pending solo muestra yesterday, today y tomorrow y future»*.
 * Para TODOS los roles: el pedido no hace excepción con admin y logística.
 */
describe("«Factura pendiente» solo de ayer en adelante, para todos (D-407)", () => {
  const HACE_TRES = shiftDateISO(HOY, -3);
  const MANANA = shiftDateISO(HOY, 1);
  const DATOS = [
    pendiente("hace-tres", "Norte", { delivery_date: HACE_TRES }),
    pendiente("hace-veinte", "Norte", { delivery_date: HACE_VEINTE }),
    pendiente("anteayer", "Norte", { delivery_date: shiftDateISO(HOY, -2) }),
    pendiente("ayer", "Norte"),
    pendiente("hoy", "Norte", { delivery_date: HOY }),
    pendiente("manana", "Norte", { delivery_date: MANANA, stage: "approved" }),
    pendiente("sin-fecha", "Norte", { delivery_date: null, stage: "approved" }),
  ];
  const DENTRO = ["ayer", "hoy", "manana", "sin-fecha"];

  for (const role of ["admin", "logistics", "accounting", "manager", "sales"] as const) {
    it(`${role}: una pendiente de hace 3 días NO sale; ayer, hoy, mañana y sin fecha sí; y el número = filas`, () => {
      const c = ctxDe(role, "Norte");
      expect(ids(filasDePendiente(c, DATOS))).toEqual(DENTRO);
      expect(cuentaDePendiente(c, DATOS)).toBe(DENTRO.length);
    });
  }

  it("con el chip de fecha puesto y estando dentro, el número sigue siendo el de filas", () => {
    const listas = ordenesVisibles(DATOS, ctxDe("admin", null));
    const soloHoy = (d: Delivery) => d.delivery_date === HOY;
    expect(cuentasDeOrdenes(listas, PESTANA_DOCUMENTO_PENDIENTE, soloHoy, REGLAS)[PESTANA_DOCUMENTO_PENDIENTE])
      .toBe(filasDeOrdenes(listas, PESTANA_DOCUMENTO_PENDIENTE, soloHoy, REGLAS).length);
  });

  it("admin sigue viendo la de hace 3 días en la lista normal: el corte es solo de la pestaña", () => {
    const { visibles, conPendientes } = ordenesVisibles(DATOS, ctxDe("admin", null));
    expect(ids(visibles)).toContain("hace-tres");
    expect(ids(conPendientes)).not.toContain("hace-tres");
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
