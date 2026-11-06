import { describe, it, expect } from "vitest";
import { colaConLoVivo, eligeRecorrido, fixesDeLaLinea, millasDeLosPuntos, rastroParaElMapa, rastrosDeLaRespuesta, simplificaRastro, textoDelConteo, SILENCIO_MAX_S, TOLERANCIA_M } from "./rastro-en-mapa";
import { metros, type PuntoDeRastro } from "@/lib/reportes-choferes/rastro";
import { summarizeTrack, type Fix } from "@/lib/track-history";
import { tramos } from "@/lib/tramos-del-recorrido";

/**
 * La línea del día sacada del rastreador del camión (D-909): qué fuente se dibuja, cuánto se adelgaza la línea sin
 * mentir, y cómo llega hasta la marca en vivo. Todo puro: ni red ni reloj.
 */

const T0 = Date.parse("2026-11-06T14:00:00Z");
/** Un camión como el de verdad: un punto cada 10 s. `paso` en grados de longitud (0.0015 ≈ 150 m ≈ 33 mph). */
function recta(n: number, desde = { lat: 26.2, lng: -98.2 }, paso = 0.0015, t0 = T0): PuntoDeRastro[] {
  return Array.from({ length: n }, (_, i) => ({ t: t0 + i * 10_000, lat: desde.lat, lng: desde.lng + i * paso }));
}
const fix = (lat: number, lng: number, min: number): Fix => ({ lat, lng, at: new Date(T0 + min * 60_000).toISOString(), accuracy_m: null });

describe("simplificaRastro", () => {
  it("una recta de 10 minutos: se queda el principio, el final y un punto al menos cada 90 s", () => {
    const todos = recta(61);                                   // 10 minutos, ~9 km
    const linea = simplificaRastro(todos);
    expect(linea[0]).toEqual(todos[0]);
    expect(linea[linea.length - 1]).toEqual(todos[60]);
    expect(linea.length).toBeLessThan(12);
    for (let i = 1; i < linea.length; i++) expect(linea[i].t - linea[i - 1].t).toBeLessThanOrEqual(SILENCIO_MAX_S * 1000);
  });

  it("una esquina no se corta: la línea no se aparta del rastro más que la tolerancia", () => {
    const ida = recta(30);
    const esquina = ida[29];
    const vuelta = Array.from({ length: 30 }, (_, i) => ({ t: esquina.t + (i + 1) * 10_000, lat: esquina.lat + (i + 1) * 0.0013, lng: esquina.lng }));
    const todos = [...ida, ...vuelta];
    const linea = simplificaRastro(todos);
    expect(linea.some((p) => p.t === esquina.t)).toBe(true);
    // Cada punto que se quitó queda a menos de la tolerancia del tramo de línea que lo cubre.
    for (const p of todos) {
      const i = linea.findIndex((q) => q.t >= p.t);
      const a = linea[Math.max(0, i - 1)], b = linea[i];
      const cerca = Math.min(metros(p, a), metros(p, b), distanciaAlTramo(p, a, b));
      expect(cerca).toBeLessThanOrEqual(TOLERANCIA_M + 1);
    }
  });

  it("el temblor del GPS con el camión parado media hora no deja cientos de puntos", () => {
    const parado: PuntoDeRastro[] = Array.from({ length: 180 }, (_, i) => ({ t: T0 + i * 10_000, lat: 26.2 + (i % 2) * 0.00002, lng: -98.2 + (i % 3) * 0.00002 }));
    expect(simplificaRastro(parado).length).toBeLessThanOrEqual(22);   // ~uno cada 90 s
  });

  it("con dos puntos o menos no hay nada que quitar", () => {
    expect(simplificaRastro([])).toEqual([]);
    expect(simplificaRastro(recta(2))).toHaveLength(2);
  });

  it("la línea adelgazada NO inventa huecos punteados ni pierde millas (D-835 sigue leyendo bien)", () => {
    const todos = recta(361);                                  // una hora seguida por carretera, ~54 km
    const r = rastroParaElMapa(todos)!;
    const fixes = fixesDeLaLinea(r.line);
    expect(fixes.length).toBeLessThan(todos.length / 4);
    const trazos = tramos(fixes);
    expect(trazos).toHaveLength(1);
    expect(trazos[0].hueco).toBe(false);
    const resumen = summarizeTrack(fixes, { silencioQuietoEsParada: true });
    expect(Math.abs(resumen.miles - r.miles)).toBeLessThan(0.2);
    expect(resumen.gaps).toBe(0);
  });
});

