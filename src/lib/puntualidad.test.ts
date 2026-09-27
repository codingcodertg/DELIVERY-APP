import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  millasDelRastro, minutosSobreElFin, puntualidadPorChofer, rangoValido, todasLasFilas,
  type EntradaDePuntualidad, type EntregaParaPuntualidad,
} from "./puntualidad";
import type { Posicion } from "./route-plan/llegadas";

/** Informe de puntualidad por chofer (D-414). Choferes y órdenes inventados. Zona del negocio: en septiembre, UTC−5. */

const Z = "America/Chicago";
const choferes = [{ id: "c-ana", full_name: "Chofer Ana" }, { id: "c-beto", full_name: "Chofer Beto" }];
const entrega = (id: string, extra: Partial<EntregaParaPuntualidad> = {}): EntregaParaPuntualidad => ({
  id, stage: "delivered", delivery_date: "2026-09-21", delivery_windows: "0900-1100", assigned_driver: "Chofer Ana", pod_delivered_at: null, is_training: false, ...extra,
});
const tocoEl = (id: string, quien: string | null, at = "2026-09-21T16:00:00Z") => ({ delivery_id: id, kind: "delivered", created_by: quien, created_at: at });
const base = (extra: Partial<EntradaDePuntualidad>): EntradaDePuntualidad => ({ entregas: [], choferes, eventos: [], paradas: [], posiciones: null, zona: Z, ...extra });

describe("minutos sobre el fin de la ventana", () => {
  it("a la hora local del negocio, y contando el día", () => {
    // 15:30Z = 10:30 en Texas; la ventana cierra a las 11:00 → −30.
    expect(minutosSobreElFin("2026-09-21T15:30:00Z", "2026-09-21", 660, Z)).toBe(-30);
    // 16:20Z = 11:20 → +20.
    expect(minutosSobreElFin("2026-09-21T16:20:00Z", "2026-09-21", 660, Z)).toBe(20);
    // Al día siguiente a las 09:00 local: 1440 − 120 = +1320, no −120.
    expect(minutosSobreElFin("2026-09-22T14:00:00Z", "2026-09-21", 660, Z)).toBe(1320);
    // 03:30Z del 22 son las 22:30 del 21 en Texas: sigue siendo el día 21.
    expect(minutosSobreElFin("2026-09-22T03:30:00Z", "2026-09-21", 660, Z)).toBe(690);
  });
});

describe("la hora real: GPS del plan publicado; si no, el toque DEL PROPIO chofer; si no, sin dato y por qué", () => {
  it("toque del propio chofer: cuenta; marcada por otra persona: no cuenta, y se dice", () => {
    const [f] = puntualidadPorChofer(base({
      entregas: [
        entrega("a", { pod_delivered_at: "2026-09-21T15:30:00Z" }),       // 10:30, la tocó Ana → a tiempo
        entrega("b", { pod_delivered_at: "2026-09-21T15:30:00Z" }),       // la tocó otra persona
        entrega("c", { pod_delivered_at: null }),                         // sin ninguna hora
      ],
      eventos: [tocoEl("a", "c-ana"), tocoEl("b", "u-oficina")],
    }));
    expect(f).toMatchObject({ chofer: "Chofer Ana", choferId: "c-ana", entregas: 3, conGPS: 0, conToque: 1, sinDato: { la_marco_otra_persona: 1, sin_hora: 1 }, medidas: 1, aTiempo: 1, tarde: 0, pctATiempo: 100 });
  });
  it("con el ÚLTIMO evento «delivered»: si otro la reabrió y la cerró, es de ese otro", () => {
    const [f] = puntualidadPorChofer(base({
      entregas: [entrega("a", { pod_delivered_at: "2026-09-21T15:30:00Z" })],
      eventos: [tocoEl("a", "c-ana", "2026-09-21T15:30:00Z"), tocoEl("a", "u-oficina", "2026-09-21T18:00:00Z")],
    }));
    expect(f.sinDato.la_marco_otra_persona).toBe(1);
    expect(f.conToque).toBe(0);
  });
  it("la llegada por GPS gana al toque — y solo si la parada es de ESE chofer", () => {
    const paradas = [
      { plan_date: "2026-09-21", driver_id: "c-ana", delivery_id: "a", kind: "D" as const, actual_arrival_at: "2026-09-21T15:50:00Z", leg_miles: 4 },   // 10:50
      { plan_date: "2026-09-21", driver_id: "c-ana", delivery_id: "a", kind: "P" as const, actual_arrival_at: "2026-09-21T13:00:00Z", leg_miles: 0 },   // la P no cuenta
      { plan_date: "2026-09-21", driver_id: "c-beto", delivery_id: "b", kind: "D" as const, actual_arrival_at: "2026-09-21T15:00:00Z", leg_miles: 6 },  // b pasó a Ana
    ];
    const [f] = puntualidadPorChofer(base({
      entregas: [entrega("a", { pod_delivered_at: "2026-09-21T16:30:00Z" }), entrega("b", { pod_delivered_at: "2026-09-21T16:30:00Z" })],
      eventos: [tocoEl("a", "c-ana"), tocoEl("b", "c-ana")], paradas,
    }));
    // a: GPS 10:50 → a tiempo (el toque, 11:30, habría salido tarde). b: el GPS es del camión de Beto → toque de Ana, 11:30 → tarde 30.
    expect(f).toMatchObject({ conGPS: 1, conToque: 1, medidas: 2, aTiempo: 1, antesDeAbrir: 0, tarde: 1, retrasoMedioMin: 30, retrasoMaxMin: 30, pctATiempo: 50 });
  });
});

