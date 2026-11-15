import { describe, expect, it } from "vitest";
import { horaDeLlamada, planearAgenda, proximoDiaHabil, telefonoDeMensaje, type HoraDetectada } from "./llamada-del-mensaje";

// Viernes 13 nov 2026, 08:05 hora de Chicago (14:05 UTC). Hora de Brownsville = CST (UTC-6).
const RECIBIDO = "2026-11-13T14:05:00Z";
const hora = (t: string, r = RECIBIDO) => horaDeLlamada(t, r);
const fija = (t: string, r = RECIBIDO) => {
  const h = hora(t, r);
  if (h.tipo !== "fija") throw new Error(`esperaba fija para «${t}», salió ${h.tipo}`);
  return h.iso;
};

describe("teléfono del mensaje", () => {
  it("saca el teléfono en los formatos habituales", () => {
    expect(telefonoDeMensaje("956-555-1234 Monday at 12pm")).toBe("9565551234");
    expect(telefonoDeMensaje("my number is (956) 555 1234, after 3")).toBe("9565551234");
    expect(telefonoDeMensaje("+1 956.555.1234")).toBe("9565551234");
    expect(telefonoDeMensaje("9565551234")).toBe("9565551234");
    expect(telefonoDeMensaje("you can call me anytime")).toBeNull();
  });
});

describe("hora de llamada: los cuatro ejemplos del dueño", () => {
  it("«956-555-1234 Monday at 12pm» → lunes 16 a las 12:00 (Chicago)", () => {
    expect(fija("956-555-1234 Monday at 12pm")).toBe("2026-11-16T18:00:00.000Z");
  });
  it("«you can call me anytime» → cualquier hora", () => {
    expect(hora("you can call me anytime")).toEqual({ tipo: "cualquiera" });
  });
  it("«my number is (956) 555 1234, after 3» → hoy a las 15:00 (la próxima)", () => {
    expect(fija("my number is (956) 555 1234, after 3")).toBe("2026-11-13T21:00:00.000Z");
  });
  it("«Hello yes would Monday at 12pm work?» → lunes 16 a las 12:00", () => {
    expect(fija("Hello yes would Monday at 12pm work?")).toBe("2026-11-16T18:00:00.000Z");
  });
});

describe("hora de llamada: formatos EN y ES", () => {
  it.each([
    ["tomorrow 3pm", "2026-11-14T21:00:00.000Z"],
    ["11/18 at 10", "2026-11-18T16:00:00.000Z"],
    ["Nov 18 at 10am", "2026-11-18T16:00:00.000Z"],
    ["18 de noviembre a las 3", "2026-11-18T21:00:00.000Z"],
    ["hoy 3pm", "2026-11-13T21:00:00.000Z"],
    ["at 3", "2026-11-13T21:00:00.000Z"],
    ["15:30", "2026-11-13T21:30:00.000Z"],
    ["lunes a las 12", "2026-11-16T18:00:00.000Z"],
    ["after 7pm", "2026-11-14T01:00:00.000Z"],
    ["Monday at 3:30 p.m.", "2026-11-16T21:30:00.000Z"],
    ["at 12 noon", "2026-11-13T18:00:00.000Z"],
    ["mediodía mañana", "2026-11-14T18:00:00.000Z"],
  ])("«%s»", (texto, iso) => {
    expect(fija(texto)).toBe(iso);
  });

  it("el día de la semana es SIEMPRE la próxima ocurrencia futura", () => {
    // Viernes 8:00 ya pasó (son las 8:05): el próximo viernes.
    expect(fija("Friday at 8am")).toBe("2026-11-20T14:00:00.000Z");
    // Lunes a las 12:30 CST desde el lunes 12:30 → ya pasó, el lunes siguiente.
    expect(fija("Monday at 12pm", "2026-11-16T18:30:00Z")).toBe("2026-11-23T18:00:00.000Z");
  });

  it("«anytime after 3»: la hora fija gana sobre «anytime»", () => {
    expect(fija("anytime after 3")).toBe("2026-11-13T21:00:00.000Z");
  });

  it("«cualquier hora» y «whenever» → cualquiera", () => {
    expect(hora("cualquier hora por favor")).toEqual({ tipo: "cualquiera" });
    expect(hora("call whenever")).toEqual({ tipo: "cualquiera" });
  });
});

describe("hora de llamada: lo que NO se agenda", () => {
  it("hora ambigua (sin am/pm, 7 o 0) → no entendida", () => {
    expect(hora("at 7").tipo).toBe("no-entendida");
    expect(hora("call me at 0").tipo).toBe("no-entendida");
  });
  it("un día sin hora → no entendida", () => {
    expect(hora("Monday").tipo).toBe("no-entendida");
    expect(hora("today").tipo).toBe("no-entendida");
  });
  it("una hora sin día con dos días distintos → no entendida", () => {
    expect(hora("Monday at 9am and Tuesday at 9am").tipo).toBe("no-entendida");
  });
  it("dos horas distintas → no entendida", () => {
    expect(hora("at 10am or 2pm").tipo).toBe("no-entendida");
  });
  it("«mañana por la mañana» no cuenta como mañana (es la parte del día)", () => {
    expect(hora("mañana por la mañana").tipo).toBe("no-entendida");
  });
  it("sin nada de hora ni de día → ninguna", () => {
    expect(hora("Thanks, I'll wait for your email.")).toEqual({ tipo: "ninguna" });
    expect(hora("call 956-555-1234")).toEqual({ tipo: "ninguna" });
  });
  it("una hora fuera de la ventana laboral (antes de 7 o después de 20) → no entendida", () => {
    expect(hora("at 11pm").tipo).toBe("no-entendida");
    expect(hora("at 5am").tipo).toBe("no-entendida");
  });
});

