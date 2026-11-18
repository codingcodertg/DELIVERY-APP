import { describe, it, expect } from "vitest";
import {
  bloquesChocan, bloquesDeSolicitud, horasTotales, minutosDeBloque, minutosDeHora, minutosTotales,
  rangosDeBloques, validarBloques, type Bloque,
} from "./dos-bloques";

const MANANA: Bloque = { fromTime: "08:50", toTime: "11:00" };
const DESPUES: Bloque = { fromTime: "12:03", toTime: "15:47" };
// "Hoy" en la app es 2026-11-18 a las 16:00; ahoraMin = 960.
const HOY = "2026-11-18";
const AHORA = 16 * 60;

describe("minutosDeHora", () => {
  it("lee HH:MM al minuto exacto, sin redondear", () => {
    expect(minutosDeHora("08:50")).toBe(530);
    expect(minutosDeHora("12:03")).toBe(723);
    expect(minutosDeHora("00:00")).toBe(0);
    expect(minutosDeHora("23:59")).toBe(1439);
  });

  it("acepta HH:MM:SS (lo que a veces devuelve el input de hora)", () => {
    expect(minutosDeHora("09:15:00")).toBe(555);
  });

  it("rechaza lo que no es una hora real", () => {
    expect(minutosDeHora("")).toBeNull();
    expect(minutosDeHora("24:00")).toBeNull();
    expect(minutosDeHora("10:60")).toBeNull();
    expect(minutosDeHora("abc")).toBeNull();
    expect(minutosDeHora(undefined)).toBeNull();
  });
});

describe("minutosDeBloque / minutosTotales / horasTotales", () => {
  it("cuenta minutos exactos de un bloque", () => {
    expect(minutosDeBloque({ fromTime: "08:50", toTime: "11:00" })).toBe(130); // 2 h 10 min
  });

  it("un fin anterior al inicio cuenta como cruce de medianoche", () => {
    expect(minutosDeBloque({ fromTime: "22:00", toTime: "02:00" })).toBe(240);
  });

  it("un bloque sin horas válidas vale 0", () => {
    expect(minutosDeBloque({ fromTime: "", toTime: "11:00" })).toBe(0);
  });

  it("suma los dos bloques (mañana + después de comer)", () => {
    expect(minutosTotales([MANANA, DESPUES])).toBe(130 + 224); // 2 h 10 min + 3 h 44 min
  });

  it("horas totales sin redondear al minuto (6 min del 12:00 al 12:06 = 0.1 h)", () => {
    expect(horasTotales([{ fromTime: "12:00", toTime: "12:06" }])).toBeCloseTo(0.1, 10);
    expect(horasTotales([MANANA, DESPUES]).toFixed(2)).toBe("5.90");
  });
});

describe("bloquesDeSolicitud", () => {
  it("una solicitud antigua de un solo bloque da un elemento", () => {
    expect(bloquesDeSolicitud({ fromTime: "08:50", toTime: "11:00", hours: 2.17 })).toEqual([MANANA]);
  });

  it("con secondBlock da dos bloques, en orden", () => {
    expect(bloquesDeSolicitud({
      fromTime: "08:50", toTime: "11:00", secondBlock: { fromTime: "12:03", toTime: "15:47", hours: 3.73 },
    })).toEqual([MANANA, DESPUES]);
  });

  it("una solicitud de solo horas (sin fromTime/toTime) no tiene bloques", () => {
    expect(bloquesDeSolicitud({ hours: 4 })).toEqual([]);
  });

  it("ignora un secondBlock incompleto", () => {
    expect(bloquesDeSolicitud({ fromTime: "08:50", toTime: "11:00", secondBlock: { fromTime: "12:00" } })).toEqual([MANANA]);
  });
});

describe("rangosDeBloques", () => {
  it("pasa cada bloque a minutos, con el fin de un cruce en 1440", () => {
    expect(rangosDeBloques([MANANA, { fromTime: "22:00", toTime: "01:00" }])).toEqual([
      { startMin: 530, endMin: 660 },
      { startMin: 1320, endMin: 1440 },
    ]);
  });
});

