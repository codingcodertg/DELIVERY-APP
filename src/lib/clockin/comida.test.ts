import { describe, expect, it } from "vitest";
import { minutosDeVentanas, modoDeComida, pagoDeComida, resumenDelBorrador, validaTurno, type BorradorTurno, type TurnoBruto } from "./comida";
import { utcToCentralInput } from "./tz";

// Las horas que entran son de Chicago ("YYYY-MM-DDTHH:MM"). Se escriben tal cual las da el
// formulario, y los UTC esperados se miran a mano: en enero (CST, UTC-6) y en julio (CDT, UTC-5).

const turno = (t: Partial<TurnoBruto>): TurnoBruto => ({ clockIn: "2026-01-15T09:00", clockOut: "2026-01-15T17:00", lunchStart: null, lunchEnd: null, ...t });

describe("validaTurno: la comida se valida y se convierte a UTC", () => {
  it("una comida de 35 minutos en invierno: 12:05 a 12:40 CST son 18:05Z a 18:40Z", () => {
    const r = validaTurno(turno({ lunchStart: "2026-01-15T12:05", lunchEnd: "2026-01-15T12:40" }), { exigeSalida: true });
    expect(r).toMatchObject({
      ok: true,
      clockInAt: "2026-01-15T15:00:00.000Z",
      clockOutAt: "2026-01-15T23:00:00.000Z",
      comida: { left: "2026-01-15T18:05:00.000Z", returned: "2026-01-15T18:40:00.000Z" },
      comidaMin: 35,
      pagadoMin: 8 * 60 - 35,
    });
  });

  it("sin comida: los minutos de comida son 0 y las horas pagadas son el turno entero", () => {
    const r = validaTurno(turno({}), { exigeSalida: true });
    expect(r).toMatchObject({ ok: true, comida: null, comidaMin: 0, pagadoMin: 8 * 60 });
  });

  it("un turno abierto (sin salida) se puede guardar con comida, y no tiene horas pagadas todavía", () => {
    const r = validaTurno(turno({ clockOut: null, lunchStart: "2026-01-15T12:00", lunchEnd: "2026-01-15T12:30" }), { exigeSalida: false });
    expect(r).toMatchObject({ ok: true, clockOutAt: null, comidaMin: 30, pagadoMin: null });
  });

  it("el alta exige salida; la edición no", () => {
    expect(validaTurno(turno({ clockOut: null }), { exigeSalida: true })).toEqual({ ok: false, error: "Clock out is required." });
    expect(validaTurno(turno({ clockOut: null }), { exigeSalida: false })).toMatchObject({ ok: true });
  });
});

describe("validaTurno: los mensajes de error", () => {
  const err = (t: Partial<TurnoBruto>) => {
    const r = validaTurno(turno(t), { exigeSalida: true });
    if (r.ok) throw new Error("se esperaba un error");
    return r.error;
  };

  it("la salida tiene que ir después de la entrada", () => {
    expect(err({ clockOut: "2026-01-15T08:00" })).toBe("Clock out must be after clock in.");
  });

  it("la comida va completa o no va", () => {
    expect(err({ lunchStart: "2026-01-15T12:00" })).toBe("Enter both lunch start and lunch end, or neither.");
    expect(err({ lunchEnd: "2026-01-15T12:30" })).toBe("Enter both lunch start and lunch end, or neither.");
  });

  it("el fin de la comida tiene que ir después de su inicio", () => {
    expect(err({ lunchStart: "2026-01-15T12:30", lunchEnd: "2026-01-15T12:00" })).toBe("Lunch end must be after lunch start.");
    expect(err({ lunchStart: "2026-01-15T12:30", lunchEnd: "2026-01-15T12:30" })).toBe("Lunch end must be after lunch start.");
  });

  it("la comida tiene que caer dentro del turno", () => {
    expect(err({ lunchStart: "2026-01-15T08:30", lunchEnd: "2026-01-15T09:00" })).toBe("Lunch must be inside the shift.");
    expect(err({ lunchStart: "2026-01-15T16:45", lunchEnd: "2026-01-15T17:30" })).toBe("Lunch must be inside the shift.");
  });

  it("con turno abierto solo importa que empiece dentro (no hay salida con la que comparar)", () => {
    const abierto = { clockOut: null, lunchStart: "2026-01-15T16:45", lunchEnd: "2026-01-15T17:30" };
    expect(validaTurno(turno(abierto), { exigeSalida: false })).toMatchObject({ ok: true, comidaMin: 45 });
    expect(validaTurno(turno({ clockOut: null, lunchStart: "2026-01-15T08:30", lunchEnd: "2026-01-15T09:00" }), { exigeSalida: false }))
      .toEqual({ ok: false, error: "Lunch must be inside the shift." });
  });

  it("una fecha que no existe da error y no revienta", () => {
    expect(err({ clockIn: "2026-13-01T09:00" })).toBe("Clock in is not a valid date and time.");
    expect(err({ clockIn: "" })).toBe("Clock in is required.");
  });
});

