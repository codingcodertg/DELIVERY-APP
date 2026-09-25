import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PESTANA_ATRASADAS, vaAAtrasadas } from "./atrasadas";
import { ordenesVisibles, type ContextoDeLista } from "./ordenes-visibles";
import { cuentasDeOrdenes, filasDeOrdenes, type ListasDeOrdenes } from "./filas-de-ordenes";
import { pastillasDeOrdenes, PASTILLA_TODAS } from "./pastillas-de-ordenes";
import { PESTANA_DOCUMENTO_PENDIENTE, presetAlElegirPastilla } from "./documento-pendiente";
import { mkDelivery } from "./__fixtures";
import { isOverdue, isToday, seesAllHistory, shiftDateISO, todayISO, withinRecent } from "./utils";
import type { OrderTypeRules } from "./required";
import type { Delivery, NamedLocation } from "./types";

/**
 * La pastilla «Outdated / Atrasadas» de Órdenes (D-384).
 *
 * El dueño: *«make a filter name outdated and put the old order there»*. Dentro, las atrasadas
 * abiertas anteriores a ayer; fuera de la lista normal, que se queda con ayer, hoy y lo que viene.
 * Para todos los roles, cada uno con las órdenes que ya podía ver.
 *
 * **D-NEXT (2026-09-25) la dejó solo para admin y logística**: *«ONLY LOGISTICS AND admin CAN SEE DAYS
 * BEFORE YESTERDAY»*. Por eso la persona de partida de estas pruebas es logística, y lo que les pasa a
 * los demás roles está en su propio bloque, al final.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const ids = (l: readonly Delivery[]) => l.map((d) => d.id).sort();

const HOY = todayISO();
const AYER = shiftDateISO(HOY, -1);
const ANTEAYER = shiftDateISO(HOY, -2);
const HACE_DIEZ = shiftDateISO(HOY, -10);
const MANANA = shiftDateISO(HOY, 1);

const REGLAS: OrderTypeRules = { ConFactura: { docRef: "invoice" }, SinDocumento: { docRef: "none" } };
const TIENDAS: NamedLocation[] = [{ name: "Norte" }, { name: "Sur" }] as NamedLocation[];

const ctx = (over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
  me: { id: "u-log", role: "logistics", store: null },
  teaching: false,
  veTodoElHistorial: seesAllHistory("logistics"),
  busqueda: "",
  reglas: REGLAS,
  tiendas: TIENDAS,
  tiendasDeAlmacen: [],
  ...over,
});

const orden = (id: string, stage: Delivery["stage"], delivery_date: string | null, over: Partial<Delivery> = {}) =>
  mkDelivery({ id, stage, delivery_date, order_type: "SinDocumento", store: "Norte", created_by: "u-vendedor", invoice_num: "F-1", ...over });

/**
 * Un día de trabajo que CONTRADICE: una abierta vieja (va a «Outdated»), una entregada y una anulada
 * del mismo día viejo (no van a ningún sitio para quien no ve historial), una abierta de ayer (está
 * atrasada según `isOverdue` pero se queda en la lista normal), y hoy y mañana.
 */
const DIA = [
  orden("vieja-abierta", "approved", HACE_DIEZ),
  orden("anteayer-lista", "ready", ANTEAYER),
  orden("vieja-entregada", "delivered", HACE_DIEZ),
  orden("vieja-anulada", "canceled", HACE_DIEZ),
  orden("ayer-abierta", "fulfilling", AYER),
  orden("hoy", "approved", HOY),
  orden("manana", "approved", MANANA),
  orden("sin-fecha", "approved", null),
];

describe("qué es una atrasada para «Outdated»: `isOverdue` más el suelo de ayer", () => {
  it("abierta y anterior a ayer, sí", () => {
    expect(vaAAtrasadas({ stage: "approved", delivery_date: HACE_DIEZ })).toBe(true);
    expect(vaAAtrasadas({ stage: "ready", delivery_date: ANTEAYER })).toBe(true);
  });
  it("entregada o anulada, no, por vieja que sea", () => {
    expect(vaAAtrasadas({ stage: "delivered", delivery_date: HACE_DIEZ })).toBe(false);
    expect(vaAAtrasadas({ stage: "canceled", delivery_date: HACE_DIEZ })).toBe(false);
  });
  it("la de AYER abierta no: `isOverdue` la cuenta atrasada, pero el dueño dejó ayer en la lista normal", () => {
    // Esta es la única discrepancia entre las dos piezas, y es a propósito: sin el suelo, la de
    // ayer saldría en las dos listas.
    expect(isOverdue({ stage: "fulfilling", delivery_date: AYER })).toBe(true);
    expect(vaAAtrasadas({ stage: "fulfilling", delivery_date: AYER })).toBe(false);
  });
  it("hoy, mañana y sin fecha, no", () => {
    for (const f of [HOY, MANANA, null]) expect(vaAAtrasadas({ stage: "approved", delivery_date: f }), String(f)).toBe(false);
  });
  it("con el día fijado, el suelo se mueve con él", () => {
    expect(vaAAtrasadas({ stage: "approved", delivery_date: "2026-09-21" }, "2026-09-23")).toBe(true);
    expect(vaAAtrasadas({ stage: "approved", delivery_date: "2026-09-22" }, "2026-09-23")).toBe(false);
  });
});