describe("próximo día hábil", () => {
  it("viernes → lunes; sábado → lunes; martes → miércoles", () => {
    expect(proximoDiaHabil("2026-11-13T14:05:00Z")).toBe("2026-11-16");
    expect(proximoDiaHabil("2026-11-14T15:00:00Z")).toBe("2026-11-16");
    expect(proximoDiaHabil("2026-11-17T15:00:00Z")).toBe("2026-11-18");
  });
});

describe("planear la agenda", () => {
  const base = { recibido: RECIBIDO, ahora: RECIBIDO, citaFuturaIso: null, seguimientoActual: null, choques: [] as string[] };
  const agenda = (h: HoraDetectada, extra: Partial<Parameters<typeof planearAgenda>[0]> = {}) => planearAgenda({ ...base, hora: h, ...extra });

  it("hora fija libre → se agenda, sin pendiente", () => {
    const p = agenda({ tipo: "fija", iso: "2026-11-16T18:00:00.000Z", fragmento: "monday at 12pm" });
    expect(p).toMatchObject({ accion: "agendar", iso: "2026-11-16T18:00:00.000Z", reemplaza: false, pendiente: false });
  });

  it("hora con choque → no se agenda y el detalle dice con quién", () => {
    const p = agenda({ tipo: "fija", iso: "2026-11-16T18:00:00.000Z", fragmento: "monday at 12pm" }, { choques: ["Ana Ruiz"] });
    expect(p.accion).toBe("ninguna");
    expect(p.detalle).toMatch(/choca con Ana Ruiz/);
  });

  it("ya tiene llamada futura y el mensaje da OTRA hora → se reemplaza esa llamada", () => {
    const p = agenda(
      { tipo: "fija", iso: "2026-11-16T18:00:00.000Z", fragmento: "monday at 12pm" },
      { citaFuturaIso: "2026-11-17T20:00:00.000Z" },
    );
    expect(p).toMatchObject({ accion: "agendar", reemplaza: true, iso: "2026-11-16T18:00:00.000Z" });
  });

  it("ya tiene llamada futura a la MISMA hora → no hace nada", () => {
    const p = agenda(
      { tipo: "fija", iso: "2026-11-16T18:00:00.000Z", fragmento: "monday at 12pm" },
      { citaFuturaIso: "2026-11-16T18:00:00.000Z" },
    );
    expect(p.accion).toBe("ninguna");
  });

  it("REGLA DEL PASADO: hora de un correo viejo → pendiente el siguiente día hábil a las 9:00, con la frase original", () => {
    const p = planearAgenda({
      hora: { tipo: "fija", iso: "2026-11-09T18:00:00.000Z", fragmento: "monday at 12pm" },
      recibido: "2026-11-06T18:00:00Z",
      ahora: "2026-11-14T15:00:00Z",
      citaFuturaIso: null,
      seguimientoActual: null,
      choques: [],
    });
    expect(p).toMatchObject({ accion: "agendar", iso: "2026-11-16T15:00:00.000Z", pendiente: true });
    expect(p.accion === "agendar" && p.detalle).toMatch(/Hora pasada: pidió «monday at 12pm» el 2026-11-06|pidió «monday at 12pm»/);
  });

  it("REGLA DEL PASADO con llamada futura ya agendada → no se pisa", () => {
    const p = planearAgenda({
      hora: { tipo: "fija", iso: "2026-11-09T18:00:00.000Z", fragmento: "monday at 12pm" },
      recibido: "2026-11-06T18:00:00Z",
      ahora: "2026-11-14T15:00:00Z",
      citaFuturaIso: "2026-11-20T18:00:00.000Z",
      seguimientoActual: null,
      choques: [],
    });
    expect(p.accion).toBe("ninguna");
  });

  it("«cualquier hora» en vivo → tarea de seguimiento el siguiente día hábil", () => {
    expect(agenda({ tipo: "cualquiera" })).toEqual({ accion: "seguimiento", dia: "2026-11-16", detalle: expect.any(String) });
  });

  it("«cualquier hora» de un correo viejo → también el siguiente día hábil desde hoy (no en el pasado)", () => {
    const p = planearAgenda({
      hora: { tipo: "cualquiera" },
      recibido: "2026-11-06T18:00:00Z",
      ahora: "2026-11-14T15:00:00Z",
      citaFuturaIso: null,
      seguimientoActual: null,
      choques: [],
    });
    expect(p).toMatchObject({ accion: "seguimiento", dia: "2026-11-16" });
  });

  it("«cualquier hora» con llamada futura → no se toca", () => {
    expect(agenda({ tipo: "cualquiera" }, { citaFuturaIso: "2026-11-20T18:00:00.000Z" }).accion).toBe("ninguna");
  });

  it("«cualquier hora» con seguimiento ya puesto antes → no se cambia", () => {
    expect(agenda({ tipo: "cualquiera" }, { seguimientoActual: "2026-11-16" }).accion).toBe("ninguna");
  });

  it("hora no entendida o sin hora → no se agenda, y la nota lo dice", () => {
    expect(agenda({ tipo: "no-entendida", fragmento: "at 7" })).toMatchObject({ accion: "ninguna" });
    expect(agenda({ tipo: "no-entendida", fragmento: "at 7" }).detalle).toMatch(/no entendida/);
    expect(agenda({ tipo: "ninguna" }).accion).toBe("ninguna");
  });
});