describe("validaTurno: el día del cambio de horario (Chicago, 8 de marzo de 2026)", () => {
  // A las 2:00 CST se pasa a las 3:00 CDT. Un turno de 01:00 a 09:00 de pared dura 7 horas reales.
  it("el turno de 01:00 a 09:00 de pared son 7 h reales; la comida de 05:00 a 05:30 (ya CDT) son 30 min", () => {
    const r = validaTurno(
      { clockIn: "2026-03-08T01:00", clockOut: "2026-03-08T09:00", lunchStart: "2026-03-08T05:00", lunchEnd: "2026-03-08T05:30" },
      { exigeSalida: true },
    );
    expect(r).toMatchObject({
      ok: true,
      clockInAt: "2026-03-08T07:00:00.000Z", // 01:00 CST
      clockOutAt: "2026-03-08T14:00:00.000Z", // 09:00 CDT
      comida: { left: "2026-03-08T10:00:00.000Z", returned: "2026-03-08T10:30:00.000Z" },
      comidaMin: 30,
      pagadoMin: 7 * 60 - 30,
    });
  });

  it("la comida que cruza la hora del cambio no pierde ni gana una hora", () => {
    // 01:30 CST (07:30Z) a 03:15 CDT (08:15Z): son 45 min reales, no 105.
    const r = validaTurno(
      { clockIn: "2026-03-08T00:00", clockOut: "2026-03-08T05:00", lunchStart: "2026-03-08T01:30", lunchEnd: "2026-03-08T03:15" },
      { exigeSalida: true },
    );
    expect(r).toMatchObject({ ok: true, comidaMin: 45 });
  });

  it("y la ida y vuelta de la hora de comida vuelve la misma pared de Chicago", () => {
    const r = validaTurno(
      { clockIn: "2026-03-08T06:00", clockOut: "2026-03-08T15:00", lunchStart: "2026-03-08T11:00", lunchEnd: "2026-03-08T11:30" },
      { exigeSalida: true },
    );
    if (!r.ok || !r.comida) throw new Error("debería validar");
    expect(utcToCentralInput(r.comida.left)).toBe("2026-03-08T11:00");
    expect(utcToCentralInput(r.comida.returned)).toBe("2026-03-08T11:30");
  });

  it("el 1 de noviembre (vuelta a CST) un turno de 06:00 a 15:00 son 9 h", () => {
    const r = validaTurno(
      { clockIn: "2026-11-01T06:00", clockOut: "2026-11-01T15:00", lunchStart: "2026-11-01T12:00", lunchEnd: "2026-11-01T12:30" },
      { exigeSalida: true },
    );
    expect(r).toMatchObject({ ok: true, pagadoMin: 9 * 60 - 30 });
  });
});