describe("a tiempo, tarde, antes de abrir, sin ventana", () => {
  it("cuenta cada caso, y el retraso es SOLO de las tarde (media y peor)", () => {
    const e = (id: string, local: string, extra: Partial<EntregaParaPuntualidad> = {}) => entrega(id, { pod_delivered_at: local, ...extra });
    const filas = puntualidadPorChofer(base({
      entregas: [
        e("antes", "2026-09-21T13:30:00Z"),                                  // 08:30, antes de abrir (09:00) → a tiempo, antes de abrir
        e("justo", "2026-09-21T16:00:00Z"),                                  // 11:00 en punto → a tiempo
        e("tarde10", "2026-09-21T16:10:00Z"),                                // +10
        e("tarde50", "2026-09-21T16:50:00Z"),                                // +50
        e("sinventana", "2026-09-21T20:00:00Z", { delivery_windows: null }), // no entra en el %
        e("entrenamiento", "2026-09-21T20:00:00Z", { is_training: true }),   // no cuenta nada
        e("abierta", "2026-09-21T20:00:00Z", { stage: "picked_up" }),        // no está entregada
      ],
      eventos: ["antes", "justo", "tarde10", "tarde50", "sinventana", "entrenamiento", "abierta"].map((id) => tocoEl(id, "c-ana")),
    }));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ entregas: 5, conToque: 5, sinVentana: 1, medidas: 4, aTiempo: 2, antesDeAbrir: 1, tarde: 2, pctATiempo: 50, retrasoMedioMin: 30, retrasoMaxMin: 50 });
  });
  it("una fila por chofer, por nombre, sin mezclar; sin ninguna medida el % es null, no 0", () => {
    const filas = puntualidadPorChofer(base({
      entregas: [entrega("a", { pod_delivered_at: "2026-09-21T15:00:00Z" }), entrega("b", { assigned_driver: "chofer beto ", pod_delivered_at: null }), entrega("c", { assigned_driver: null })],
      eventos: [tocoEl("a", "c-ana")],
    }));
    expect(filas.map((f) => [f.chofer, f.choferId, f.entregas, f.pctATiempo])).toEqual([["Chofer Ana", "c-ana", 1, 100], ["chofer beto", "c-beto", 1, null]]);
  });
});