function distanciaAlTramo(p: PuntoDeRastro, a: PuntoDeRastro, b: PuntoDeRastro): number {
  let mejor = Infinity;
  for (let k = 0; k <= 50; k++) mejor = Math.min(mejor, metros(p, { lat: a.lat + ((b.lat - a.lat) * k) / 50, lng: a.lng + ((b.lng - a.lng) * k) / 50 }));
  return mejor;
}

describe("rastroParaElMapa", () => {
  it("cuenta TODOS los puntos y mide las millas con todos, aunque mande una línea más corta", () => {
    const todos = recta(361);
    const r = rastroParaElMapa(todos)!;
    expect(r.points).toBe(361);
    expect(r.miles).toBeCloseTo(millasDeLosPuntos(todos), 1);
    expect(r.miles).toBeGreaterThan(33);
    expect(r.line.length).toBeLessThan(361);
    expect(r.line[0]).toEqual([T0 / 1000, 26.2, -98.2]);
    expect(r.line[r.line.length - 1][0]).toBe((T0 + 3_600_000) / 1000);
  });

  it("un rastro que no sirve (pocos puntos, o menos de media hora) es null: se queda el teléfono", () => {
    expect(rastroParaElMapa([])).toBeNull();
    expect(rastroParaElMapa(recta(10))).toBeNull();
    expect(rastroParaElMapa(recta(100))).toBeNull();            // 100 puntos pero 16 minutos
  });

  it("un salto imposible (una antena) no entra en la línea", () => {
    const todos = recta(361);
    todos[100] = { ...todos[100], lat: 29.4 };                  // San Antonio en 10 segundos
    const r = rastroParaElMapa(todos)!;
    expect(r.line.every((p) => p[1] < 27)).toBe(true);
  });
});

describe("eligeRecorrido: camión o teléfono, nunca los dos", () => {
  const telefono = [fix(26.2, -98.2, 0), fix(26.21, -98.2, 5), fix(26.22, -98.2, 10)];
  const camion = [fix(26.2, -98.2, 0), fix(26.3, -98.1, 60), fix(26.2, -98.0, 300)];

  it("con rastro del camión, la línea es la del camión", () => {
    expect(eligeRecorrido(telefono, camion)).toEqual({ fuente: "camion", fixes: camion });
  });
  it("sin rastreador (Máximo): el teléfono, como siempre", () => {
    expect(eligeRecorrido(telefono, undefined)).toEqual({ fuente: "telefono", fixes: telefono });
    expect(eligeRecorrido(telefono, null).fuente).toBe("telefono");
  });
  it("si el rastro del camión no llegó o no trae línea: el teléfono", () => {
    expect(eligeRecorrido(telefono, []).fuente).toBe("telefono");
    expect(eligeRecorrido(telefono, [camion[0]]).fuente).toBe("telefono");
  });
  it("sin nada de nada: teléfono vacío, y no truena", () => {
    expect(eligeRecorrido(undefined, undefined)).toEqual({ fuente: "telefono", fixes: [] });
  });
});

describe("colaConLoVivo: la línea llega hasta la marca", () => {
  const rastro = [fix(26.2, -98.2, 0), fix(26.3, -98.1, 60)];
  const vivo = (min: number, lat = 26.31) => ({ lat, lng: -98.09, posicionEn: new Date(T0 + min * 60_000).toISOString() });

  it("una posición en vivo más nueva que el rastro se cuelga al final", () => {
    const cola = colaConLoVivo([], rastro, vivo(62));
    expect(cola).toEqual([fix(26.31, -98.09, 62)]);
  });
  it("una posición que el rastro ya tiene (o más vieja) no se cuelga, y devuelve la MISMA lista", () => {
    const vacia: Fix[] = [];
    expect(colaConLoVivo(vacia, rastro, vivo(60))).toBe(vacia);
    expect(colaConLoVivo(vacia, rastro, vivo(30))).toBe(vacia);
    expect(colaConLoVivo(vacia, rastro, null)).toBe(vacia);
    expect(colaConLoVivo(vacia, rastro, { lat: null, lng: null, posicionEn: null })).toBe(vacia);
  });
  it("la misma posición dos veces no se repite", () => {
    const una = colaConLoVivo([], rastro, vivo(62));
    expect(colaConLoVivo(una, rastro, vivo(62))).toBe(una);
    expect(colaConLoVivo(una, rastro, vivo(63, 26.32))).toHaveLength(2);
  });
  it("cuando llega un rastro más nuevo, la cola suelta lo que el rastro ya alcanzó", () => {
    const cola = [fix(26.31, -98.09, 62), fix(26.32, -98.08, 63), fix(26.33, -98.07, 64)];
    const nuevo = [...rastro, fix(26.325, -98.075, 63.5)];
    expect(colaConLoVivo(cola, nuevo, null)).toEqual([cola[2]]);
  });
  it("sin rastro todavía, la posición en vivo vale igual", () => {
    expect(colaConLoVivo([], [], vivo(1))).toHaveLength(1);
  });
});

