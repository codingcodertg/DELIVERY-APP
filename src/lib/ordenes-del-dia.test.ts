import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Stage } from "@/lib/types";
import { CHIPS_SIN_ASIGNAR, cuentasSinAsignar, filasSinAsignar, ordenesDelDia, paradasDelChofer, pendientesDeOtrosDias, sinAsignarDelGestor, type ChipSinAsignar, type ModoDelGestor } from "./ordenes-del-dia";

/** El Gestor de Rutas: cada día es aparte (D-331). «Hoy» se fija en el 19 para que las fechas de abajo signifiquen algo. */

const ETAPAS = ["pending", "approved", "fulfilling", "ready"];
const o = (id: string, delivery_date: string | null, stage: Stage = "approved", assigned_driver: string | null = null) => ({ id, delivery_date, stage, assigned_driver });
const TODAS = [
  o("de-hoy", "2026-09-19"), o("de-hoy-lista", "2026-09-19", "ready"), o("de-ayer", "2026-09-18"), o("de-hace-un-mes", "2026-08-19"), o("sin-fecha", null),
  o("de-manana", "2026-09-20"), o("ayer-entregada", "2026-09-18", "delivered"), o("hoy-anulada", "2026-09-19", "canceled"), o("hoy-en-camino", "2026-09-19", "picked_up"),
  // Atrasada pero YA en camino, y un borrador sin fecha: ninguna de las dos es algo que el Gestor pueda rutear.
  o("ayer-en-camino", "2026-09-18", "picked_up"), o("borrador-sin-fecha", null, "draft"),
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T17:00:00Z")); });      // mediodía en Texas
afterAll(() => { vi.useRealTimers(); });

describe("qué órdenes son de un día", () => {
  it("viendo HOY: solo las de hoy. La de ayer sin entregar NO sale, y la que no tiene fecha tampoco", () => {
    expect(ids(ordenesDelDia(TODAS, "2026-09-19", "dia", ETAPAS))).toEqual(["de-hoy", "de-hoy-lista"]);
  });
  it("viendo AYER sale la de ayer; viendo mañana, la de mañana: un día pasado o futuro se ve igual que hoy", () => {
    expect(ids(ordenesDelDia(TODAS, "2026-09-18", "dia", ETAPAS))).toEqual(["de-ayer"]);
    expect(ids(ordenesDelDia(TODAS, "2026-09-20", "dia", ETAPAS))).toEqual(["de-manana"]);
  });
  it("«todas» es todo lo ruteable, con o sin fecha; y nunca lo entregado, lo anulado ni lo que ya va en camino", () => {
    expect(ids(ordenesDelDia(TODAS, "2026-09-19", "todas", ETAPAS))).toEqual(["de-hoy", "de-hoy-lista", "de-ayer", "de-hace-un-mes", "sin-fecha", "de-manana"]);
  });
});

describe("lo que no es de ningún día: se cuenta aparte y se ve aparte", () => {
  it("atrasadas = su día ya pasó; sin fecha = no tiene día. Lo de hoy y lo de mañana no es ninguna de las dos", () => {
    const p = pendientesDeOtrosDias(TODAS, ETAPAS);
    expect([ids(p.atrasadas), ids(p.sinFecha)]).toEqual([["de-ayer", "de-hace-un-mes"], ["sin-fecha"]]);
  });
  it("la vista de pendientes SUSTITUYE a la del día: no lleva ni una orden de hoy, y no depende de la fecha elegida", () => {
    const vista = ids(ordenesDelDia(TODAS, "2026-09-19", "pendientes", ETAPAS));
    expect(vista).toEqual(["de-ayer", "de-hace-un-mes", "sin-fecha"]);
    expect(ids(ordenesDelDia(TODAS, "2026-01-01", "pendientes", ETAPAS))).toEqual(vista);
  });
  it("lo de un día y lo pendiente no se pisan nunca: ninguna orden sale en las dos vistas de HOY", () => {
    const hoy = new Set(ids(ordenesDelDia(TODAS, "2026-09-19", "dia", ETAPAS)));
    expect(ids(ordenesDelDia(TODAS, "2026-09-19", "pendientes", ETAPAS)).filter((id) => hoy.has(id))).toEqual([]);
  });
});

describe("la página del Gestor", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
  const pagina = leer("src/app/(app)/routes/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n").replace(/\s+/g, " ");
  it("lo que entra al día lo decide la función probada, y ya no hay arrastre escrito en la página", () => {
    expect(pagina).toContain("const dayOrders = useMemo(() => ordenesDelDia(deliveries, date, modo, ROUTE_STAGES), [deliveries, date, modo]);");
    expect(pagina).toContain('const modo: ModoDelGestor = soloPendientes ? "pendientes" : allDates ? "todas" : "dia";');
    expect(pagina).not.toMatch(/viewingToday|isOverdue\(d\) \|\| !d\.delivery_date/);
    expect(pagina).not.toContain("carries forward any earlier order");
  });
  it("lo pendiente se dice encima de la tabla y se ve APARTE; y en esa vista —como en «todas»— no sale «Planificar el día»", () => {
    expect(pagina).toContain("orden(es) atrasadas · ${pendientes.sinFecha.length} sin fecha");
    expect(pagina).toContain("onClick={() => { setAllDates(false); setSoloPendientes(true); }}");
    expect(pagina).toContain("onClick={() => setSoloPendientes(false)}");
    expect(pagina).toContain('{!allDates && !soloPendientes && me && ["admin", "logistics"].includes(me.role) && <PlanDelDia date={date} onPublicado={() => setPublicaciones((n) => n + 1)} />}');
  });
  it("«Planificar el día» tampoco arrastra: el motor lee SOLO las órdenes de esa fecha", () => {
    expect(leer("src/app/api/route-plan/route.ts").replace(/\s+/g, " ")).toContain('.eq("delivery_date", fecha).in("stage", [...ETAPAS_RUTEABLES])');
  });
});

