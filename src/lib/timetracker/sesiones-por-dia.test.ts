import { describe, expect, it } from "vitest";
import { sesionesPorDia } from "./sesiones-por-dia";
import type { Session } from "@/lib/timetracker/types";

// Sesión mínima: solo lo que la agrupación mira.
function sesion(p: Partial<Session> & { id: string }): Session {
  return {
    employeeUid: "e1", date: null, startMs: null, endMs: null, durationSeconds: 0,
    ...p,
  } as Session;
}

// Hora de Texas (CST, UTC-6 en noviembre de 2026, ya fuera del horario de verano) → instante UTC.
const enTexas = (iso: string) => Date.parse(iso);

describe("sesionesPorDia", () => {
  it("dos sesiones el mismo día dan un solo día, y su duración es la suma", () => {
    const dias = sesionesPorDia([
      sesion({ id: "a", date: "2026-11-24", startMs: enTexas("2026-11-24T14:00:00Z"), endMs: enTexas("2026-11-24T15:00:00Z"), durationSeconds: 3600 }),
      sesion({ id: "b", date: "2026-11-24", startMs: enTexas("2026-11-24T17:00:00Z"), endMs: enTexas("2026-11-24T17:30:00Z"), durationSeconds: 1800 }),
    ]);
    expect(dias).toHaveLength(1);
    expect(dias[0].dia).toBe("2026-11-24");
    expect(dias[0].sesiones.map((s) => s.id)).toEqual(["a", "b"]);
    expect(dias[0].segundos).toBe(5400);
    expect(dias[0].primerInicio).toBe(enTexas("2026-11-24T14:00:00Z"));
    expect(dias[0].ultimoFin).toBe(enTexas("2026-11-24T17:30:00Z"));
  });

  it("una sesión a las 11:30 pm de Texas pertenece al día en que empezó (sin campo date)", () => {
    // 2026-11-24 23:30 hora de Texas = 2026-11-25 05:30 UTC.
    const dias = sesionesPorDia([
      sesion({ id: "n", startMs: enTexas("2026-11-25T05:30:00Z"), endMs: enTexas("2026-11-25T06:10:00Z"), durationSeconds: 2400 }),
    ]);
    expect(dias.map((d) => d.dia)).toEqual(["2026-11-24"]);
  });

  it("sin campo date usa el día de Texas de startMs", () => {
    const dias = sesionesPorDia([
      sesion({ id: "x", startMs: enTexas("2026-11-20T15:00:00Z"), endMs: enTexas("2026-11-20T16:00:00Z"), durationSeconds: 3600 }),
      sesion({ id: "y", startMs: enTexas("2026-11-21T15:00:00Z"), endMs: enTexas("2026-11-21T15:30:00Z"), durationSeconds: 1800 }),
    ]);
    expect(dias.map((d) => d.dia)).toEqual(["2026-11-20", "2026-11-21"]);
  });

  it("una sesión abierta (sin fin) no rompe ultimoFin y no cuenta como fin", () => {
    const dias = sesionesPorDia([
      sesion({ id: "cerrada", date: "2026-11-24", startMs: enTexas("2026-11-24T14:00:00Z"), endMs: enTexas("2026-11-24T15:00:00Z"), durationSeconds: 3600 }),
      sesion({ id: "viva", date: "2026-11-24", startMs: enTexas("2026-11-24T18:00:00Z"), endMs: null, durationSeconds: 600 }),
    ]);
    expect(dias[0].ultimoFin).toBe(enTexas("2026-11-24T15:00:00Z"));
    expect(dias[0].segundos).toBe(4200);
  });

  it("si todas las sesiones del día están abiertas, ultimoFin es null", () => {
    const dias = sesionesPorDia([
      sesion({ id: "viva", date: "2026-11-24", startMs: enTexas("2026-11-24T18:00:00Z"), endMs: null, durationSeconds: 600 }),
    ]);
    expect(dias[0].ultimoFin).toBeNull();
  });

  it("dentro del día las sesiones van por inicio, aunque lleguen desordenadas", () => {
    const dias = sesionesPorDia([
      sesion({ id: "tarde", date: "2026-11-24", startMs: enTexas("2026-11-24T20:00:00Z"), durationSeconds: 1 }),
      sesion({ id: "temprano", date: "2026-11-24", startMs: enTexas("2026-11-24T14:00:00Z"), durationSeconds: 1 }),
    ]);
    expect(dias[0].sesiones.map((s) => s.id)).toEqual(["temprano", "tarde"]);
  });

  it("los días salen en orden ascendente", () => {
    const dias = sesionesPorDia([
      sesion({ id: "b", date: "2026-11-25", startMs: 2, durationSeconds: 1 }),
      sesion({ id: "a", date: "2026-11-23", startMs: 1, durationSeconds: 1 }),
    ]);
    expect(dias.map((d) => d.dia)).toEqual(["2026-11-23", "2026-11-25"]);
  });

  it("la suma de los días es la suma de las sesiones", () => {
    const sesiones = [
      sesion({ id: "1", date: "2026-11-23", startMs: 1, endMs: 2, durationSeconds: 1234 }),
      sesion({ id: "2", date: "2026-11-23", startMs: 3, endMs: null, durationSeconds: 99 }),
      sesion({ id: "3", date: "2026-11-24", startMs: 4, endMs: 5, durationSeconds: 3000 }),
      sesion({ id: "4", startMs: enTexas("2026-11-25T15:00:00Z"), endMs: enTexas("2026-11-25T16:00:00Z"), durationSeconds: 77 }),
    ];
    const totalDias = sesionesPorDia(sesiones).reduce((n, d) => n + d.segundos, 0);
    const totalSesiones = sesiones.reduce((n, s) => n + s.durationSeconds, 0);
    expect(totalDias).toBe(totalSesiones);
  });

  it("sin sesiones, no hay días", () => {
    expect(sesionesPorDia([])).toEqual([]);
  });
});
