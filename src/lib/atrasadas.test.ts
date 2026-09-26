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
 * **D-392 (2026-09-25) la dejó solo para admin y logística**: *«ONLY LOGISTICS AND admin CAN SEE DAYS
 * BEFORE YESTERDAY»*. Por eso la persona de partida de estas pruebas es logística, y lo que les pasa a
 * los demás roles está en su propio bloque, al final.
 *
 * **D-404 (2026-09-26)**: *«all late delivery orders need to go in a similar filter like invoice
 * pending pero en rojo, entonces las late ya no se verán en all sino que se van directo a outdated»*.
 * Entra TODA atrasada abierta, también la de ayer; la pastilla sale solo con algo dentro (o estando
 * en ella), y vuelve a ser de todos los roles: los que no ven días viejos, con las de ayer.
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
 * del mismo día viejo (no van a ningún sitio para quien no ve historial), una abierta de ayer (desde
 * D-404 va también a «Outdated»), y hoy y mañana.
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

describe("qué es una atrasada para «Outdated»: `isOverdue`, sin suelo (D-404)", () => {
  it("abierta y anterior a ayer, sí", () => {
    expect(vaAAtrasadas({ stage: "approved", delivery_date: HACE_DIEZ })).toBe(true);
    expect(vaAAtrasadas({ stage: "ready", delivery_date: ANTEAYER })).toBe(true);
  });
  it("entregada o anulada, no, por vieja que sea", () => {
    expect(vaAAtrasadas({ stage: "delivered", delivery_date: HACE_DIEZ })).toBe(false);
    expect(vaAAtrasadas({ stage: "canceled", delivery_date: HACE_DIEZ })).toBe(false);
  });
  it("la de AYER abierta también (D-404): «all late delivery orders», y `isOverdue` ya la cuenta", () => {
    // Hasta D-404 esta era la única discrepancia con `isOverdue`: un suelo en ayer la dejaba en la
    // lista normal (D-384). El dueño la quiere en «Outdated» como todas.
    expect(isOverdue({ stage: "fulfilling", delivery_date: AYER })).toBe(true);
    expect(vaAAtrasadas({ stage: "fulfilling", delivery_date: AYER })).toBe(true);
  });
  it("hoy, mañana y sin fecha, no", () => {
    for (const f of [HOY, MANANA, null]) expect(vaAAtrasadas({ stage: "approved", delivery_date: f }), String(f)).toBe(false);
  });
  it("con el día fijado: ayer respecto a ese día, sí; ese mismo día, no", () => {
    expect(vaAAtrasadas({ stage: "approved", delivery_date: "2026-09-21" }, "2026-09-23")).toBe(true);
    expect(vaAAtrasadas({ stage: "approved", delivery_date: "2026-09-22" }, "2026-09-23")).toBe(true);
    expect(vaAAtrasadas({ stage: "approved", delivery_date: "2026-09-23" }, "2026-09-23")).toBe(false);
  });
});

/*
 * **D-407 (2026-09-26, por la tarde) revierte la mitad «fuera de la lista normal» de D-404.** El
 * dueño: *«outdated que también salga en all»*. La atrasada abierta sale en «Todas» (y en su etapa)
 * **y** en «Outdated». Estas pruebas exigían lo contrario —que la normal no llevara ninguna, y que las
 * dos listas no se solaparan— y se cambiaron, no se borraron: ahora exigen que esté en los dos sitios.
 */