describe("minutosDeVentanas y modoDeComida", () => {
  it("suma varias ventanas", () => {
    expect(minutosDeVentanas([
      { left: "2026-01-15T18:00:00.000Z", returned: "2026-01-15T18:15:00.000Z" },
      { left: "2026-01-15T21:00:00.000Z", returned: "2026-01-15T21:10:00.000Z" },
    ])).toBe(25);
  });

  it("una ventana: el formulario recibe sus horas en hora de Chicago", () => {
    expect(modoDeComida({
      lunch_minutes: 35,
      lunch_windows: [{ left: "2026-01-15T18:05:00.000Z", returned: "2026-01-15T18:40:00.000Z" }],
    })).toEqual({ modo: "horas", lunchStart: "2026-01-15T12:05", lunchEnd: "2026-01-15T12:40" });
  });

  it("sin ventana y con minutos (turno viejo): se edita en minutos para no perder la comida", () => {
    expect(modoDeComida({ lunch_minutes: 30, lunch_windows: [] })).toEqual({ modo: "minutos", minutos: 30 });
    expect(modoDeComida({ lunch_minutes: 30 })).toEqual({ modo: "minutos", minutos: 30 });
  });

  it("sin nada: horas vacías", () => {
    expect(modoDeComida({ lunch_minutes: 0, lunch_windows: [] })).toEqual({ modo: "horas", lunchStart: "", lunchEnd: "" });
    expect(modoDeComida({ lunch_minutes: null })).toEqual({ modo: "horas", lunchStart: "", lunchEnd: "" });
  });

  it("varias ventanas: el formulario no las toca", () => {
    const modo = modoDeComida({
      lunch_minutes: 25,
      lunch_windows: [
        { left: "2026-01-15T18:00:00.000Z", returned: "2026-01-15T18:15:00.000Z" },
        { left: "2026-01-15T21:00:00.000Z", returned: "2026-01-15T21:10:00.000Z" },
      ],
    });
    expect(modo).toEqual({ modo: "varias", minutos: 25 });
  });
});


const borrador = (b: Partial<BorradorTurno>): BorradorTurno => ({
  clockIn: "2026-01-15T09:00", clockOut: "2026-01-15T17:00", modo: "horas", lunch: 0, lunchStart: "", lunchEnd: "", note: "", ...b,
});

describe("resumenDelBorrador y pagoDeComida: lo que ve y manda el formulario", () => {
  it("en horas: minutos de comida y horas pagadas en vivo", () => {
    expect(resumenDelBorrador(borrador({ lunchStart: "2026-01-15T12:05", lunchEnd: "2026-01-15T12:40" }), true))
      .toEqual({ error: null, comidaMin: 35, pagadoMin: 445 });
  });

  it("en horas, un solo campo de comida lleno da el error, y el resumen no inventa cifras", () => {
    expect(resumenDelBorrador(borrador({ lunchStart: "2026-01-15T12:05" }), true))
      .toEqual({ error: "Enter both lunch start and lunch end, or neither.", comidaMin: 0, pagadoMin: null });
  });

  it("en minutos (turno viejo): resta los minutos del turno y no pide horas", () => {
    expect(resumenDelBorrador(borrador({ modo: "minutos", lunch: 30 }), true)).toEqual({ error: null, comidaMin: 30, pagadoMin: 450 });
  });

  it("un turno abierto no tiene horas pagadas hasta que se cierre", () => {
    expect(resumenDelBorrador(borrador({ clockOut: "" }), false)).toEqual({ error: null, comidaMin: 0, pagadoMin: null });
    expect(resumenDelBorrador(borrador({ clockOut: "" }), true)).toEqual({ error: "Clock out is required.", comidaMin: 0, pagadoMin: null });
  });

  it("en horas manda las horas; en minutos y varias NO manda horas (el servidor no toca las pausas)", () => {
    expect(pagoDeComida(borrador({ lunchStart: "2026-01-15T12:05", lunchEnd: "2026-01-15T12:40" })))
      .toEqual({ lunch: 35, lunchStart: "2026-01-15T12:05", lunchEnd: "2026-01-15T12:40" });
    expect(pagoDeComida(borrador({ lunchStart: "", lunchEnd: "" }))).toEqual({ lunch: 0, lunchStart: null, lunchEnd: null });
    expect(pagoDeComida(borrador({ modo: "minutos", lunch: 30 }))).toEqual({ lunch: 30 });
    expect(pagoDeComida(borrador({ modo: "varias", lunch: 25 }))).toEqual({ lunch: 25 });
  });
});