describe("la lista normal ya no las lleva; «Outdated» sí", () => {
  it("logística: la entregada vieja sigue en la normal, pero la abierta vieja SOLO en Outdated", () => {
    const { visibles, atrasadas } = ordenesVisibles(DIA, ctx());
    expect(ids(visibles)).toEqual(["ayer-abierta", "hoy", "manana", "sin-fecha", "vieja-anulada", "vieja-entregada"]);
    expect(ids(atrasadas)).toEqual(["anteayer-lista", "vieja-abierta"]);
  });

  it("admin (historial entero): la entregada vieja sigue en la normal, pero la abierta vieja SOLO en Outdated", () => {
    const { visibles, atrasadas } = ordenesVisibles(DIA, ctx({ me: { id: "u-admin", role: "admin", store: null }, veTodoElHistorial: seesAllHistory("admin") }));
    expect(ids(visibles)).toEqual(["ayer-abierta", "hoy", "manana", "sin-fecha", "vieja-anulada", "vieja-entregada"]);
    expect(ids(atrasadas)).toEqual(["anteayer-lista", "vieja-abierta"]);
  });

  it("las dos listas no se solapan y, juntas, son lo que antes era la lista normal", () => {
    const { visibles, atrasadas } = ordenesVisibles(DIA, ctx());
    const enLasDos = visibles.filter((d) => atrasadas.includes(d));
    expect(enLasDos).toEqual([]);
    expect(atrasadas.every((d) => d.stage !== "delivered" && d.stage !== "canceled")).toBe(true);
  });

  it("buscando, la atrasada sale TAMBIÉN en la normal: buscar es el camino a todo (D-374)", () => {
    const { visibles, atrasadas } = ordenesVisibles(DIA, ctx({ busqueda: "F-1" }));
    expect(ids(visibles)).toContain("vieja-abierta");
    expect(ids(atrasadas)).toEqual(["anteayer-lista", "vieja-abierta"]);
  });
});

describe("cada rol ve en «Outdated» solo las atrasadas que ya podía ver (D-374)", () => {
  // Desde D-NEXT, ventas y almacén solo llegan aquí con `history` marcado a mano en Usuarios (D-350):
  // es lo que pone `veTodoElHistorial` a true sin ser admin ni logística. El corte por rol sigue.
  it("ventas: la suya sí, la de otro no", () => {
    const vendedor = { id: "u-vendedor", role: "sales" as const, store: "Norte" };
    const suya = orden("suya", "approved", HACE_DIEZ);
    const ajena = orden("ajena", "approved", HACE_DIEZ, { created_by: "u-otro" });
    const { atrasadas } = ordenesVisibles([suya, ajena], ctx({ me: vendedor, veTodoElHistorial: seesAllHistory("sales", ["history"]) }));
    expect(ids(atrasadas)).toEqual(["suya"]);
  });

  it("almacén: su tienda sí, otra tienda no, y lo anterior a la aprobación tampoco", () => {
    const almacen = ctx({ me: { id: "u-alm", role: "warehouse", store: "Norte" }, tiendasDeAlmacen: ["norte"], veTodoElHistorial: seesAllHistory("warehouse", ["history"]) });
    const mia = orden("mia", "ready", HACE_DIEZ);
    const ajena = orden("ajena", "ready", HACE_DIEZ, { store: "Sur" });
    const pendiente = orden("pendiente", "pending", HACE_DIEZ);
    const { atrasadas } = ordenesVisibles([mia, ajena, pendiente], almacen);
    expect(ids(atrasadas)).toEqual(["mia"]);
  });
});