describe("«Mi ruta» del chofer: mismo criterio", () => {
  const SUYAS = [
    o("hoy-1", "2026-09-19", "ready", "Chofer Uno"), o("hoy-entregada", "2026-09-19", "delivered", "Chofer Uno"), o("ayer-sin-entregar", "2026-09-18", "picked_up", "Chofer Uno"),
    o("ayer-entregada", "2026-09-18", "delivered", "Chofer Uno"), o("hoy-anulada", "2026-09-19", "canceled", "Chofer Uno"), o("ayer-rechazada", "2026-09-18", "rejected", "Chofer Uno"),
    o("de-otro", "2026-09-19", "ready", "Chofer Dos"), o("de-otro-atrasada", "2026-09-18", "ready", "Chofer Dos"), o("manana", "2026-09-20", "ready", "Chofer Uno"), o("sin-fecha", null, "ready", "Chofer Uno"),
  ];
  it("HOY son sus paradas de hoy —también la ya entregada, que cuenta en el progreso—; la de ayer sin entregar NO sale en hoy", () => {
    expect(ids(paradasDelChofer(SUYAS, "Chofer Uno", "2026-09-19", "dia"))).toEqual(["hoy-1", "hoy-entregada"]);
  });
  it("lo atrasado sigue siendo suyo y se ve APARTE: solo lo que no se entregó, y nunca lo de otro chofer", () => {
    expect(ids(paradasDelChofer(SUYAS, "Chofer Uno", "2026-09-19", "atrasadas"))).toEqual(["ayer-sin-entregar"]);
    expect(ids(paradasDelChofer(SUYAS, "Chofer Dos", "2026-09-19", "atrasadas"))).toEqual(["de-otro-atrasada"]);
  });
  it("la página usa la función, enseña la línea de atrasadas aparte, y en esa vista no sale la tarjeta del plan publicado", () => {
    const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
    const pagina = leer("src/app/(app)/my-route/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n").replace(/\s+/g, " ");
    expect(pagina).toContain('return routeOrder(paradasDelChofer(deliveries, driverName, todayISO(), verAtrasadas ? "atrasadas" : "dia"));');
    expect(pagina).toContain("parada(s) atrasadas de días anteriores — no son de hoy.");
    expect(pagina).toContain("{!verAtrasadas && <MiPlanPublicado plan={planPublicado}");
    expect(pagina).not.toMatch(/if \(d\.delivery_date === today\) return true; return isOverdue\(d\);/);
  });
});