describe("millas: las del plan publicado y las del rastro GPS, cada una con sus días", () => {
  it("millas del plan: la suma de tramos de SUS paradas en los planes publicados; sin plan, null (no 0)", () => {
    const filas = puntualidadPorChofer(base({
      entregas: [entrega("a"), entrega("b", { assigned_driver: "Chofer Beto" })],
      paradas: [
        { plan_date: "2026-09-21", driver_id: "c-ana", delivery_id: "a", kind: "P", actual_arrival_at: null, leg_miles: 2.25 },
        { plan_date: "2026-09-21", driver_id: "c-ana", delivery_id: "a", kind: "D", actual_arrival_at: null, leg_miles: 7.5 },
        { plan_date: "2026-09-22", driver_id: "c-ana", delivery_id: "x", kind: "D", actual_arrival_at: null, leg_miles: 1 },
      ],
    }));
    expect(filas.map((f) => [f.chofer, f.millasPlan, f.diasConPlan])).toEqual([["Chofer Ana", 10.8, 2], ["Chofer Beto", null, 0]]);
  });

  const p = (driver_id: string, lat: number, lng: number, at: string, accuracy_m: number | null = 10): Posicion => ({ driver_id, lat, lng, accuracy_m, recorded_at: at });
  it("el rastro: suma lo recorrido, no el temblor del GPS parado, ni la recta sobre un hueco, ni puntos imprecisos", () => {
    // 0.01° de latitud ≈ 1112 m ≈ 0.69 mi.
    const r = millasDelRastro([
      p("c-ana", 26.00, -98, "2026-09-21T14:00:00Z"),
      // Temblor con el camión parado: diez puntos que van y vienen 33 m. Sumados serían ~0.2 mi; no se cuentan.
      p("c-ana", 26.0003, -98, "2026-09-21T14:01:00Z"),
      p("c-ana", 26.0000, -98, "2026-09-21T14:01:05Z"),
      p("c-ana", 26.0003, -98, "2026-09-21T14:01:10Z"),
      p("c-ana", 26.0000, -98, "2026-09-21T14:01:15Z"),
      p("c-ana", 26.0003, -98, "2026-09-21T14:01:20Z"),
      p("c-ana", 26.0000, -98, "2026-09-21T14:01:25Z"),
      p("c-ana", 26.0003, -98, "2026-09-21T14:01:30Z"),
      p("c-ana", 26.0000, -98, "2026-09-21T14:01:35Z"),
      p("c-ana", 26.0003, -98, "2026-09-21T14:01:40Z"),
      p("c-ana", 26.0000, -98, "2026-09-21T14:01:45Z"),
      p("c-ana", 26.01, -98, "2026-09-21T14:05:00Z"),               // +1112 m
      p("c-ana", 26.02, -98, "2026-09-21T14:10:00Z"),               // +1112 m
      p("c-ana", 26.50, -98, "2026-09-21T14:12:00Z", 500),          // impreciso: se ignora
      p("c-ana", 26.20, -98, "2026-09-21T15:00:00Z"),               // 50 min después: hueco, la recta no cuenta
      p("c-ana", 26.21, -98, "2026-09-21T15:05:00Z"),               // +1112 m
      p("c-ana", 26.21, -98, "2026-09-22T15:00:00Z"),               // otro día (hueco): 0, pero es un día con rastro
    ], Z);
    expect(r.get("c-ana")).toEqual({ millas: 2.1, dias: 2 });
  });
  it("sin posiciones leídas, «Millas GPS» es null (no se sabe); leídas y sin ninguna del chofer, 0 con 0 días", () => {
    expect(puntualidadPorChofer(base({ entregas: [entrega("a")], posiciones: null }))[0].millasGPS).toBeNull();
    const [f] = puntualidadPorChofer(base({ entregas: [entrega("a")], posiciones: [p("c-beto", 26, -98, "2026-09-21T14:00:00Z")] }));
    expect([f.millasGPS, f.diasConRastro]).toEqual([0, 0]);
  });
});

describe("el rango y la paginación", () => {
  it("fechas bien formadas, en orden, y como mucho 62 días", () => {
    expect(rangoValido("2026-09-01", "2026-09-30")).toBe(true);
    expect(rangoValido("2026-09-30", "2026-09-01")).toBe(false);
    expect(rangoValido("2026-07-01", "2026-08-31")).toBe(true);   // 62 días contando los dos extremos
    expect(rangoValido("2026-07-01", "2026-09-01")).toBe(false);  // 63
    expect(rangoValido("ayer", "2026-09-01")).toBe(false);
  });
  it("lee de 1000 en 1000 hasta que una página sale corta; si llega al tope, lo dice (cortado)", async () => {
    const pedidas: [number, number][] = [];
    const filas = Array.from({ length: 2500 }, (_, i) => i);
    const r = await todasLasFilas<number>((a, b) => { pedidas.push([a, b]); return Promise.resolve({ data: filas.slice(a, b + 1), error: null }); });
    expect(pedidas).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(r).toMatchObject({ error: null, cortado: false });
    expect(r.filas).toHaveLength(2500);
    const tope = await todasLasFilas<number>((a, b) => Promise.resolve({ data: filas.slice(a, b + 1), error: null }), 2000);
    expect([tope.filas.length, tope.cortado]).toEqual([2000, true]);
    const mal = await todasLasFilas<number>(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    expect(mal.error).toBe("boom");
  });
});

describe("dónde se usa", () => {
  const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  it("la ruta del servidor: solo lectura con la sesión, roles con GPS, el alcance del Panel, y la misma función", () => {
    const r = leer("src/app/api/puntualidad/route.ts");
    expect(r).toContain('const ROLES = ["admin", "logistics", "manager"];');
    expect(r).toContain("const entregas = ordenesDelPanel(leidas.filas as never[], alcance,");
    expect(r).toContain("filas: puntualidadPorChofer({ entregas, choferes:");
    expect(r).toContain('.eq("status", "published")');
    expect(r).toContain("posiciones = r.cortado ? null : r.filas;");
    expect(r).not.toContain("createAdminClient");
    expect(r).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("el Panel la pinta bajo los KPIs de choferes, con su rango y sus órdenes acotadas; el demo usa la misma función", () => {
    const panel = leer("src/app/(app)/dashboard/page.tsx");
    expect(panel).toContain("<PuntualidadPorChofer desde={from} hasta={to} entregasDelPanel={scoped} eventos={events} usuarios={users} />");
    const c = leer("src/components/PuntualidadPorChofer.tsx");
    expect(c).toContain("fetch(`/api/puntualidad?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`)");
    expect(c).toContain("filas: puntualidadPorChofer({");
    expect(c).toContain("paradas: [], posiciones: null, zona: BUSINESS_TZ,");
  });
});