describe("lo que llega por la red se valida antes de dibujarlo", () => {
  it("fixesDeLaLinea: solo ternas de números con sentido", () => {
    expect(fixesDeLaLinea([[T0 / 1000, 26.2, -98.2], ["x", 1, 2], [1, 2], null, [T0 / 1000, 99, -98], [T0 / 1000, 26.2, Infinity]])).toEqual([fix(26.2, -98.2, 0)]);
    expect(fixesDeLaLinea("<img onerror=alert(1)>")).toEqual([]);
    expect(fixesDeLaLinea(undefined)).toEqual([]);
  });
  it("rastrosDeLaRespuesta: sin chofer, sin camión o sin línea, fuera; el nombre del camión se queda como TEXTO", () => {
    const linea = [[T0 / 1000, 26.2, -98.2], [T0 / 1000 + 60, 26.21, -98.2]];
    const r = rastrosDeLaRespuesta({ trails: [
      { driverId: "d1", imei: "863240070017882", truck: "<b>MCALLEN</b>", points: 959, miles: 99.2, line: linea },
      { driverId: "d2", imei: "863240070018328", truck: "", line: linea },
      { imei: "1", line: linea }, { driverId: "d3", imei: "2", line: [linea[0]] }, null,
    ] });
    expect(r.map((x) => x.driverId)).toEqual(["d1", "d2"]);
    expect(r[0]).toMatchObject({ camion: "<b>MCALLEN</b>", puntos: 959, millas: 99.2 });
    expect(r[1]).toMatchObject({ camion: "863240070018328", puntos: 2, millas: 0 });
    expect(rastrosDeLaRespuesta({})).toEqual([]);
    expect(rastrosDeLaRespuesta(null)).toEqual([]);
  });
});

describe("la cabecera dice qué cuenta", () => {
  const es = (_en: string, e: string) => e;
  it("camiones y teléfonos, cada uno con su nombre", () => {
    expect(textoDelConteo(2029, 1054, es)).toBe("2029 puntos del GPS del camión · 1054 posiciones del teléfono");
    expect(textoDelConteo(959, 0, es)).toBe("959 puntos del GPS del camión");
    expect(textoDelConteo(0, 1054, es)).toBe("1054 posiciones del teléfono");
    expect(textoDelConteo(0, 0, es)).toBe("0 posiciones del teléfono");
    expect(textoDelConteo(1, 2, (en) => en)).toBe("1 truck GPS points · 2 phone fixes");
  });
});

describe("summarizeTrack con el rastro de un camión", () => {
  // Maneja 10 min, apaga el motor 2 horas (silencio), y arranca a 40 m de donde paró.
  const ida = Array.from({ length: 11 }, (_, i) => fix(26.2, -98.2 + i * 0.008, i));
  const fin = ida[10];
  const despues = Array.from({ length: 6 }, (_, i) => fix(fin.lat + 0.00036 + i * 0.008, fin.lng, 130 + i));
  const dia = [...ida, ...despues];

  it("el silencio con el camión en el mismo sitio ES una parada, no «sin determinar»", () => {
    const r = summarizeTrack(dia, { silencioQuietoEsParada: true });
    expect(r.unknownMinutes).toBe(0);
    expect(r.gaps).toBe(0);
    expect(r.stoppedMinutes).toBe(120);
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0].minutes).toBe(120);
    expect(r.sparse).toBe(false);
  });
  it("con el teléfono (sin la opción) sigue siendo lo de siempre: no se sabe", () => {
    const r = summarizeTrack(dia);
    expect(r.unknownMinutes).toBe(120);
    expect(r.gaps).toBe(1);
    expect(r.stops).toHaveLength(0);
  });
  it("un silencio que acaba LEJOS no es una parada ni con camión: sigue sin determinar", () => {
    const lejos = [...ida, fix(26.4, -98.0, 130), fix(26.41, -98.0, 131)];
    const r = summarizeTrack(lejos, { silencioQuietoEsParada: true });
    expect(r.gaps).toBe(1);
    expect(r.unknownMinutes).toBe(120);
  });
});
