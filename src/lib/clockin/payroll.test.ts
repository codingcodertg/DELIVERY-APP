import { describe, expect, it } from "vitest";
import { attachLunch, entryMinutes, lunchMinutes, summarize, type LunchRow, type PayEntry } from "./payroll";

// T-3 de `docs/AUDIT-2026-10-09.md`: esta es la aritmética de nómina que comparten la pantalla de
// hojas de horas, el CSV, el XLSX y el marcador de asistencia —lo dice su propia cabecera— y
// **ninguna prueba la llamaba**. La regla del almuerzo, la que decide cuánto se descuenta de un
// día pagado, no tenía ni una.
//
// La regla, tal como está escrita: una pausa FICHADA (una fila de `exceptions` con `reason=lunch`
// y `time_entry_id`) manda sobre la columna heredada `lunch_minutes`, que solo es el respaldo de
// las entradas sin pausa fichada. Así que los casos de aquí van en los dos sentidos: con fila y
// sin ella, y con la columna heredada diciendo lo contrario.

/** Las horas se escriben con la Z puesta, para que el resultado no dependa de la zona de quien corre. */
const entrada = (e: Partial<PayEntry> & { id: string }): PayEntry => ({
  employee_id: "emp-1",
  clock_in_at: "2026-10-09T13:00:00Z",
  clock_out_at: "2026-10-09T21:00:00Z", // 8 h brutas
  lunch_minutes: null,
  ...e,
});

const pausa = (id: string, left: string, returned: string): LunchRow => ({
  time_entry_id: id,
  left_at: `2026-10-09T${left}:00Z`,
  returned_at: `2026-10-09T${returned}:00Z`,
});

describe("1 · attachLunch: de qué minutos de almuerzo se entera la entrada", () => {
  it("una pausa fichada deja sus minutos y su tramo en la entrada", () => {
    const e = entrada({ id: "a" });
    attachLunch([e], [pausa("a", "17:00", "17:30")]);
    expect(e.punched_lunch_min).toBe(30);
    expect(e.lunch_windows).toEqual([{ left: "2026-10-09T17:00:00Z", returned: "2026-10-09T17:30:00Z" }]);
  });

  it("dos pausas en la misma entrada se SUMAN, no se queda con la última", () => {
    const e = entrada({ id: "a" });
    attachLunch([e], [pausa("a", "17:00", "17:30"), pausa("a", "19:00", "19:15")]);
    expect(e.punched_lunch_min).toBe(45);
    expect(e.lunch_windows).toHaveLength(2);
  });

  it("cada entrada recibe la suya, y una fila de otra entrada no se le pega a nadie", () => {
    const a = entrada({ id: "a" });
    const b = entrada({ id: "b" });
    attachLunch([a, b], [pausa("a", "17:00", "17:45"), pausa("fantasma", "17:00", "18:00")]);
    expect(a.punched_lunch_min).toBe(45);
    expect(b.punched_lunch_min).toBeNull();
    expect(b.lunch_windows).toEqual([]);
  });

  it("sin pausa fichada el campo queda en null — que es lo que deja mandar a la columna heredada", () => {
    // Y queda en null aunque la entrada llegara con un valor viejo pegado: se reescribe entera,
    // porque si no, un segundo repaso con menos filas dejaría minutos de la vez anterior.
    const e = { ...entrada({ id: "a" }), punched_lunch_min: 99, lunch_windows: [{ left: "x", returned: "y" }] };
    attachLunch([e], []);
    expect(e.punched_lunch_min).toBeNull();
    expect(e.lunch_windows).toEqual([]);
  });

  it("una fila a medias no cuenta: sin entrada, sin salida o sin vuelta", () => {
    const e = entrada({ id: "a" });
    attachLunch([e], [
      { time_entry_id: null, left_at: "2026-10-09T17:00:00Z", returned_at: "2026-10-09T17:30:00Z" },
      { time_entry_id: "a", left_at: null, returned_at: "2026-10-09T17:30:00Z" },
      { time_entry_id: "a", left_at: "2026-10-09T17:00:00Z", returned_at: null },
    ]);
    expect(e.punched_lunch_min).toBeNull();
  });

  it("una pausa de duración cero o del revés no cuenta, y así no desplaza a la columna heredada", () => {
    // Si una fila de 0 minutos contara, `punched_lunch_min` valdría 0 y el 0 gana al respaldo:
    // una pausa mal fichada le pagaría a alguien el almuerzo que su turno sí descuenta.
    const e = entrada({ id: "a", lunch_minutes: 30 });
    attachLunch([e], [pausa("a", "17:00", "17:00"), pausa("a", "19:00", "18:00")]);
    expect(e.punched_lunch_min).toBeNull();
    expect(e.lunch_windows).toEqual([]);
    expect(lunchMinutes(e)).toBe(30);
  });

  it("devuelve la misma lista que se le pasa, que es como la usan quienes la llaman", () => {
    const lista = [entrada({ id: "a" })];
    expect(attachLunch(lista, [])).toBe(lista);
  });
});