describe("la atrasada sale en la lista normal Y en «Outdated» (D-407)", () => {
  it("logística: las abiertas atrasadas —ayer incluida— en las DOS listas; la entregada vieja, solo en la normal", () => {
    const { visibles, atrasadas } = ordenesVisibles(DIA, ctx());
    expect(ids(visibles)).toEqual(["anteayer-lista", "ayer-abierta", "hoy", "manana", "sin-fecha", "vieja-abierta", "vieja-anulada", "vieja-entregada"]);
    expect(ids(atrasadas)).toEqual(["anteayer-lista", "ayer-abierta", "vieja-abierta"]);
  });

  it("admin (historial entero): las abiertas atrasadas —ayer incluida— en las DOS listas; la entregada vieja, solo en la normal", () => {
    const { visibles, atrasadas } = ordenesVisibles(DIA, ctx({ me: { id: "u-admin", role: "admin", store: null }, veTodoElHistorial: seesAllHistory("admin") }));
    expect(ids(visibles)).toEqual(["anteayer-lista", "ayer-abierta", "hoy", "manana", "sin-fecha", "vieja-abierta", "vieja-anulada", "vieja-entregada"]);
    expect(ids(atrasadas)).toEqual(["anteayer-lista", "ayer-abierta", "vieja-abierta"]);
  });

  it("cada atrasada de «Outdated» está TAMBIÉN en la lista normal, sin buscar (D-407)", () => {
    // Hasta D-407 era lo contrario: «la lista normal no lleva NINGUNA orden que `isOverdue` dé por
    // atrasada» (D-404). Se compara contra `isOverdue` y no contra `vaAAtrasadas`, y sobre una lista
    // que no está vacía: un «todas están» sobre cero atrasadas pasaría con cualquier código.
    const { visibles, atrasadas } = ordenesVisibles(DIA, ctx());
    expect(atrasadas.length).toBe(3);
    for (const d of atrasadas) expect(visibles, d.id).toContain(d);
    expect(ids(visibles.filter((d) => isOverdue(d)))).toEqual(ids(atrasadas));
  });

  it("«Outdated» no lleva nada que no sea atrasada abierta", () => {
    const { atrasadas } = ordenesVisibles(DIA, ctx());
    expect(atrasadas.every((d) => d.stage !== "delivered" && d.stage !== "canceled")).toBe(true);
  });

  it("buscando, la atrasada sale TAMBIÉN en la normal: buscar es el camino a todo (D-374)", () => {
    const { visibles, atrasadas } = ordenesVisibles(DIA, ctx({ busqueda: "F-1" }));
    expect(ids(visibles)).toContain("vieja-abierta");
    expect(ids(visibles)).toContain("ayer-abierta");
    expect(ids(atrasadas)).toEqual(["anteayer-lista", "ayer-abierta", "vieja-abierta"]);
  });
});

describe("cada rol ve en «Outdated» solo las atrasadas que ya podía ver (D-374)", () => {
  // Desde D-392, ventas y almacén solo llegan aquí con `history` marcado a mano en Usuarios (D-350):
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
    expect(ids(filasDeOrdenes(listas, PESTANA_ATRASADAS, () => true, REGLAS))).toEqual(["anteayer-lista", "ayer-abierta", "vieja-abierta"]);
  });

  it("fuera de «Outdated» su número avisa: cuenta todas aunque el chip esté en «Hoy»", () => {
    const listas = listasDe(ctx());
    expect(cuentasDeOrdenes(listas, PASTILLA_TODAS, presets.hoy, REGLAS)[PESTANA_ATRASADAS]).toBe(3);
  });

  // Hasta D-407 esta prueba exigía lo contrario («“Todas” … NO enseña atrasadas», D-404). El dueño,
  // 2026-09-26 por la tarde: *«outdated que también salga en all»*.
  it("«Todas» con el chip en «Todas» enseña las atrasadas, y «Outdated» también: la misma orden en las dos pastillas (D-407)", () => {
    const listas = listasDe(ctx({ veTodoElHistorial: true }));
    const todas = ids(filasDeOrdenes(listas, PASTILLA_TODAS, () => true, REGLAS));
    const outdated = ids(filasDeOrdenes(listas, PESTANA_ATRASADAS, () => true, REGLAS));
    for (const id of ["vieja-abierta", "anteayer-lista", "ayer-abierta"]) {
      expect(todas, id).toContain(id);
      expect(outdated, id).toContain(id);
    }
    // Y la de su etapa también la cuenta y la enseña: la atrasada «fulfilling» de ayer está en «fulfilling».
    expect(ids(filasDeOrdenes(listas, "fulfilling", () => true, REGLAS))).toEqual(["ayer-abierta"]);
    expect(cuentasDeOrdenes(listas, PASTILLA_TODAS, () => true, REGLAS).fulfilling).toBe(1);
  });
});

describe("la pastilla en la fila", () => {
  const fila = (cuentas: Record<string, number>, filtro: string) =>
    pastillasDeOrdenes({ etapas: ["approved", "ready"], todasAprueban: false, cuentas, filtro, pendientesSinTienda: false });

  it("con 0 no sale, como la de factura pendiente (D-404; antes salía siempre, D-384)", () => {
    expect(fila({}, PASTILLA_TODAS).find((x) => x.key === PESTANA_ATRASADAS)).toBeUndefined();
    expect(fila({ [PESTANA_ATRASADAS]: 1 }, PASTILLA_TODAS).find((x) => x.key === PESTANA_ATRASADAS))
      .toMatchObject({ cuenta: 1, activa: false, clase: "chip-late" });
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
    expect(pagina).toContain("const { visibles: visible, conPendientes, atrasadas, alcancePendientes, alcanceLista } = useMemo( () => ordenesVisibles(deliveries, {");
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
