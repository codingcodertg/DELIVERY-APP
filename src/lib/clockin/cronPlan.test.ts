import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  destinatariosPosibles,
  hayTrabajoEnEstaCorrida,
  parseHM,
  turnoPuedeDisparar,
  ventanaSemanalAbierta,
  type TurnoDeHoy,
} from "./cronPlan";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

const turno = (start: string, end: string, lunch: string | null = null): TurnoDeHoy => ({
  employee_id: "e1",
  start_time: start,
  end_time: end,
  lunch_start_time: lunch,
});

/** Las mismas reglas que dispara la ruta del cron, tal cual (sin la comprobación de fichaje, que es lo que las añade). */
function reglasDeLaRuta(s: number, e: number, l: number | null, nowMin: number): boolean[] {
  return [
    s - nowMin > 28 && s - nowMin <= 31, // shift_reminder
    nowMin >= s && nowMin <= s + 5, // shift_now
    nowMin > s + 6 && nowMin <= e, // not_clocked_in / mgr_late
    e - nowMin > 0 && e - nowMin <= 15, // shift_ending
    l !== null && l - nowMin > 2 && l - nowMin <= 5, // lunch_reminder
    nowMin > e + 30, // forgot_clockout / mgr_forgot_clockout
  ];
}

describe("cronPlan: parseHM", () => {
  it("lee HH:MM y HH:MM:SS", () => {
    expect(parseHM("06:30")).toBe(390);
    expect(parseHM("14:45:00")).toBe(885);
  });
});

describe("cronPlan: turnoPuedeDisparar es un superconjunto de las reglas de la ruta", () => {
  it("nunca da false cuando alguna regla de la ruta dispararía, para cualquier minuto y turno", () => {
    const fallos: string[] = [];
    for (let s = 0; s < 24 * 60; s += 15) {
      for (const dur of [60, 240, 480, 600]) {
        const e = s + dur;
        if (e >= 24 * 60) continue;
        for (const l of [null, s + 150, s + 240]) {
          const t = turno(`${Math.floor(s / 60)}:${s % 60}`, `${Math.floor(e / 60)}:${e % 60}`, l === null ? null : `${Math.floor(l / 60)}:${l % 60}`);
          for (let now = 0; now < 24 * 60; now++) {
            const algunaRegla = reglasDeLaRuta(s, e, l, now).some(Boolean);
            if (algunaRegla && !turnoPuedeDisparar(t, now)) fallos.push(`s=${s} e=${e} l=${l} now=${now}`);
          }
        }
      }
    }
    expect(fallos).toEqual([]);
  });

  it("da false fuera de todas las ventanas (turno 06:00–14:30, a las 5:00 de la mañana: aún lejos del inicio)", () => {
    expect(turnoPuedeDisparar(turno("06:00", "14:30"), 5 * 60)).toBe(false);
  });

  it("da true en la ventana del recordatorio (28–31 min antes) y en el aviso de inicio", () => {
    expect(turnoPuedeDisparar(turno("06:00", "14:30"), 6 * 60 - 30)).toBe(true);
    expect(turnoPuedeDisparar(turno("06:00", "14:30"), 6 * 60 + 2)).toBe(true);
  });
});

describe("cronPlan: ventanas de hora fija (jueves nómina, domingo felicitación)", () => {
  it("jueves 9:00–9:03 y 14:00–14:03; domingo 12:00–12:03; nada más", () => {
    expect(ventanaSemanalAbierta(4, 9 * 60)).toBe(true);
    expect(ventanaSemanalAbierta(4, 9 * 60 + 3)).toBe(true);
    expect(ventanaSemanalAbierta(4, 9 * 60 + 4)).toBe(false);
    expect(ventanaSemanalAbierta(4, 14 * 60 + 2)).toBe(true);
    expect(ventanaSemanalAbierta(0, 12 * 60 + 1)).toBe(true);
    expect(ventanaSemanalAbierta(0, 12 * 60 + 4)).toBe(false);
    expect(ventanaSemanalAbierta(2, 9 * 60)).toBe(false);
  });
});

