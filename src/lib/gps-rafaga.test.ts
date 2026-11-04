import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MAX_ACCURACY_M, shouldSend } from "./location-filter";

/**
 * D-835: el recorrido de Ernesto (2026-11-04) con huecos de 20 minutos unidos con líneas rectas. Android entrega a la app
 * en segundo plano sus posiciones DE GOLPE al despertar, y la app tiraba todas menos una: medía «cada 5 s» con el reloj
 * de la llamada y descartaba lo que llegaba mientras enviaba otra. Y el primer punto era de antes del turno (93 m).
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("una ráfaga de posiciones atrasadas se escribe entera", () => {
  it("medido con la hora del teléfono, 20 minutos de puntos cada 15 s pasan todos el filtro", () => {
    let last: { lat: number; lng: number; at: number } | null = null; let pasan = 0;
    const t0 = Date.parse("2026-11-04T14:31:00Z");
    for (let k = 0; k < 80; k++) {
      const fix = { lat: 26.2 + k * 0.001, lng: -98.2, accuracy: 5 }, at = t0 + k * 15_000;
      if (shouldSend(fix, last, at)) { pasan++; last = { ...fix, at }; }
    }
    expect(pasan).toBe(80);
  });
  it("el hook usa la hora del punto, encola lo que llega durante un envío, y descarta lo de antes de empezar", () => {
    const h = leer("src/lib/useLiveLocation.ts");
    expect(h).toContain('const at = Date.parse(fix.recorded_at ?? "") || Date.now();');
    expect(h).toContain("if (at < startedAt - 60_000) return;");
    expect(h).toContain("pendingRef.current.push(fix);");
    // Lo que había: con un envío en curso, la posición se tiraba.
    expect(h).not.toContain("if (inFlightRef.current) return;\n      // G-22 (D-200): `lastRef` used to advance BEFORE");
  });
  it("una posición de 93 m ya no entra; una de 30 m sí", () => {
    expect(MAX_ACCURACY_M).toBe(65);
    expect(shouldSend({ lat: 26.2, lng: -98.2, accuracy: 93 }, null, 0)).toBe(false);
    expect(shouldSend({ lat: 26.2, lng: -98.2, accuracy: 30 }, null, 0)).toBe(true);
  });
});

describe("el mapa del recorrido", () => {
  it("quita el salto imposible quedándose con el punto más preciso, y pinta punteado lo que no se sabe", async () => {
    const { limpiaSaltos, tramos } = await import("./tramos-del-recorrido");
    const f = (min: number, lat: number, lng: number, acc: number) => ({ lat, lng, accuracy_m: acc, at: new Date(Date.parse("2026-11-04T14:29:00Z") + min * 60_000).toISOString() });
    // El día de Ernesto: un punto viejo a 3.7 mi (93 m), luego la ruta, un hueco de 20 min y 2 mi, y sigue.
    const dia = [f(0, 26.249, -98.262, 93), f(0.55, 26.209, -98.21, 14), f(1.4, 26.2091, -98.2101, 4), f(21.5, 26.18, -98.18, 4), f(22.5, 26.1801, -98.1801, 5)];
    const limpias = limpiaSaltos(dia);
    expect(limpias.length).toBe(4);
    expect(limpias[0].accuracy_m).toBe(14);
    const t = tramos(dia);
    expect(t.map((x) => x.hueco)).toEqual([false, true, false]);
  });
});