describe("validarBloques", () => {
  const base = { fecha: HOY, hoy: HOY, ahoraMin: AHORA, ocupados: [] as { startMin: number; endMin: number }[] };

  it("acepta dos bloques bien puestos el mismo día", () => {
    const r = validarBloques({ ...base, bloques: [MANANA, DESPUES] });
    expect(r).toEqual({ ok: true, minutos: 130 + 224 });
  });

  it("acepta un solo bloque (solicitud normal)", () => {
    expect(validarBloques({ ...base, bloques: [MANANA] })).toEqual({ ok: true, minutos: 130 });
  });

  it("sin bloques: pide las horas", () => {
    expect(validarBloques({ ...base, bloques: [] })).toEqual({ ok: false, error: "enterTimes" });
  });

  it("un bloque sin hora de inicio o de fin: pide las horas", () => {
    expect(validarBloques({ ...base, bloques: [{ fromTime: "08:50", toTime: "" }] })).toEqual({ ok: false, error: "enterTimes" });
  });

  it("el fin debe ser posterior al inicio (igual o anterior: no vale)", () => {
    expect(validarBloques({ ...base, bloques: [{ fromTime: "10:00", toTime: "10:00" }] })).toEqual({ ok: false, error: "endAfterStart" });
    expect(validarBloques({ ...base, bloques: [{ fromTime: "11:00", toTime: "08:50" }] })).toEqual({ ok: false, error: "endAfterStart" });
  });

  it("el bloque de después de comer tiene que empezar después de que acabe el de la mañana", () => {
    const solape = { fromTime: "10:30", toTime: "13:00" };
    expect(validarBloques({ ...base, bloques: [MANANA, solape] })).toEqual({ ok: false, error: "order" });
  });

  it("tocarse en el minuto no es solape: 11:00 de fin y 11:00 de inicio valen", () => {
    const pegado = { fromTime: "11:00", toTime: "12:00" };
    expect(validarBloques({ ...base, bloques: [MANANA, pegado] })).toEqual({ ok: true, minutos: 130 + 60 });
  });

  it("ningún bloque puede acabar en el futuro hoy", () => {
    const hoyTarde = { fromTime: "15:00", toTime: "17:00" }; // ahora son las 16:00
    expect(validarBloques({ ...base, bloques: [hoyTarde] })).toEqual({ ok: false, error: "future" });
  });

  it("un bloque de hoy que acaba exactamente ahora no es futuro", () => {
    expect(validarBloques({ ...base, bloques: [{ fromTime: "15:00", toTime: "16:00" }] })).toEqual({ ok: true, minutos: 60 });
  });

  it("un día posterior a hoy es futuro", () => {
    expect(validarBloques({ ...base, fecha: "2026-11-19", bloques: [MANANA] })).toEqual({ ok: false, error: "future" });
  });

  it("un día anterior a hoy no es futuro", () => {
    expect(validarBloques({ ...base, fecha: "2026-11-17", bloques: [MANANA, DESPUES] })).toEqual({ ok: true, minutos: 354 });
  });

  it("no puede chocar con tiempo ya fichado o pedido ese día", () => {
    const ocupados = [{ startMin: 600, endMin: 630 }]; // 10:00-10:30
    expect(validarBloques({ ...base, ocupados, bloques: [MANANA] })).toEqual({ ok: false, error: "overlap" });
  });

  it("un bloque que se come un hueco ocupado entero también choca", () => {
    const ocupados = [{ startMin: 720, endMin: 740 }]; // 12:00-12:20, dentro del hueco de comida
    expect(validarBloques({ ...base, ocupados, bloques: [MANANA, DESPUES] })).toEqual({ ok: false, error: "overlap" });
  });
});

describe("bloquesChocan (al aprobar)", () => {
  it("no choca si los bloques caben libres", () => {
    expect(bloquesChocan([MANANA, DESPUES], [{ startMin: 0, endMin: 500 }])).toBe(false);
  });

  it("choca si un bloque cae sobre algo ya fichado", () => {
    expect(bloquesChocan([MANANA, DESPUES], [{ startMin: 900, endMin: 960 }])).toBe(true);
  });

  it("choca si los dos bloques se solapan entre sí (aunque ninguno toque lo ocupado)", () => {
    expect(bloquesChocan([{ fromTime: "09:00", toTime: "11:00" }, { fromTime: "10:30", toTime: "12:00" }], [])).toBe(true);
  });
});