describe("cronPlan: hayTrabajoEnEstaCorrida", () => {
  const base = { turnos: [] as TurnoDeHoy[], hayTurnoAbierto: false, hayAusencia: false, diaDeLaSemana: 2, nowMin: 10 * 60 };

  it("sin turnos, sin fichajes abiertos, sin ausencias y en hora libre: no hay nada que hacer", () => {
    expect(hayTrabajoEnEstaCorrida(base)).toBe(false);
  });

  it("un fichaje abierto (de cualquier día) o una ausencia obligan a correr: el cierre de las 8 PM y el aviso de regreso", () => {
    expect(hayTrabajoEnEstaCorrida({ ...base, hayTurnoAbierto: true })).toBe(true);
    expect(hayTrabajoEnEstaCorrida({ ...base, hayAusencia: true })).toBe(true);
  });

  it("un turno que puede disparar en este minuto obliga a correr; uno fuera de ventana no", () => {
    expect(hayTrabajoEnEstaCorrida({ ...base, turnos: [turno("10:00", "18:00")] })).toBe(true);
    expect(hayTrabajoEnEstaCorrida({ ...base, turnos: [turno("16:00", "18:00")] })).toBe(false);
  });

  it("la ventana del jueves y la del domingo obligan a correr aunque no haya nada más", () => {
    expect(hayTrabajoEnEstaCorrida({ ...base, diaDeLaSemana: 4, nowMin: 9 * 60 + 1 })).toBe(true);
    expect(hayTrabajoEnEstaCorrida({ ...base, diaDeLaSemana: 0, nowMin: 12 * 60 + 1 })).toBe(true);
  });
});

describe("cronPlan: destinatariosPosibles", () => {
  it("fuera de la ventana semanal: turnos de hoy, abiertos, ausentes y managers, sin duplicados", () => {
    const ids = destinatariosPosibles({
      turnos: [{ ...turno("06:00", "14:30"), employee_id: "a" }, { ...turno("06:00", "14:30"), employee_id: "b" }],
      abiertos: ["b", "c"],
      ausentes: ["d"],
      managers: ["m"],
      todos: ["a", "b", "c", "d", "e", "m"],
      enVentanaSemanal: false,
    });
    expect(ids.sort()).toEqual(["a", "b", "c", "d", "m"]);
  });

  it("en la ventana semanal, todos", () => {
    const ids = destinatariosPosibles({ turnos: [], abiertos: [], ausentes: [], managers: [], todos: ["a", "b"], enVentanaSemanal: true });
    expect(ids.sort()).toEqual(["a", "b"]);
  });
});

describe("cron del fichaje: la ruta pone la comprobación antes de las consultas pesadas", () => {
  const ruta = leer("src/app/timetracker/clock-in/api/cron/route.ts");

  it("la primera ronda es ligera y sale temprano con { ok, fired: 0 }", () => {
    expect(ruta).toContain("if (!hayTrabajoEnEstaCorrida(");
    expect(ruta).toContain('return NextResponse.json({ ok: true, fired: 0 });');
  });

  it("la salida temprana va ANTES de leer fichajes de la semana, el registro de avisos y las suscripciones", () => {
    const salida = ruta.indexOf("hayTrabajoEnEstaCorrida({");
    expect(salida).toBeGreaterThan(0);
    for (const consulta of ["clock_in_at=gte.${weekStartIso}", "notifications?select=employee_id,type", "push_subscriptions?select="]) {
      expect(ruta.indexOf(consulta)).toBeGreaterThan(salida);
    }
  });

  it("las suscripciones se filtran a los destinatarios posibles, no se leen todas", () => {
    expect(ruta).toContain("push_subscriptions?select=id,employee_id,endpoint,p256dh,auth&employee_id=in.(");
    expect(ruta).not.toContain('q("push_subscriptions?select=id,employee_id,endpoint,p256dh,auth")');
  });

  it("el cierre de las 8 PM reutiliza los fichajes abiertos de la primera ronda (una sola lectura)", () => {
    const lectura = "time_entries?select=id,employee_id,company_id,clock_in_at,still_working_at&status=eq.open";
    expect(ruta.split(lectura).length - 1).toBe(1);
  });
});
