import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entryMinutes, type PayEntry } from "@/lib/clockin/payroll";
import { turnosPorDia } from "@/lib/clockin/turnos-por-dia";

const fichaje = (id: string, desde: string, hasta: string | null, extra: Partial<PayEntry> = {}): PayEntry => ({
  id, employee_id: "e1", clock_in_at: desde, clock_out_at: hasta, lunch_minutes: null, ...extra,
});

describe("turnosPorDia · el día es el de Texas", () => {
  it("dos fichajes del mismo día en Texas son un solo día, y sus minutos suman", () => {
    // 24 de noviembre, hora de Texas (CST, UTC-6): 8:00-10:00 y 12:00-16:00.
    const a = fichaje("a", "2026-11-24T14:00:00Z", "2026-11-24T16:00:00Z");
    const b = fichaje("b", "2026-11-24T18:00:00Z", "2026-11-24T22:00:00Z");
    const dias = turnosPorDia([a, b]);
    expect(dias).toHaveLength(1);
    expect(dias[0].dia).toBe("2026-11-24");
    expect(dias[0].entradas.map((e) => e.id)).toEqual(["a", "b"]);
    expect(dias[0].minutos).toBe(entryMinutes(a) + entryMinutes(b));
    expect(dias[0].minutos).toBe(360);
    expect(dias[0].primeraEntrada).toBe("2026-11-24T14:00:00Z");
    expect(dias[0].ultimaSalida).toBe("2026-11-24T22:00:00Z");
  });

  it("un turno que cruza la medianoche pertenece al día en que empezó", () => {
    // Entra 11:30 pm del 24 (CST) y sale 1:00 am del 25: 90 minutos, día 24.
    const n = fichaje("n", "2026-11-25T05:30:00Z", "2026-11-25T07:00:00Z");
    const dias = turnosPorDia([n]);
    expect(dias).toHaveLength(1);
    expect(dias[0].dia).toBe("2026-11-24");
    expect(dias[0].minutos).toBe(90);
  });

  it("una entrada a las 8:30 pm de Texas del 24 cae el 24, no el 25 (UTC)", () => {
    const n = fichaje("n", "2026-11-25T02:30:00Z", "2026-11-25T04:00:00Z");
    const dias = turnosPorDia([n]);
    expect(dias[0].dia).toBe("2026-11-24");
  });

  it("los días salen en orden ascendente, y cada fichaje queda en su día", () => {
    const dias = turnosPorDia([
      fichaje("c", "2026-11-26T14:00:00Z", "2026-11-26T22:00:00Z"),
      fichaje("a", "2026-11-24T14:00:00Z", "2026-11-24T22:00:00Z"),
      fichaje("b", "2026-11-24T23:00:00Z", "2026-11-25T01:00:00Z"),
    ]);
    expect(dias.map((d) => d.dia)).toEqual(["2026-11-24", "2026-11-26"]);
    expect(dias[0].entradas.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("turnosPorDia · abierta, salida y totales", () => {
  it("un fichaje abierto marca el día como abierto y no mueve la última salida", () => {
    const cerrada = fichaje("c", "2026-11-24T14:00:00Z", "2026-11-24T16:00:00Z");
    const abierta = fichaje("o", "2026-11-24T17:00:00Z", null);
    const [dia] = turnosPorDia([cerrada, abierta]);
    expect(dia.abierta).toBe(true);
    expect(dia.ultimaSalida).toBe("2026-11-24T16:00:00Z");
    expect(dia.minutos).toBe(120);
  });

  it("si todos están abiertos, la última salida es null", () => {
    const [dia] = turnosPorDia([fichaje("o", "2026-11-24T17:00:00Z", null)]);
    expect(dia.abierta).toBe(true);
    expect(dia.ultimaSalida).toBeNull();
  });

  it("la suma de minutos de todos los días es la suma de entryMinutes de todos los fichajes", () => {
    const entradas: PayEntry[] = [
      fichaje("1", "2026-11-24T14:00:00Z", "2026-11-24T22:00:00Z", { lunch_minutes: 30 }),
      fichaje("2", "2026-11-24T23:00:00Z", "2026-11-25T01:00:00Z"),
      fichaje("3", "2026-11-25T14:00:00Z", "2026-11-25T18:15:00Z", { punched_lunch_min: 45 }),
      fichaje("4", "2026-11-26T15:00:00Z", null),
      fichaje("5", "2026-11-26T20:00:00Z", "2026-11-26T21:00:00Z"),
    ];
    const totalDias = turnosPorDia(entradas).reduce((s, d) => s + d.minutos, 0);
    const totalFichajes = entradas.reduce((s, e) => s + entryMinutes(e), 0);
    expect(totalDias).toBe(totalFichajes);
  });

  it("no paga el hueco entre dos fichajes del mismo día", () => {
    // 8-10 y 13-17 en Texas: 2 + 4 horas trabajadas, no 9 de primera a última.
    const dias = turnosPorDia([
      fichaje("a", "2026-11-24T14:00:00Z", "2026-11-24T16:00:00Z"),
      fichaje("b", "2026-11-24T19:00:00Z", "2026-11-24T23:00:00Z"),
    ]);
    expect(dias[0].minutos).toBe(360);
  });
});

describe("turnosPorDia · manual y notas", () => {
  it("manual si algún fichaje del día lo es", () => {
    const [dia] = turnosPorDia([
      fichaje("a", "2026-11-24T14:00:00Z", "2026-11-24T16:00:00Z"),
      fichaje("b", "2026-11-24T18:00:00Z", "2026-11-24T19:00:00Z", { manual: true }),
    ]);
    expect(dia.manual).toBe(true);
  });

  it("no manual si ninguno lo es", () => {
    const [dia] = turnosPorDia([fichaje("a", "2026-11-24T14:00:00Z", "2026-11-24T16:00:00Z", { manual: false })]);
    expect(dia.manual).toBe(false);
  });

  it("las notas: sin vacías, sin repetir, en orden", () => {
    const [dia] = turnosPorDia([
      fichaje("a", "2026-11-24T14:00:00Z", "2026-11-24T16:00:00Z", { edit_note: "Olvidó fichar" }),
      fichaje("b", "2026-11-24T17:00:00Z", "2026-11-24T18:00:00Z", { edit_note: "   " }),
      fichaje("c", "2026-11-24T19:00:00Z", "2026-11-24T20:00:00Z", { edit_note: "Corregido" }),
      fichaje("d", "2026-11-24T21:00:00Z", "2026-11-24T22:00:00Z", { edit_note: "Olvidó fichar" }),
      fichaje("e", "2026-11-24T22:30:00Z", "2026-11-24T23:00:00Z", { edit_note: null }),
    ]);
    expect(dia.notas).toEqual(["Olvidó fichar", "Corregido"]);
  });
});

describe("las pantallas", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
  const ts = leer("src/components/timetracker/PayrollTimesheets.tsx");

  it("Nómina agrupa los fichajes por día con turnosPorDia", () => {
    expect(ts).toContain('import { turnosPorDia } from "@/lib/clockin/turnos-por-dia";');
    expect(ts).toContain("filas={turnosPorDia(suyas)}");
    expect(ts).toContain("claveDe={(g) => g.dia}");
  });

  it("cada fichaje conserva su bitácora, Editar y Borrar", () => {
    expect(ts).toContain("<BitacoraDelDia entryId={e.id} />");
    expect(ts).toContain("onClick={() => empiezaEdicion(e)}>Edit</button>");
    expect(ts).toContain('if (confirm("Delete this entry?")) void corre(() => deleteEntry(e.id));');
  });

  it("el día con varios fichajes muestra su cuenta", () => {
    expect(ts).toContain("data-fichajes-del-dia={g.entradas.length}");
    expect(ts).toContain("data-fichajes-de={g.dia}");
  });
});