describe("el número de cada pastilla es el de filas que enseña al pulsarla", () => {
  const listasDe = (c: ContextoDeLista): ListasDeOrdenes => ordenesVisibles(DIA, c);
  const presets: Record<string, (d: Delivery) => boolean> = {
    todas: () => true,
    reciente: (d) => withinRecent(d),
    hoy: (d) => isToday(d.delivery_date),
  };
  const filtros = [PASTILLA_TODAS, "approved", "ready", "fulfilling", "delivered", PESTANA_DOCUMENTO_PENDIENTE, PESTANA_ATRASADAS];

  for (const [nombreRol, c] of [
    ["office", ctx({ me: { id: "u-office", role: "accounting", store: null }, veTodoElHistorial: seesAllHistory("accounting") })],
    ["logística", ctx()],
    ["admin", ctx({ me: { id: "u-admin", role: "admin", store: null }, veTodoElHistorial: seesAllHistory("admin") })],
  ] as const) {
    for (const [nombrePreset, pasa] of Object.entries(presets)) {
      it(`${nombreRol}, chip «${nombrePreset}»: cuenta = filas, para cada pastilla`, () => {
        const listas = listasDe(c);
        for (const f of filtros) {
          expect(cuentasDeOrdenes(listas, f, pasa, REGLAS)[f] ?? 0, f).toBe(filasDeOrdenes(listas, f, pasa, REGLAS).length);
        }
      });
    }
  }

  it("dentro de «Outdated» las filas son las atrasadas, de TODAS las etapas abiertas", () => {
    const listas = listasDe(ctx());
    expect(ids(filasDeOrdenes(listas, PESTANA_ATRASADAS, () => true, REGLAS))).toEqual(["anteayer-lista", "vieja-abierta"]);
  });

  it("fuera de «Outdated» su número avisa: cuenta todas aunque el chip esté en «Hoy»", () => {
    const listas = listasDe(ctx());
    expect(cuentasDeOrdenes(listas, PASTILLA_TODAS, presets.hoy, REGLAS)[PESTANA_ATRASADAS]).toBe(2);
  });

  it("«Todas» con el chip en «Todas» NO enseña atrasadas, ni para el admin", () => {
    const filas = filasDeOrdenes(listasDe(ctx({ veTodoElHistorial: true })), PASTILLA_TODAS, () => true, REGLAS);
    expect(ids(filas)).not.toContain("vieja-abierta");
    expect(ids(filas)).not.toContain("anteayer-lista");
  });
});

describe("la pastilla en la fila", () => {
  const fila = (cuentas: Record<string, number>, filtro: string) =>
    pastillasDeOrdenes({ etapas: ["approved", "ready"], todasAprueban: false, cuentas, filtro, veDiasViejos: true });

  it("sale siempre, también con 0: la lista normal ya no las enseña y hay que saber dónde buscarlas", () => {
    const p = fila({}, PASTILLA_TODAS).find((x) => x.key === PESTANA_ATRASADAS);
    expect(p).toMatchObject({ cuenta: 0, activa: false, clase: "chip-late" });
  });

  it("encendida cuando es el filtro, y sola", () => {
    const f = fila({ [PESTANA_ATRASADAS]: 3 }, PESTANA_ATRASADAS);
    expect(f.filter((p) => p.activa).map((p) => p.key)).toEqual([PESTANA_ATRASADAS]);
    expect(f.find((p) => p.key === PESTANA_ATRASADAS)?.cuenta).toBe(3);
  });

  it("entrar mueve el chip de fecha a «Todas», venga de donde venga (como D-380)", () => {
    for (const antes of ["recent", "today", "all"]) expect(presetAlElegirPastilla(PESTANA_ATRASADAS, antes, "all"), antes).toBe("all");
  });
});

describe("la pantalla usa todo esto, y no una copia", () => {
  const pagina = plano(leer("src/app/(app)/page.tsx"));

  it("pide las tres listas a `ordenesVisibles` y se las pasa enteras a las cuentas y a las filas", () => {
    expect(pagina).toContain("const { visibles: visible, conPendientes, atrasadas } = useMemo( () => ordenesVisibles(deliveries, {");
    expect(pagina).toContain("const listas = useMemo(() => ({ visibles: visible, conPendientes, atrasadas }), [visible, conPendientes, atrasadas]);");
  });

  it("las cuentas y las filas salen de las mismas listas, con el mismo filtro y el mismo chip de fecha", () => {
    expect(pagina).toContain("() => cuentasDeOrdenes(listas, filter, pasaElPreset, settings.order_type_rules ?? {}),");
    expect(pagina).toContain('() => filasDeOrdenes(listas, view === "board" ? PASTILLA_TODAS : filter, pasaElPreset, settings.order_type_rules ?? {}),');
    // Y la pastilla se pinta con esas cuentas, no con otras.
    expect(pagina).toContain("cuentas: counts,");
  });

  it("la pastilla dice «Outdated» / «Atrasadas»", () => {
    expect(pagina).toContain(': p.key === PESTANA_ATRASADAS ? t("Outdated", "Atrasadas")');
  });
});
