import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  UMBRAL_HORA_BAJA_PCT, actividadPorHora, esHoraBaja, horasSinDatosEntre, pctDeMuestra, pctEntero, resumenDelDia,
  type MuestraActividad,
} from "./resumen-dia";

// D-NEXT. Datos inventados: la app de tiempo no tiene modo demo y producción no se toca. Las horas
// se construyen con el constructor LOCAL de Date, así que `getHours()` las devuelve tal cual en
// cualquier zona horaria de la máquina que corra la prueba.
const en = (h: number, m: number) => new Date(2026, 8, 25, h, m).toISOString();
const shot = (h: number, m: number, pct: number): MuestraActividad => ({ takenAt: en(h, m), path: `u/${h}-${m}.jpg`, activityPercent: pct });
const blanco = (h: number, m: number): MuestraActividad => ({ takenAt: en(h, m), path: null, activityPercent: 0 });

describe("el umbral", () => {
  it("es 10 y exactamente 10 no es hora baja", () => {
    expect(UMBRAL_HORA_BAJA_PCT).toBe(10);
    expect(esHoraBaja(10)).toBe(false);
    expect(esHoraBaja(9.99)).toBe(true);
    expect(esHoraBaja(0)).toBe(true);
    expect(esHoraBaja(10.01)).toBe(false);
  });
});

describe("pctDeMuestra y pctEntero", () => {
  it("acota a 0-100 y un valor raro cuenta como 0", () => {
    expect(pctDeMuestra({ activityPercent: 140 })).toBe(100);
    expect(pctDeMuestra({ activityPercent: -5 })).toBe(0);
    expect(pctDeMuestra({ activityPercent: NaN })).toBe(0);
    expect(pctDeMuestra({ activityPercent: 37 })).toBe(37);
  });
  it("lo que se enseña se redondea hacia abajo: 9,6 es «9», no «10»", () => {
    expect(pctEntero(9.6)).toBe(9);
    expect(pctEntero(49.99)).toBe(49);
    expect(pctEntero(10)).toBe(10);
  });
});

describe("actividadPorHora", () => {
  it("agrupa por hora de reloj y promedia las muestras de cada una, en orden", () => {
    // Desordenadas a propósito: una prueba de orden con datos ya ordenados no mide nada.
    const horas = actividadPorHora([shot(9, 5, 40), shot(8, 50, 20), shot(9, 15, 60), shot(8, 40, 0)]);
    expect(horas).toEqual([
      { hora: 8, media: 10, muestras: 2 },
      { hora: 9, media: 50, muestras: 2 },
    ]);
  });
  it("un marcador sin actividad es una muestra al 0 %", () => {
    expect(actividadPorHora([shot(10, 0, 30), blanco(10, 10)])).toEqual([{ hora: 10, media: 15, muestras: 2 }]);
  });
  it("la hora la decide la función que se le pasa, no la zona de la máquina", () => {
    const utc = (ms: number) => new Date(ms).getUTCHours();
    const s: MuestraActividad = { takenAt: "2026-09-25T14:30:00.000Z", path: "x", activityPercent: 5 };
    expect(actividadPorHora([s], utc)[0].hora).toBe(14);
  });
});

describe("horasSinDatosEntre", () => {
  it("solo los huecos entre la primera y la última hora con datos", () => {
    const horas = actividadPorHora([shot(8, 0, 50), shot(12, 0, 50), shot(13, 0, 50)]);
    expect(horasSinDatosEntre(horas)).toEqual([9, 10, 11]);
  });
  it("sin hueco, o con una sola hora, no hay nada", () => {
    expect(horasSinDatosEntre(actividadPorHora([shot(8, 0, 50), shot(9, 0, 50)]))).toEqual([]);
    expect(horasSinDatosEntre(actividadPorHora([shot(8, 0, 50)]))).toEqual([]);
  });
});

