import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avisoDelHueco, costeDeLaRuta, escrituraDelHueco, mejorLugar, millasEstimadas, type ParadaDeRuta } from "./mejor-lugar";
import { splitIntoTrips } from "./dispatch";
import { secuenciaPD } from "./secuencia-pd";
import { FACTOR_DE_RODEO, millasEnLineaRecta } from "./route-times/proveedores";
import type { Delivery } from "./types";

/** «📍 Mejor lugar» del Gestor de Rutas (D-NEXT): una orden entra sola en el hueco más barato, sin reoptimizar el resto. */

const BASE = { lat: 29.7, lng: -95.4 };
const p = (id: string, lat: number, lng: number, ventana: [number, number] | null = null, pallets = 2): ParadaDeRuta & { lat: number; lng: number } =>
  ({ id, lat, lng, pallets, ventana, servicioMin: 15 });
// Una fila recta hacia el este desde la base: A, B, C.
const A = p("A", 29.7, -95.3), B = p("B", 29.7, -95.2), C = p("C", 29.7, -95.1);

afterEach(() => { vi.unstubAllGlobals(); });

describe("dónde entra", () => {
  it("entra entre sus vecinos: una orden entre A y B va en la parada 2 del viaje 1, casi sin millas de más", () => {
    const r = mejorLugar({ viajes: [[A, B, C]], nueva: p("X", 29.7, -95.25), base: BASE, capacidad: 12, inicioMin: 480 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hueco).toMatchObject({ viaje: 0, puesto: 1, nuevoViaje: false });
    expect(r.hueco.millasExtra).toBeLessThan(0.05);
    expect(r.huecosMirados).toBe(4);
    // El siguiente mejor cuesta más: es lo que dice el aviso para explicar el porqué.
    expect(r.siguiente!.millasExtra).toBeGreaterThan(r.hueco.millasExtra);
  });

  it("respeta la capacidad: con el viaje 1 lleno va al viaje 2, aunque el 1 le quede más cerca", () => {
    const lleno = [p("A", 29.7, -95.3, null, 12)];
    const r = mejorLugar({ viajes: [lleno, [C]], nueva: p("X", 29.7, -95.29), base: BASE, capacidad: 12, inicioMin: 480 });
    expect(r.ok && r.hueco.viaje).toBe(1);
    expect(r.ok && r.hueco.nuevoViaje).toBe(false);
  });

  it("si no cabe en ningún viaje, va en uno nuevo al final", () => {
    const r = mejorLugar({ viajes: [[p("A", 29.7, -95.3, null, 11)], [p("C", 29.7, -95.1, null, 11)]], nueva: p("X", 29.7, -95.25, null, 3), base: BASE, capacidad: 12, inicioMin: 480 });
    expect(r.ok && r.hueco).toMatchObject({ viaje: 2, puesto: 0, nuevoViaje: true });
    expect(r.ok && r.huecosMirados).toBe(1);
  });

  it("nunca abre un viaje nuevo si cabe en uno que ya existe", () => {
    const r = mejorLugar({ viajes: [[p("C", 29.7, -95.1, null, 2)]], nueva: p("X", 29.9, -95.9, null, 2), base: BASE, capacidad: 12, inicioMin: 480 });
    expect(r.ok && r.hueco.nuevoViaje).toBe(false);
    expect(r.ok && r.huecosMirados).toBe(2);
  });

  it("las ventanas, si se puede: el hueco más corto retrasaría una ventana estrecha, y elige el que no retrasa a nadie", () => {
    const Bv = p("B", 29.7, -95.1, [480, 530]);
    const Cn = p("C", 29.9, -95.35);
    const X = p("X", 29.705, -95.35);
    const sinVentana = mejorLugar({ viajes: [[{ ...Bv, ventana: null }, Cn]], nueva: X, base: BASE, capacidad: 12, inicioMin: 480 });
    const conVentana = mejorLugar({ viajes: [[Bv, Cn]], nueva: X, base: BASE, capacidad: 12, inicioMin: 480 });
    // Por millas, delante de B…
    expect(sinVentana.ok && sinVentana.hueco.puesto).toBe(0);
    // …pero eso haría llegar tarde a B: con la ventana, va al final, sin retrasos nuevos.
    expect(conVentana.ok && conVentana.hueco.puesto).toBe(2);
    expect(conVentana.ok && conVentana.hueco.tardeExtraMin).toBe(0);
    // Y el porqué: el más corto era el de delante de B, y retrasaba.
    expect(conVentana.ok && conVentana.masCorto).toMatchObject({ viaje: 0, puesto: 0 });
    expect(conVentana.ok && conVentana.masCorto!.tardeExtraMin).toBeGreaterThan(0);
    expect(sinVentana.ok && sinVentana.masCorto).toBeNull();
    const delante = costeDeLaRuta([[X, Bv, Cn]], BASE, 480);
    expect(delante.tardeMin).toBeGreaterThan(0);
  });

  it("una orden sin pin no se coloca: lo dice", () => {
    expect(mejorLugar({ viajes: [[A]], nueva: p("X", NaN, NaN), base: BASE, capacidad: 12, inicioMin: 480 })).toEqual({ ok: false, motivo: "sin_punto" });
  });

  it("sin base, la ruta es abierta y aun así elige", () => {
    const r = mejorLugar({ viajes: [[A, B, C]], nueva: p("X", 29.7, -95.15), base: null, capacidad: 12, inicioMin: 480 });
    expect(r.ok && r.hueco.puesto).toBe(2);
  });

  it("el coste es la estimación en línea recta con su rodeo, y no llama a nadie (ni Google ni OSRM)", () => {
    const llamadas = vi.fn(() => { throw new Error("no debería llamar"); });
    vi.stubGlobal("fetch", llamadas);
    expect(millasEstimadas(A, B)).toBeCloseTo(millasEnLineaRecta(A, B) * FACTOR_DE_RODEO, 6);
    mejorLugar({ viajes: [[A, B, C]], nueva: p("X", 29.7, -95.25), base: BASE, capacidad: 12, inicioMin: 480 });
    expect(llamadas).not.toHaveBeenCalled();
  });
});

describe("el reloj y las millas de la ruta", () => {
  const d = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => millasEstimadas(a, b);
  const min = (millas: number) => (millas / 30) * 60;
  it("un viaje es un lazo: sale de la base y vuelve", () => {
    expect(costeDeLaRuta([[A]], BASE, 480).millas).toBeCloseTo(2 * d(BASE, A), 6);
  });
  it("la llegada a la segunda parada suma el manejo y la descarga de la primera", () => {
    const r = costeDeLaRuta([[A, B]], BASE, 480);
    expect(r.llegadas.get("A")).toBeCloseTo(480 + min(d(BASE, A)), 6);
    expect(r.llegadas.get("B")).toBeCloseTo(480 + min(d(BASE, A)) + 15 + min(d(A, B)), 6);
  });
  it("llegar antes de que abra la ventana espera a que abra", () => {
    expect(costeDeLaRuta([[{ ...A, ventana: [600, 660] }]], BASE, 480).llegadas.get("A")).toBe(600);
  });
  it("entre un viaje y el siguiente, la vuelta a la base y la recarga", () => {
    const r = costeDeLaRuta([[A], [B]], BASE, 480);
    expect(r.llegadas.get("B")).toBeCloseTo(480 + 2 * min(d(BASE, A)) + 15 + 20 + min(d(BASE, B)), 6);
  });
});

describe("qué se escribe", () => {
  const viajes = [[{ id: "A" }, { id: "B" }], [{ id: "C" }]];
  it("en una ruta que parte la capacidad sola: solo la secuencia, sin tocar los viajes", () => {
    expect(escrituraDelHueco(viajes, "X", { viaje: 0, puesto: 1 }, false)).toEqual({ ids: ["A", "X", "B", "C"], loadNoDeLaNueva: null });
  });
  it("con viajes puestos a mano: también el viaje de cada parada, y la nueva en el suyo", () => {
    expect(escrituraDelHueco(viajes, "X", { viaje: 1, puesto: 0 }, true)).toEqual({
      ids: ["A", "B", "X", "C"], loadNoById: { A: null, B: null, X: 2, C: 2 }, loadNoDeLaNueva: 2,
    });
  });
  it("un viaje nuevo va al final", () => {
    expect(escrituraDelHueco(viajes, "X", { viaje: 2, puesto: 0 }, true).loadNoById).toEqual({ A: null, B: null, C: 2, X: 3 });
  });

  it("en una ruta que parte la capacidad sola, lo escrito se vuelve a partir IGUAL (la pantalla no mueve ningún corte)", () => {
    const d = (id: string, pallets: number) => ({ id, est_pallets: pallets, actual_pallets: null }) as unknown as Delivery;
    const paradas = [d("A", 5), d("B", 5), d("C", 4), d("D", 6)];
    const antes = splitIntoTrips(paradas, 12);
    expect(antes.map((v) => v.map((x) => x.id))).toEqual([["A", "B"], ["C", "D"]]);
    const aPar = (x: Delivery, i: number) => p(x.id, 29.7, -95.3 + i * 0.05, null, x.est_pallets ?? 0);
    const r = mejorLugar({ viajes: antes.map((v) => v.map((x) => aPar(x, paradas.indexOf(x)))), nueva: p("X", 29.7, -95.19, null, 2), base: BASE, capacidad: 12, inicioMin: 480 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = escrituraDelHueco(antes, "X", r.hueco, false);
    const despues = splitIntoTrips(w.ids.map((id) => (id === "X" ? d("X", 2) : paradas.find((x) => x.id === id)!)), 12);
    const esperado = antes.map((v) => v.map((x) => x.id));
    esperado[r.hueco.viaje].splice(r.hueco.puesto, 0, "X");
    expect(despues.map((v) => v.map((x) => x.id))).toEqual(esperado);
  });

  it("la recogida va antes que la entrega: en la lectura P/D, la P de la nueva sale delante de su D, en su viaje", () => {
    const w = escrituraDelHueco([[{ id: "A" }, { id: "B" }], [{ id: "C" }]], "X", { viaje: 1, puesto: 1 }, true);
    const viajes = [[...w.ids].filter((id) => w.loadNoById![id] == null), w.ids.filter((id) => w.loadNoById![id] === 2)]
      .map((v) => v.map((id) => ({ id, store: id === "X" ? "Otra tienda" : "Tienda", pallets: 1 })));
    const seq = secuenciaPD(viajes);
    const iP = seq.findIndex((s) => s.tipo === "P" && s.ordenes.includes("X"));
    const iD = seq.findIndex((s) => s.tipo === "D" && s.ordenes.includes("X"));
    expect(iP).toBeGreaterThanOrEqual(0);
    expect(iD).toBeGreaterThan(iP);
    // Y la P de X es del viaje 2: sale después de la última entrega del viaje 1.
    expect(iP).toBeGreaterThan(seq.findIndex((s) => s.tipo === "D" && s.ordenes.includes("B")));
  });
});

describe("el aviso dice dónde y por qué", () => {
  it("viaje, parada, entre quién, millas, hora y el siguiente mejor", () => {
    const a = avisoDelHueco({
      orden: "1003", ruta: "Diego Driver",
      hueco: { viaje: 0, puesto: 1, nuevoViaje: false, millasExtra: 0.04, tardeExtraMin: 0, llegadaMin: 505 },
      totalDelViaje: 4, anterior: "1001", siguienteParada: "1002", huecosMirados: 4,
      alternativa: { viaje: 0, puesto: 3, nuevoViaje: false, millasExtra: 2.2, tardeExtraMin: 0, llegadaMin: 600 },
    });
    expect(a.es).toBe("#1003 → Diego Driver, viaje 1, parada 2 de 4 (entre #1001 y #1002): +0.0 mi, ~08:25, sin retrasos nuevos. El mejor de 4 hueco(s), estimación en línea recta. El siguiente mejor: viaje 1, parada 4, +2.2 mi.");
    expect(a.en).toContain("truckload 1, stop 2 of 4 (between #1001 and #1002)");
  });
  it("si el más corto retrasaba una ventana, lo dice: es el porqué", () => {
    const a = avisoDelHueco({
      orden: "1064", ruta: "FT3", hueco: { viaje: 0, puesto: 1, nuevoViaje: false, millasExtra: 1.8, tardeExtraMin: 0, llegadaMin: 554 },
      totalDelViaje: 3, anterior: "1010", siguienteParada: "1032", huecosMirados: 5, alternativa: null,
      masCorto: { viaje: 0, puesto: 2, nuevoViaje: false, millasExtra: 1.62, tardeExtraMin: 80, llegadaMin: 700 },
    });
    expect(a.es).toContain("El más corto (viaje 1, parada 3, +1.6 mi) sumaba 80 min de retraso en las ventanas.");
  });
  it("un viaje nuevo lo dice, y el retraso también", () => {
    const a = avisoDelHueco({
      orden: "9", ruta: "R", hueco: { viaje: 2, puesto: 0, nuevoViaje: true, millasExtra: 10, tardeExtraMin: 7, llegadaMin: 700 },
      totalDelViaje: 1, anterior: null, siguienteParada: null, huecosMirados: 1, alternativa: null,
    });
    expect(a.es).toContain("viaje nuevo 3 (no cabía en ninguno)");
    expect(a.es).toContain("+7 min tarde");
    expect(a.es).toContain("(sola)");
  });
});

describe("la pantalla del Gestor usa «Mejor lugar»", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  const cuerpo = (() => {
    const i = pagina.indexOf("const colocaEnElMejorLugar = async");
    return pagina.slice(i, pagina.indexOf("const previewAdd = async", i));
  })();

  it("el botón del recuadro «Elige conductor» coloca en la ruta del elegido, y se apaga sin elegido o con la ruta bloqueada", () => {
    expect(pagina).toContain("data-mejor-lugar disabled={!conductorElegido || autoAssigning || (!!conductorElegido && bloqueada(conductorElegido))}");
    expect(pagina).toContain("onClick={() => { if (conductorElegido) void colocaEnElMejorLugar(conductorElegido); }}");
  });
  it("con la ruta bloqueada, el recuadro dice por qué", () => {
    expect(pagina).toContain("{conductorElegido && bloqueada(conductorElegido) && ( <span className=\"hint\" data-mejor-lugar-bloqueada");
  });
  it("mira el candado ANTES de tocar nada, y avisa", () => {
    expect(cuerpo.indexOf("if (bloqueada(laneKey)) {")).toBeGreaterThan(-1);
    expect(cuerpo.indexOf("if (bloqueada(laneKey)) {")).toBeLessThan(cuerpo.indexOf("updateDelivery("));
    expect(cuerpo).toContain("Mejor lugar no la toca");
  });
  it("el hueco sale de `mejorLugar` sobre los viajes que pinta la pantalla (`buildTrips`), con la capacidad del chofer y las ventanas", () => {
    expect(cuerpo).toContain("mejorLugar({ viajes: buildTrips(paradas, capacidad).map((v) => v.map(aParada)), nueva: aParada(d), base, capacidad, inicioMin: DAY_START_MIN })");
    expect(cuerpo).toContain("const capacidad = capacityFor(driverOf(laneKey));");
    expect(cuerpo).toContain("ventana: parseWindow(x.delivery_windows), servicioMin: serviceMin(x.delivery_duration)");
  });
  it("escribe con `escrituraDelHueco`: la nueva con su chofer y su puesto, y la secuencia entera con `reorderStops`", () => {
    expect(cuerpo).toContain("const w = escrituraDelHueco(viajes, d.id, r.hueco, hasManualLoads(paradas));");
    expect(cuerpo).toContain("await updateDelivery(d.id, { assigned_driver: laneKey, route_seq: w.ids.indexOf(d.id), load_no: w.loadNoDeLaNueva });");
    expect(cuerpo).toContain("await reorderStops(w.ids, w.loadNoById);");
  });
  it("la siguiente orden ya ve a la anterior dentro (se colocan una detrás de otra)", () => {
    expect(cuerpo).toContain("paradas = w.ids.map((id, i) => ({");
  });
  it("no reoptimiza ni llama al optimizador", () => {
    expect(cuerpo).not.toContain("computeRoute(");
    expect(cuerpo).not.toContain("/api/optimize-route");
    expect(cuerpo).not.toContain("applyPlan(");
  });
  it("el aviso dice dónde entró y por qué, y queda en la nota de la orden", () => {
    expect(cuerpo).toContain("const aviso = avisoDelHueco({");
    expect(cuerpo).toContain("huecosMirados: r.huecosMirados, alternativa: r.siguiente, masCorto: r.masCorto,");
    expect(cuerpo).toContain("setAvisoMejorLugar([...colocadas.map((a) => t(a.en, a.es))");
    expect(cuerpo).toContain("addNote(d.id, `Best fit: ${aviso.en}`);");
  });
});
