import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANCHO_PLAN_CON_RECORRIDO, ANCHO_RECORRIDO_REAL, BORDE_RECORRIDO_REAL, COLOR_HUECO, COLOR_RECORRIDO_REAL,
  choferDeLaLineaPlaneada, lineasDelRecorridoReal, planContraRecorrido, unCamionPorChofer,
} from "./recorrido-contra-plan";
import { choferesEnVivo } from "./choferes-en-vivo";
import { carrilesDelDia, puntosDeLasRutas, rutasPorChofer } from "./mapa-de-rutas";
import { lecturaConLoHecho } from "./route-plan/lectura-del-gestor";
import { diaDeLaRuta } from "./gestor/numeros-del-dia";
import { fallbackDriverColor } from "./utils";
import type { DriverLocation } from "./types";
import type { Fix } from "./track-history";
import type { MapLine } from "@/components/LeafletMap";

/**
 * D-NEXT · El dueño, 2026-11-04, con el mapa de Julio: «¿por qué se miran 3 bubbles de Julio? Solo debería ser 1, que sea
 * el driver en ese momento. Ahora quiero que la ruta que lleva el driver esté en otro color al de su ruta, para comparar si
 * de verdad está siguiendo la ruta que es».
 *
 * Producción a esa hora (solo lectura): Julio Jijon tenía UNA fila en vivo (la 1408, Moar Dr, Weslaco) y tres órdenes
 * cargadas a las 12:07 para la misma dirección (1102 W Expressway 83, Weslaco: 1388, 1406 y 1401). El mapa las pintaba como
 * pines con «🚚» —abiertos en abanico—, y al lado el camión en vivo: tres (o cuatro) camioncitos.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (en: string) => en;

describe("1 · un chofer, un camión: el de su posición más nueva", () => {
  it("de tres marcas del mismo chofer queda una, la de menos minutos; el orden de los choferes no cambia", () => {
    const c = unCamionPorChofer([
      { driver: "Julio", ageMin: 30, lat: 1 }, { driver: "Ana", ageMin: 2, lat: 9 },
      { driver: "Julio", ageMin: 0.2, lat: 3 }, { driver: "Julio", ageMin: 5, lat: 2 },
    ]);
    expect(c.map((x) => [x.driver, x.lat])).toEqual([["Julio", 3], ["Ana", 9]]);
  });
  it("sin minutos, gana la primera", () => {
    expect(unCamionPorChofer([{ driver: "A", lat: 1 }, { driver: "A", lat: 2 }]).map((x) => x.lat)).toEqual([1]);
  });
  it("`choferesEnVivo` tampoco devuelve dos camiones del mismo chofer", () => {
    const AHORA = new Date("2026-11-04T18:32:00Z").getTime();
    const fijo = (min: number, lat: number) => ({ id: String(lat), driver_id: "u-julio", lat, lng: -97.95, accuracy_m: 4, speed_mps: null, heading: null, battery_pct: null, recorded_at: new Date(AHORA - min * 60_000).toISOString(), created_at: "" }) as DriverLocation;
    const vivos = choferesEnVivo([fijo(9, 26.17), fijo(0.5, 26.155), fijo(3, 26.16)], new Map([["u-julio", "Julio Jijon"]]), () => "teal", AHORA);
    expect(vivos).toHaveLength(1);
    expect(vivos[0].lat).toBe(26.155);
  });
  it("los dos mapas pintan una marca por chofer (`unCamionPorChofer`), y Google la mueve en sitio (D-837)", () => {
    const g = leer("src/components/GoogleMapView.tsx");
    expect(g).toContain("for (const d of unCamionPorChofer(liveDrivers)) {");
    expect(g).toContain("it.marker.setPosition(pos);");
    expect(leer("src/components/LeafletMap.tsx")).toContain("for (const d of unCamionPorChofer(liveDrivers)) {");
  });
});

describe("2 · las órdenes cargadas no se pintan como camiones", () => {
  // El día de Julio, reducido: tres órdenes para la misma dirección (una ya entregada, dos cargadas) y una pendiente.
  const W = { delivery_lat: 26.1736386, delivery_lng: -98.0014466, delivery_address: "1102 W Expressway 83, Weslaco" };
  const orden = (id: string, stage: string, seq: number, extra: Record<string, unknown> = {}) => ({
    id, order_no: 1000 + seq, order_code: id, invoice_num: `INV-${id}`, stage, assigned_driver: "Julio Jijon", route_seq: seq,
    store: "RDZ Pharr", delivery_date: "2026-11-04", ...W, ...extra,
  });
  const entregada = orden("1401", "delivered", 7, { pod_delivered_at: "2026-11-04T18:13:49Z" });
  const cargadaA = orden("1388", "picked_up", 8), cargadaB = orden("1406", "picked_up", 9);
  const pendiente = orden("1407", "fulfilling", 10, { delivery_lat: 26.1364732, delivery_lng: -97.9952434, delivery_address: "2205 Camille St" });
  type O = typeof pendiente;
  const hechas = [entregada, cargadaA, cargadaB];
  // Como el Gestor: lo cargado va también en la lista del chofer (D-621), y el día lleva solo lo pendiente.
  const enLaLista = [cargadaA, cargadaB, pendiente];
  const dia = (stops: O[]) => diaDeLaRuta(lecturaConLoHecho(stops, 12, null, hechas), stops, hechas, 12, null).paradas;
  const pts = puntosDeLasRutas<O>({
    carriles: carrilesDelDia([{ id: "u-julio", full_name: "Julio Jijon" }], [], [pendiente], ["Julio Jijon"]),
    porChofer: rutasPorChofer(enLaLista), delDia: [pendiente], hechas: new Map([["Julio Jijon", hechas]]),
    pasaFiltro: () => true, soloUnChofer: false, enfocado: false, atenuada: () => false, colorDe: () => "teal", colorSinChofer: "gris",
    baseDe: () => ({ coords: [26.204, -98.168], direccion: "RDZ Pharr" }), paradasDe: (_k, s) => dia(s),
    coordsDeTienda: () => ({ lat: 26.204, lng: -98.168 }), t,
  });

  it("ningún pin lleva «🚚»: el camión es solo el del chofer en vivo", () => {
    expect(pts.filter((p) => p.badge?.includes("🚚"))).toEqual([]);
  });
  it("lo hecho en la misma dirección y la misma parada es UNA burbuja, con su número, encendida mientras quede algo por entregar", () => {
    const enW = pts.filter((p) => p.lat === W.delivery_lat && p.lng === W.delivery_lng);
    const numeros = new Set(enW.map((p) => p.badge));
    // Una burbuja por parada (si el día las cuenta como paradas distintas, una por cada número; nunca una por orden repetida).
    expect(enW.length).toBe(numeros.size);
    expect(enW.every((p) => /^\d+(·\d+)*$/.test(p.badge ?? ""))).toBe(true);
    // Las cargadas siguen sin entregar: su burbuja no se apaga.
    expect(enW.some((p) => p.dimmed === false && /1388|1406/.test(p.label))).toBe(true);
  });
});

describe("3 · la ruta planeada y lo manejado, en estilos que no se confunden", () => {
  const f = (min: number, lat: number, lng: number): Fix => ({ lat, lng, accuracy_m: 5, at: new Date(Date.UTC(2026, 10, 4, 15, min)).toISOString() });
  // Julio maneja seguido por la I-2 y luego se queda 20 min sin señal y reaparece a 3 millas: ese tramo, punteado.
  const julio = [f(0, 26.2, -98.2), f(1, 26.2, -98.19), f(2, 26.2, -98.18), f(25, 26.2, -98.13), f(26, 26.2, -98.12)];
  const plan: MapLine[] = [
    { id: "plan:Julio Jijon", color: "teal", positions: [[26.2, -98.2], [26.2, -98.1]], offset: 0 },
    { id: "line:Ana#0", color: "azul", positions: [[26.1, -98.2], [26.1, -98.1]] },
    { id: "ret:Ana#0", color: "azul", positions: [[26.1, -98.1], [26.1, -98.2]], dashed: true },
    { id: "sel:abc", color: "morado", positions: [[1, 1], [2, 2]] },
  ];

  it("lo manejado: tinta oscura, fina, con borde blanco y por encima; el hueco sin GPS, punteado y gris (D-835)", () => {
    const real = lineasDelRecorridoReal({ "Julio Jijon": julio });
    const solidas = real.filter((l) => !l.dashed), huecos = real.filter((l) => l.dashed);
    expect(solidas.length).toBe(2);
    for (const l of solidas) expect(l).toMatchObject({ color: COLOR_RECORRIDO_REAL, weight: ANCHO_RECORRIDO_REAL, borde: BORDE_RECORRIDO_REAL, encima: true });
    expect(huecos).toHaveLength(1);
    expect(huecos[0]).toMatchObject({ color: COLOR_HUECO, dashed: true, encima: true });
    expect(huecos[0].borde).toBeUndefined();
    expect(real.every((l) => l.id.startsWith("real:Julio Jijon:seg"))).toBe(true);
  });
  it("el filtro de chofer y la atenuación del Gestor valen también para lo manejado", () => {
    expect(lineasDelRecorridoReal({ "Julio Jijon": julio, Ana: julio }, { pasaFiltro: (c) => c === "Ana" }).every((l) => l.id.startsWith("real:Ana:"))).toBe(true);
    expect(lineasDelRecorridoReal({ "Julio Jijon": julio }, { atenuada: () => true }).every((l) => l.dimmed)).toBe(true);
  });
  it("la planeada sigue en el color del chofer, pero se ensancha solo si ese chofer tiene recorrido; la vuelta punteada y lo marcado, tal cual", () => {
    const todas = planContraRecorrido(plan, lineasDelRecorridoReal({ "Julio Jijon": julio }));
    const de = (id: string) => todas.find((l) => l.id === id)!;
    expect(de("plan:Julio Jijon")).toMatchObject({ color: "teal", weight: ANCHO_PLAN_CON_RECORRIDO });
    expect(de("line:Ana#0").weight).toBeUndefined();
    expect(de("ret:Ana#0").weight).toBeUndefined();
    expect(de("sel:abc").weight).toBeUndefined();
    // Lo manejado va después de todo lo planeado: encima también en Leaflet, que apila por orden.
    const primeraReal = todas.findIndex((l) => l.id.startsWith("real:"));
    expect(todas.slice(primeraReal).every((l) => l.id.startsWith("real:"))).toBe(true);
    // El pasillo es más ancho que lo manejado con su borde (2 px a cada lado): el color del chofer se ve a los dos lados.
    expect(ANCHO_PLAN_CON_RECORRIDO).toBeGreaterThan(ANCHO_RECORRIDO_REAL + 4);
  });
  it("sin recorrido no cambia nada", () => {
    expect(planContraRecorrido(plan, [])).toEqual(plan);
  });
  it("el chofer de una línea planeada, también de una carga «Julio·2»", () => {
    expect(choferDeLaLineaPlaneada("plan:Julio Jijon")).toBe("Julio Jijon");
    expect(choferDeLaLineaPlaneada("line:Ana#3")).toBe("Ana");
    expect(choferDeLaLineaPlaneada("real:Ana:seg0")).toBeNull();
    expect(choferDeLaLineaPlaneada("sel:x")).toBeNull();
  });
  it("la tinta de lo manejado no es ningún color de chofer de la paleta", () => {
    const paleta = new Set(Array.from({ length: 200 }, (_, i) => fallbackDriverColor(`chofer ${i}`)));
    expect(paleta.has(COLOR_RECORRIDO_REAL)).toBe(false);
    expect(paleta.has(COLOR_HUECO)).toBe(false);
  });
  it("el Gestor, «Ruta de hoy» y el mapa de «Mi ruta» (la misma página) pintan lo manejado encima de lo planeado, sin leyenda (D-520)", () => {
    const p = leer("src/app/(app)/routes/page.tsx");
    expect(p).toContain("return planContraRecorrido(out, lineasDelRecorridoReal(recorridoDelDia, { pasaFiltro, atenuada: isDim }));");
    expect(p).toContain("const recorridoDelDia = useRecorridoDelDia(choferesDelRecorrido, date, veCamiones, driverLocations, date === todayISO());");
    expect(p).not.toContain("LeyendaPlanContraReal");
  });
  it("Google: lo manejado y su borde se alargan en sitio (setPath), sin borrar y crear (D-837)", () => {
    const g = leer("src/components/GoogleMapView.tsx");
    expect(g).toContain("previa.poly.setPath(offsetPath(line.positions, off));");
    expect(g).toContain("previa.borde?.setPath(offsetPath(line.positions, off));");
  });
});