describe("resumenDelDia", () => {
  // Un día: 08:40-08:59 parcial (dos muestras, 5 % de media → baja), 09 bien, 10 solo marcadores
  // (baja al 0 %), 11 sin nada (comida), 12 exactamente 10 % (NO baja), 13 con 9,5 % (baja).
  const dia: MuestraActividad[] = [
    shot(8, 40, 0), shot(8, 50, 10),
    shot(9, 0, 80), shot(9, 10, 60), shot(9, 20, 70),
    blanco(10, 0), blanco(10, 10), blanco(10, 20),
    shot(12, 0, 10), shot(12, 10, 10),
    shot(13, 0, 9), shot(13, 10, 10),
  ];
  const r = resumenDelDia(dia, 5 * 3600 + 30 * 60);

  it("cuenta las horas bajas: parcial, solo marcadores y 9,5; no la del 10 exacto", () => {
    expect(r.horasBajas.map((h) => h.hora)).toEqual([8, 10, 13]);
    expect(r.horasBajas.find((h) => h.hora === 13)!.media).toBe(9.5);
  });
  it("la hora sin ningún dato no es baja: es «sin datos»", () => {
    expect(r.horasBajas.some((h) => h.hora === 11)).toBe(false);
    expect(r.horasSinDatos).toEqual([11]);
  });
  it("la media del día es la de todas las muestras, marcadores incluidos, hacia abajo", () => {
    // (0+10+80+60+70+0+0+0+10+10+9+10) / 12 = 259/12 = 21,58…
    expect(r.actividadMediaPct).toBe(21);
  });
  it("capturas son las que tienen imagen; los marcadores aparte", () => {
    expect(r.capturas).toBe(9);
    expect(r.sinActividad).toBe(3);
  });
  it("primera y última actividad son la primera y la última captura real", () => {
    expect(r.primeraMs).toBe(new Date(2026, 8, 25, 8, 40).getTime());
    expect(r.ultimaMs).toBe(new Date(2026, 8, 25, 13, 10).getTime());
  });
  it("las horas trabajadas son las que llegan, sin recalcular", () => {
    expect(r.segundosTrabajados).toBe(19800);
  });
  it("un día sin muestras no inventa nada", () => {
    const vacio = resumenDelDia([], 0);
    expect(vacio.actividadMediaPct).toBeNull();
    expect(vacio.horasBajas).toEqual([]);
    expect(vacio.primeraMs).toBeNull();
    expect(vacio.capturas).toBe(0);
  });
  it("un día con solo marcadores no tiene primera ni última captura, pero sí horas bajas", () => {
    const solo = resumenDelDia([blanco(15, 0), blanco(15, 10)], 1200);
    expect(solo.primeraMs).toBeNull();
    expect(solo.horasBajas.map((h) => h.hora)).toEqual([15]);
    expect(solo.actividadMediaPct).toBe(0);
  });
});

// La prueba se alimenta de quien llama: que la función esté bien no dice que la cabecera la use.
// Este repo no dibuja pantallas en las pruebas, así que se lee el fuente (patrón de D-187/D-194).
describe("la cabecera de Auditoría usa estas funciones", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
  const resumen = leer("src/components/timetracker/DayActivitySummary.tsx");
  const diario = leer("src/components/timetracker/WorkDiary.tsx");
  const equipo = leer("src/components/timetracker/TeamDiary.tsx");

  it("DayActivitySummary calcula con resumenDelDia sobre lo que recibe, y pinta el umbral con nombre", () => {
    expect(resumen).toContain("resumenDelDia(shots, totalSec)");
    expect(resumen).toContain("r.horasBajas.length");
    // La etiqueta de la pastilla, con el umbral por nombre; y ningún `pct:` con un número a mano.
    expect(resumen).toContain('t("mgr.diary.sum.low", { n, pct: UMBRAL_HORA_BAJA_PCT })');
    expect(resumen).not.toMatch(/pct:\s*\d/);
    expect(resumen).toContain("pctEntero(h.media)");
    expect(resumen).not.toMatch(/Math\.(round|floor)\(/);
  });

  it("WorkDiary lo monta pegado al selector de fecha, con los dayShots del día y su total", () => {
    const i = diario.indexOf("<DayActivitySummary");
    const flecha = diario.indexOf("setDate((d) => addDaysISO(d, 1))");
    expect(i, "WorkDiary ya no monta DayActivitySummary").toBeGreaterThan(-1);
    expect(flecha).toBeGreaterThan(-1);
    expect(i, "el resumen tiene que ir a la derecha del selector de fecha").toBeGreaterThan(flecha);
    const tag = diario.slice(i, diario.indexOf("/>", i));
    expect(tag).toContain("shots={dayShots}");
    expect(tag).toContain("totalSec={totalSec}");
    expect(tag).toContain("hourLabel={hourLabel}");
    // key={date}: al cambiar de día se cierra la lista abierta y se recalcula desde cero.
    expect(tag).toContain("key={date}");
  });

  it("se monta cuando se pide `summary`, y entonces el total suelto de la derecha se quita (va dentro)", () => {
    expect(diario).toContain("{summary && <DayActivitySummary");
    expect(diario).toContain("summary = false");
    expect(diario).toContain('{!summary && <div><b>{t("mgr.diary.total")}');
  });

  it("solo Auditoría lo pide: TeamDiary pasa `summary`, el diario del empleado no", () => {
    expect(equipo).toMatch(/<WorkDiary key=\{activeUid\}[^>]*\bsummary\b/);
    expect(leer("src/app/timetracker/(timetracker)/diary/page.tsx")).not.toMatch(/\bsummary\b/);
  });
});