describe("«Sin asignar»: el día por defecto, y con el chip «Atrasadas» las vencidas sin chofer de cualquier día (D-359)", () => {
  const n = (x: ReturnType<typeof o>, order_no: number) => ({ ...x, order_no });
  const POOL = [
    n(o("de-hoy", "2026-09-19"), 5), n(o("de-ayer", "2026-09-18"), 2), n(o("de-hace-un-mes", "2026-08-19"), 9),
    n(o("de-ayer-con-chofer", "2026-09-18", "approved", "Chofer"), 1), n(o("de-hoy-con-chofer", "2026-09-19", "approved", "Chofer"), 3),
    n(o("ayer-entregada", "2026-09-18", "delivered"), 4), n(o("sin-fecha", null), 6), n(o("de-manana", "2026-09-20"), 7),
  ];
  it("por defecto, SOLO lo del día sin chofer (D-331 sigue): ni ayer, ni sin fecha, ni mañana", () => {
    expect(ids(sinAsignarDelGestor(POOL, "2026-09-19", "dia", ETAPAS))).toEqual(["de-hoy"]);
  });
  it("con «Atrasadas», las vencidas sin chofer de cualquier día, por número; con chofer o entregada, no", () => {
    expect(ids(sinAsignarDelGestor(POOL, "2026-09-19", "dia", ETAPAS, true))).toEqual(["de-ayer", "de-hace-un-mes"]);
    // Y da igual el día que se mire: el chip manda.
    expect(ids(sinAsignarDelGestor(POOL, "2026-09-20", "dia", ETAPAS, true))).toEqual(["de-ayer", "de-hace-un-mes"]);
  });
  it("en «todas» y «pendientes» nada cambia", () => {
    expect(ids(sinAsignarDelGestor(POOL, "2026-09-19", "todas", ETAPAS))).toEqual(["de-ayer", "de-hoy", "sin-fecha", "de-manana", "de-hace-un-mes"]);
    expect(ids(sinAsignarDelGestor(POOL, "2026-09-19", "pendientes", ETAPAS))).toEqual(["de-ayer", "sin-fecha", "de-hace-un-mes"]);
  });
});

