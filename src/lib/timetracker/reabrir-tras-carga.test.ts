import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decisionReabrir, parseResumeMark, markCovers, esHuerfana, ultimoLatidoDe,
  CRON_CLOSE_NOTE, PAGE_ORPHAN_CLOSE_NOTE, RESUME_MAX_MS, LATIDO_MAX_MS,
} from "./live-session";

// El incidente: el dueño perdió cuatro horas. Crash → «Reload app» → al cargar, la fila se veía
// huérfana y se cerraba en su último latido. D-241 decía que un cierre de pantalla se puede
// deshacer, pero la condición de evidencia exigía `runningRef` y `tickRef` — cosas que **acaban
// de reiniciarse**. La reapertura tras recargar era imposible por construcción.

const AHORA = 1_700_000_000_000;
const fila = (liveNote: string | null, isLive = false) =>
  ({ id: "s1", employeeUid: "u1", isLive, liveNote });

// La secuencia real, con las horas del incidente: último latido, marca escrita por ese latido,
// crash, recarga unos minutos después.
const marcaDelUltimoLatido = (haceMs: number) =>
  parseResumeMark(JSON.stringify({ sessionId: "s1", at: AHORA - haceMs }), AHORA);

describe("latido → marca → reload → carga", () => {
  it("se reabre: la marca es la evidencia cuando no puede haber tick", () => {
    const mark = marcaDelUltimoLatido(3 * 60_000);
    expect(mark).not.toBeNull();
    const d = decisionReabrir({
      fila: fila(PAGE_ORPHAN_CLOSE_NOTE), me: "u1", mark,
      evidenciaLocal: false, otrasVivas: [], contexto: "tras-carga",
    });
    expect(d).toEqual({ reabrir: true });
  });

  it("y ese MISMO caso no se reabría antes, que es el fallo que costó cuatro horas", () => {
    // El control histórico: con el contexto de D-197 —el de siempre— y sin tick, se niega.
    const d = decisionReabrir({
      fila: fila(PAGE_ORPHAN_CLOSE_NOTE), me: "u1", mark: marcaDelUltimoLatido(3 * 60_000),
      evidenciaLocal: false, otrasVivas: [], contexto: "sin-red",
    });
    expect(d).toEqual({ reabrir: false, motivo: "sin-evidencia-local" });
  });

  it("el caso sin red sigue exigiendo el tick: D-197 no se relaja", () => {
    const conTick = decisionReabrir({
      fila: fila(CRON_CLOSE_NOTE), me: "u1", mark: marcaDelUltimoLatido(60_000),
      evidenciaLocal: true, otrasVivas: [], contexto: "sin-red",
    });
    expect(conTick).toEqual({ reabrir: true });
  });

  it("y sin contexto se comporta como siempre, que es la dirección segura", () => {
    const d = decisionReabrir({
      fila: fila(PAGE_ORPHAN_CLOSE_NOTE), me: "u1", mark: marcaDelUltimoLatido(60_000),
      evidenciaLocal: false, otrasVivas: [],
    });
    expect(d).toEqual({ reabrir: false, motivo: "sin-evidencia-local" });
  });
});

describe("lo que la marca sigue sin permitir tras una carga", () => {
  const conMarca = (extra: Record<string, unknown>) => decisionReabrir({
    fila: fila(PAGE_ORPHAN_CLOSE_NOTE), me: "u1", mark: marcaDelUltimoLatido(60_000),
    evidenciaLocal: false, otrasVivas: [], contexto: "tras-carga", ...extra,
  });

  it("una máquina que estuvo apagada de verdad: la marca ya no vale", () => {
    // `parseResumeMark` la descarta pasados los mismos 15 min del freno, así que una noche
    // apagada no deja marca fresca y no hay nada que reabrir. Es lo que impide pagar la noche.
    expect(marcaDelUltimoLatido(RESUME_MAX_MS + 60_000)).toBeNull();
    expect(conMarca({ mark: null })).toEqual({ reabrir: false, motivo: "sin-marca" });
    expect(RESUME_MAX_MS).toBe(LATIDO_MAX_MS);
  });

  it("una marca de OTRA sesión", () => {
    const otra = parseResumeMark(JSON.stringify({ sessionId: "s9", at: AHORA - 60_000 }), AHORA);
    expect(markCovers(otra, "s1")).toBe(false);
    expect(conMarca({ mark: otra })).toEqual({ reabrir: false, motivo: "sin-marca" });
  });

  it("un Stop, que escribe null", () => {
    expect(conMarca({ fila: fila(null) })).toEqual({ reabrir: false, motivo: "la-cerro-una-persona" });
  });

  it("una fila de otra persona, o que sigue viva, o con otra viva al lado", () => {
    expect(conMarca({ me: "u2" })).toEqual({ reabrir: false, motivo: "no-es-mia" });
    expect(conMarca({ fila: fila(PAGE_ORPHAN_CLOSE_NOTE, true) })).toEqual({ reabrir: false, motivo: "sigue-viva" });
    expect(conMarca({ otrasVivas: ["s2"] })).toEqual({ reabrir: false, motivo: "otra-viva" });
  });
});

describe("el tramo sin latidos no se inventa", () => {
  it("la fila sigue siendo huérfana antes de decidir, y su último latido es el ancla", () => {
    const mine = { startMs: AHORA - 3 * 3600_000, endMs: AHORA - 20 * 60_000 };
    expect(esHuerfana(mine, AHORA)).toBe(true);
    expect(ultimoLatidoDe(mine)).toBe(mine.endMs);
  });

  it("y la pantalla corre el arranque hacia delante en vez de contar el hueco", () => {
    // La aritmética que evita pagar un hueco sin evidencia: se adelanta `startMs` lo que duró,
    // así el reloj sigue donde estaba en vez de saltar. Es lo contrario de D-098.
    const src = readFileSync("src/app/timetracker/(timetracker)/page.tsx", "utf8");
    const codigo = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(codigo).toContain("startMsRef.current = (mine.startMs || Date.now()) + hueco;");
    expect(codigo).toMatch(/const hueco = Math\.max\(0, Date\.now\(\) - ultimoLatido\);/);
  });
});

describe("el orden en la carga: decidir antes de borrar la marca", () => {
  const src = readFileSync("src/app/timetracker/(timetracker)/page.tsx", "utf8");
  const codigo = src.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
  const bloque = codigo.slice(codigo.indexOf("if (esHuerfana(mine, Date.now()))"));

  it("la decisión va antes que el borrado, que era el arreglo entero", () => {
    const iDecidir = bloque.indexOf('contexto: "tras-carga"');
    const iBorrar = bloque.indexOf("localStorage.removeItem(LS_RESUME)");
    expect(iDecidir).toBeGreaterThan(-1);
    expect(iBorrar).toBeGreaterThan(-1);
    expect(iDecidir).toBeLessThan(iBorrar);
  });

  it("y la marca se lee antes de decidir", () => {
    const iLeer = bloque.indexOf("parseResumeMark(localStorage.getItem(LS_RESUME)");
    expect(iLeer).toBeGreaterThan(-1);
    expect(iLeer).toBeLessThan(bloque.indexOf('contexto: "tras-carga"'));
  });
});
