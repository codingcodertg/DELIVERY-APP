import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La hora de la base en el Gestor (D-647). El dueño, con la fila «Base: regreso» sin hora: «its missing the eta to the base
 * as well». La salida y la vuelta van en la columna «Llegada», de la misma medida que pone la hora de cada parada.
 */
const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n");
const medida = readFileSync(join(process.cwd(), "src/lib/usa-medida-de-rutas.ts"), "utf8").split("\r\n").join("\n");
const fila = pagina.slice(pagina.indexOf("const filaDeLaBase = "), pagina.indexOf("/** La clave de una fila de la lista"));

describe("la hora de la base", () => {
  it("la medida da la salida y la llegada a la base, con el tramo vacío de vuelta", () => {
    // D-691: el reloj vive en `relojDeLaRuta`.
    // **Puesto al día por D-906 (2026-11-06)**: un tramo que falta ya no vale 0 (`?? 0`): la vuelta se suma solo si se sabe,
    // y una hora que no se pudo calcular va vacía (la fila de la base no la pinta) en vez de una hora falsa.
    const reloj = readFileSync(join(process.cwd(), "src/lib/salida-de-la-medida.ts"), "utf8").replace(/\s+/g, " ");
    expect(reloj).toContain("if (e.vuelve && clock != null) { const vuelta = viaje(desde, n); clock = vuelta == null ? null : clock + vuelta; }");
    expect(reloj).not.toContain("?? 0) / 60");
    expect(medida).toContain('start: salida == null ? "" : fmtReloj(salida), end: clock == null ? "" : fmtReloj(clock),');
  });

  it("la fila de la base pone la salida (start) y, si el chofer vuelve, la llegada (end), en la columna «Llegada»", () => {
    expect(fila).toContain('const i = colsParadas.findIndex((c) => c.key === "p_eta");');
    expect(fila).toContain('const hora = !stat ? null : cual === "salida" ? stat.start : vuelve ? stat.end : null;');
    expect(fila).toContain("const vuelve = !!tiendaBaseDe(laneKey) && !!tiendaFinDe(laneKey);");
    expect(fila).toContain("data-hora-de-la-base={cual}");
    expect(pagina).toContain("const { finDeLaRuta, routeInfo, routeStats,");
  });

  it("sin hora o sin columna «Llegada», la dirección ocupa la fila entera como antes", () => {
    expect(fila).toContain("if (i < 0 || !hora) return <td colSpan={colsParadas.length}");
  });
});