describe("2 · lunchMinutes: la pausa fichada manda; la columna heredada es el respaldo", () => {
  it("con las dos cosas, manda la fichada aunque diga MENOS que la columna", () => {
    expect(lunchMinutes({ punched_lunch_min: 15, lunch_minutes: 60 })).toBe(15);
  });

  it("y manda también cuando dice MÁS: no se elige la que convenga", () => {
    expect(lunchMinutes({ punched_lunch_min: 75, lunch_minutes: 30 })).toBe(75);
  });

  it("sin fila fichada, la columna heredada", () => {
    expect(lunchMinutes({ punched_lunch_min: null, lunch_minutes: 30 })).toBe(30);
    expect(lunchMinutes({ lunch_minutes: 45 })).toBe(45);
  });

  it("una pausa fichada de 0 minutos es un dato, no un hueco: gana al 30 de la columna", () => {
    // Es la diferencia entre `??` y `||`, y vale dinero: con `||` el 0 se leería como «no hay
    // dato» y se descontaría media hora que esa persona no se tomó.
    expect(lunchMinutes({ punched_lunch_min: 0, lunch_minutes: 30 })).toBe(0);
  });

  it("sin ninguna de las dos, 0; y nunca un descuento negativo", () => {
    expect(lunchMinutes({})).toBe(0);
    expect(lunchMinutes({ punched_lunch_min: null, lunch_minutes: null })).toBe(0);
    expect(lunchMinutes({ lunch_minutes: -30 })).toBe(0);
  });
});

describe("3 · entryMinutes: los minutos que se pagan de una entrada", () => {
  it("un turno de 8 h sin almuerzo son 480 minutos", () => {
    expect(entryMinutes(entrada({ id: "a" }))).toBe(480);
  });

  it("el almuerzo se descuenta: 8 h menos 30 min de la columna heredada", () => {
    expect(entryMinutes(entrada({ id: "a", lunch_minutes: 30 }))).toBe(450);
  });

  it("con pausa fichada se descuenta ESA, no la de la columna", () => {
    const e = entrada({ id: "a", lunch_minutes: 30 });
    attachLunch([e], [pausa("a", "17:00", "18:00")]);
    expect(entryMinutes(e)).toBe(420); // 480 − 60, no 480 − 30
  });

  it("una entrada abierta vale 0: no se paga lo que aún no ha terminado", () => {
    expect(entryMinutes(entrada({ id: "a", clock_out_at: null }))).toBe(0);
  });

  it("nunca negativo: un almuerzo más largo que el turno deja 0, no una resta al sueldo", () => {
    expect(entryMinutes(entrada({ id: "a", lunch_minutes: 600 }))).toBe(0);
    // Y una salida anterior a la entrada tampoco resta.
    expect(entryMinutes(entrada({ id: "a", clock_out_at: "2026-10-09T12:00:00Z" }))).toBe(0);
  });
});

describe("4 · summarize: lo que de verdad lee la pantalla", () => {
  it("suma las entradas cerradas, cuenta las abiertas aparte y enseña el almuerzo descontado", () => {
    const cerrada = entrada({ id: "a", lunch_minutes: 30 });
    const abierta = entrada({ id: "b", clock_out_at: null, lunch_minutes: 30 });
    const s = summarize([cerrada, abierta]);
    expect(s.totalMin).toBe(450);
    expect(s.openCount).toBe(1);
    expect(s.lunchMin).toBe(30); // el de la abierta no se descuenta de nada
  });

  it("la pausa fichada llega hasta aquí: el total del período cambia con ella", () => {
    const e = entrada({ id: "a", lunch_minutes: 30 });
    attachLunch([e], [pausa("a", "17:00", "18:00")]);
    const s = summarize([e]);
    expect(s.totalMin).toBe(420);
    expect(s.lunchMin).toBe(60);
  });

  it("las horas extra empiezan pasadas las 40 de la semana, no antes", () => {
    const dias = Array.from({ length: 5 }, (_, i) => entrada({ id: `d${i}` })); // 5 × 8 h = 40 h
    expect(summarize(dias)).toMatchObject({ totalMin: 2400, regularMin: 2400, otMin: 0 });
    const seis = [...dias, entrada({ id: "d5" })]; // 48 h
    expect(summarize(seis)).toMatchObject({ totalMin: 2880, regularMin: 2400, otMin: 480 });
  });
});