describe("«Sin asignar»: «Este día» y «Todas», y el número de cada chip es el de sus filas (D-393)", () => {
  type P = ReturnType<typeof o> & { order_no: number; delivery_windows: string | null; delivery_lat: number | null; account: string; delivery_address: string | null; delivery_phone: string | null; contact: string | null; store: string };
  const p = (x: ReturnType<typeof o>, order_no: number, extra: Partial<P> = {}): P => ({
    ...x, order_no, delivery_windows: null, delivery_lat: 26.2, account: "Cliente", delivery_address: null, delivery_phone: null, contact: null, store: "McAllen", ...extra,
  });
  // Los números NO van en el orden de la lista: si la función dejara de ordenar por número, se notaría.
  const POOL = [
    p(o("hoy-con-ventana", "2026-09-19"), 5, { delivery_windows: "09:00-12:00", account: "Casa Bella" }),
    p(o("hoy-sin-ubicacion", "2026-09-19"), 3, { delivery_lat: null }),
    p(o("ayer", "2026-09-18"), 2, { delivery_windows: "08:00-10:00" }),
    p(o("manana", "2026-09-20"), 8),
    p(o("sin-fecha", null), 1),
    p(o("hoy-con-chofer", "2026-09-19", "approved", "Chofer"), 4),
    p(o("ayer-entregada", "2026-09-18", "delivered"), 6),
    p(o("hace-un-mes", "2026-08-19"), 9, { account: "Casa Bella" }),
  ];
  const filas = (chip: ChipSinAsignar, busqueda = "", fecha = "2026-09-19", modo: ModoDelGestor = "dia") => ids(filasSinAsignar(POOL, fecha, modo, ETAPAS, chip, busqueda));

  it("«Este día» es el defecto de siempre: solo lo del día sin chofer, por número", () => {
    expect(filas("dia")).toEqual(["hoy-sin-ubicacion", "hoy-con-ventana"]);
  });
  it("«Todas» es lo sin chofer de CUALQUIER día —pasado, futuro y sin fecha—, por número; nunca con chofer ni entregada", () => {
    expect(filas("todas")).toEqual(["sin-fecha", "ayer", "hoy-sin-ubicacion", "hoy-con-ventana", "manana", "hace-un-mes"]);
  });
  it("«Todas» no depende del día que se mira", () => {
    expect(filas("todas", "", "2026-09-20")).toEqual(filas("todas"));
    expect(filas("todas", "", "2026-09-19", "pendientes")).toEqual(filas("todas"));
  });
  it("«Atrasadas» sigue siendo D-359: las vencidas de cualquier día", () => {
    expect(filas("overdue")).toEqual(["ayer", "hace-un-mes"]);
  });
  it("«Con ventana» y «Sin ubicación» acotan lo del día, no lo de otros días", () => {
    expect(filas("windowed")).toEqual(["hoy-con-ventana"]);
    expect(filas("noloc")).toEqual(["hoy-sin-ubicacion"]);
  });
  it("la búsqueda acota cada chip", () => {
    expect(filas("dia", "casa")).toEqual(["hoy-con-ventana"]);
    expect(filas("todas", "  CASA ")).toEqual(["hoy-con-ventana", "hace-un-mes"]);
    expect(filas("todas", "8")).toEqual(["manana"]);
  });
  it("el número de cada chip es EXACTAMENTE el de las filas que enseña, con y sin búsqueda", () => {
    for (const busqueda of ["", "casa", "8", "nadie"]) {
      const cuentas = cuentasSinAsignar(POOL, "2026-09-19", "dia", ETAPAS, busqueda);
      for (const chip of CHIPS_SIN_ASIGNAR) expect(cuentas[chip], `${chip} «${busqueda}»`).toBe(filas(chip, busqueda).length);
    }
    // Y no es un cero por todas partes: los números de verdad, sin búsqueda.
    expect(cuentasSinAsignar(POOL, "2026-09-19", "dia", ETAPAS)).toEqual({ dia: 2, todas: 6, overdue: 2, windowed: 1, noloc: 1 });
  });
});

describe("la pantalla del Gestor usa esas funciones para la tabla y los chips (D-393)", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  it("las filas de la tabla salen de `filasSinAsignar` con el chip y la búsqueda", () => {
    expect(pagina).toContain("const unassignedShown = useMemo(() => filasSinAsignar(deliveries, date, modo, ROUTE_STAGES, poolFilter, orderSearch)");
  });
  it("el número de cada chip sale de `cuentasSinAsignar` con la MISMA búsqueda, y se pinta en el chip", () => {
    expect(pagina).toContain("const cuentasDeChips = useMemo(() => cuentasSinAsignar(deliveries, date, modo, ROUTE_STAGES, orderSearch)");
    expect(pagina).toContain("({cuentasDeChips[f]})");
  });
  it("los cinco chips, con «Todas» detrás de «Este día», y «Este día» por defecto", () => {
    expect(pagina).toContain('{(["dia", "todas", "overdue", "windowed", "noloc"] as const).map((f) => (');
    expect(pagina).toContain('useState<ChipSinAsignar>("dia")');
  });
  it("el resumen, la pestaña y «Auto-asignar» cuentan el DÍA, sin el chip; lo marcado en la tabla va con el chip", () => {
    expect(pagina).toContain("const unassigned = useMemo(() => sinAsignarDelGestor(deliveries, date, modo, ROUTE_STAGES), [deliveries, date, modo]);");
    // Desde D-NEXT «Auto-asignar» reparte desde su diálogo: «Todas» es `unassigned` (el día), «Solo las marcadas» va con el chip.
    expect(pagina).toContain("const ordenes = ordenesDelReparto(e.alcance, unassigned, marcadas);");
    expect(pagina).toContain("const ids = filasDelChip.filter((d) => selectedOrders.has(d.id))");
    expect(pagina).toContain("const marcadas = filasDelChip.filter((d) => selectedOrders.has(d.id));");
  });
});
