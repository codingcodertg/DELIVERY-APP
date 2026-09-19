import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Stage } from "@/lib/types";
import { ordenesDelDia, paradasDelChofer, pendientesDeOtrosDias } from "./ordenes-del-dia";

/** El Gestor de Rutas: cada día es aparte (D-NEXT). «Hoy» se fija en el 19 para que las fechas de abajo signifiquen algo. */

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
    expect(pagina).toContain('{!allDates && !soloPendientes && me && ["admin", "logistics"].includes(me.role) && <PlanDelDia date={date} />}');
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
    expect(pagina).toContain("{!verAtrasadas && <MiPlanPublicado date={todayISO()}");
    expect(pagina).not.toMatch(/if \(d\.delivery_date === today\) return true; return isOverdue\(d\);/);
  });
});
