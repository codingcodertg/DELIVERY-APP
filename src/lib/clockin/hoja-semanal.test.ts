import { describe, expect, it } from "vitest";
import { summarize, type PayEntry } from "@/lib/clockin/payroll";
import { esDiaDeHoy, hmm, hojaDeLaSemana, semanaContieneHoy } from "@/lib/clockin/hoja-semanal";
import { hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import { turnosPorDia } from "@/lib/clockin/turnos-por-dia";

// Texas en noviembre es CST (UTC-6). Semana de pago viernes 27-nov a jueves 3-dic, como la del Excel.
const SEMANA = [
  "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03",
];

const fichaje = (id: string, desde: string, hasta: string | null, extra: Partial<PayEntry> = {}): PayEntry => ({
  id, employee_id: "e1", clock_in_at: desde, clock_out_at: hasta, lunch_minutes: null, ...extra,
});

// El viernes de la hoja del dueño: 7:54 AM–3:56 PM, 4:54 PM–5:56 PM.
const viernes = [
  fichaje("v1", "2026-11-27T13:54:00Z", "2026-11-27T21:56:00Z"),
  fichaje("v2", "2026-11-27T22:54:00Z", "2026-11-27T23:56:00Z"),
];
// El sábado de la hoja: sin comida, 7:57 AM–2:55 PM.
const sabado = [fichaje("s1", "2026-11-28T13:57:00Z", "2026-11-28T20:55:00Z")];
// Martes con tres tramos: 8–10, 10:30–12, 1–3.
const martes = [
  fichaje("m1", "2026-12-01T14:00:00Z", "2026-12-01T16:00:00Z"),
  fichaje("m2", "2026-12-01T16:30:00Z", "2026-12-01T18:00:00Z"),
  fichaje("m3", "2026-12-01T19:00:00Z", "2026-12-01T21:00:00Z"),
];
// Lunes que sigue abierto desde las 8:00 AM.
const abierto = [fichaje("o1", "2026-11-30T14:00:00Z", null)];

describe("hojaDeLaSemana · un día normal, como el viernes del Excel", () => {
  const { filas } = hojaDeLaSemana(turnosPorDia(viernes), SEMANA, 2400);
  const f = filas[0];

  it("sale 8:02 / 0:58 / 1:02 / 9:04", () => {
    expect(hmm(f.trabajoManana)).toBe("8:02");
    expect(hmm(f.fuera)).toBe("0:58");
    expect(hmm(f.trabajoTarde)).toBe("1:02");
    expect(hmm(f.total)).toBe("9:04");
  });

  it("marca las horas de la pausa, dos tramos y ningún día abierto", () => {
    expect(f.dia).toBe("2026-11-27");
    expect(f.entrada).toBe("2026-11-27T13:54:00Z");
    expect(f.salidaAComer).toBe("2026-11-27T21:56:00Z");
    expect(f.regresoDeComer).toBe("2026-11-27T22:54:00Z");
    expect(f.salida).toBe("2026-11-27T23:56:00Z");
    expect(f.tramos).toBe(2);
    expect(f.abierta).toBe(false);
    expect(f.sinFichaje).toBe(false);
  });
});

describe("hojaDeLaSemana · un día sin comida", () => {
  const f = hojaDeLaSemana(turnosPorDia(sabado), SEMANA, 2400).filas[1];

  it("todo el turno va en el tramo de la tarde, y el de la mañana queda vacío", () => {
    expect(f.trabajoManana).toBe(0);
    expect(f.salidaAComer).toBeNull();
    expect(f.regresoDeComer).toBeNull();
    expect(f.fuera).toBe(0);
    expect(hmm(f.trabajoTarde)).toBe("6:58");
    expect(hmm(f.total)).toBe("6:58");
    expect(f.tramos).toBe(1);
  });
});

describe("hojaDeLaSemana · un domingo sin nada", () => {
  const f = hojaDeLaSemana(turnosPorDia([]), SEMANA, 2400).filas[2];

  it("sale vacío y en 0:00", () => {
    expect(f.dia).toBe("2026-11-29");
    expect(f.sinFichaje).toBe(true);
    expect(f.entrada).toBeNull();
    expect(f.tramos).toBe(0);
    expect(hmm(f.total)).toBe("0:00");
  });
});

describe("hojaDeLaSemana · un día con un tramo abierto", () => {
  const f = hojaDeLaSemana(turnosPorDia(abierto), SEMANA, 2400).filas[3];

  it("marca el día como abierto, sin salida, y no cuenta horas hasta ahora", () => {
    expect(f.abierta).toBe(true);
    expect(f.salida).toBeNull();
    expect(f.tramos).toBe(1);
    expect(f.total).toBe(0);
    expect(hmm(f.trabajoTarde)).toBe("0:00");
  });
});

describe("hojaDeLaSemana · tres tramos", () => {
  const f = hojaDeLaSemana(turnosPorDia(martes), SEMANA, 2400).filas[4];

  it("el primer tramo es la mañana, los otros dos son la tarde, y todos los huecos suman fuera", () => {
    expect(f.tramos).toBe(3);
    expect(hmm(f.trabajoManana)).toBe("2:00");
    expect(hmm(f.trabajoTarde)).toBe("3:30");
    expect(hmm(f.fuera)).toBe("1:30");
    expect(f.regresoDeComer).toBe("2026-12-01T19:00:00Z");
    expect(f.salidaAComer).toBe("2026-12-01T16:00:00Z");
    expect(hmm(f.total)).toBe("5:30");
  });
});

describe("hojaDeLaSemana · total semanal y la marca de extras", () => {
  const dias = turnosPorDia([...viernes, ...sabado, ...martes]);

  it("el total de la semana es la suma de los días", () => {
    const hoja = hojaDeLaSemana(dias, SEMANA, 2400);
    expect(hoja.total).toBe(544 + 418 + 330);
    expect(hmm(hoja.total)).toBe("21:32");
  });

  it("por encima del límite sale «sobre»; por debajo o igual, no", () => {
    expect(hojaDeLaSemana(dias, SEMANA, 1200).sobre).toBe(true);
    expect(hojaDeLaSemana(dias, SEMANA, 1292).sobre).toBe(false);
    expect(hojaDeLaSemana(dias, SEMANA, 2400).sobre).toBe(false);
    expect(hojaDeLaSemana(dias, SEMANA, 2400).limite).toBe(2400);
  });
});

describe("hojaDeLaSemana · el total cuadra con la tabla de Nómina", () => {
  // Una persona con una comida fichada (30 min dentro del fichaje), un día abierto y otro normal.
  const entradas: PayEntry[] = [
    fichaje("a", "2026-11-27T13:00:00Z", "2026-11-27T21:00:00Z", { lunch_minutes: 30 }),
    fichaje("b", "2026-11-28T14:00:00Z", "2026-11-28T16:00:00Z"),
    fichaje("c", "2026-11-28T16:20:00Z", "2026-11-28T19:00:00Z"),
    fichaje("d", "2026-11-30T14:00:00Z", null),
  ];
  it("el total semanal de la hoja es el totalMin de summarize sobre los mismos fichajes", () => {
    const hoja = hojaDeLaSemana(turnosPorDia(entradas), SEMANA, 2400);
    expect(hoja.total).toBe(summarize(entradas).totalMin);
    expect(hoja.total).toBe(450 + 120 + 160);
  });
});

describe("hmm", () => {
  it("formatea minutos como H:MM", () => {
    expect(hmm(482)).toBe("8:02");
    expect(hmm(0)).toBe("0:00");
    expect(hmm(3142)).toBe("52:22");
    expect(hmm(60)).toBe("1:00");
    expect(hmm(9)).toBe("0:09");
  });
  it("redondea al minuto y no baja de cero", () => {
    expect(hmm(481.6)).toBe("8:02");
    expect(hmm(-5)).toBe("0:00");
  });
});

describe("hoy en la hoja · el día de Texas, no el de UTC", () => {
  // Pago de viernes a jueves: la semana del 20 al 26 de noviembre de 2026.
  const semana = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"];

  it("hoy dentro de la semana: esa fila es hoy, las demás no", () => {
    expect(esDiaDeHoy("2026-11-25", "2026-11-25")).toBe(true);
    expect(esDiaDeHoy("2026-11-24", "2026-11-25")).toBe(false);
    expect(semanaContieneHoy(semana, "2026-11-25")).toBe(true);
  });

  it("hoy fuera de la semana: ninguna fila es hoy", () => {
    expect(semanaContieneHoy(semana, "2026-11-27")).toBe(false);
    expect(semana.some((dia) => esDiaDeHoy(dia, "2026-11-27"))).toBe(false);
    expect(semanaContieneHoy(semana, "2026-11-19")).toBe(false);
  });

  it("de noche en Texas ya es otro día en UTC: manda Texas", () => {
    // 2026-11-27 02:30 UTC = 26 de noviembre 20:30 en Texas (CST, UTC−6).
    const instante = new Date("2026-11-27T02:30:00Z");
    expect(hoyEnTexas(instante)).toBe("2026-11-26");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-11-27");
    expect(esDiaDeHoy("2026-11-26", hoyEnTexas(instante))).toBe(true);
    expect(esDiaDeHoy("2026-11-27", hoyEnTexas(instante))).toBe(false);
  });

  it("sin día (cadena vacía) nunca es hoy", () => {
    expect(esDiaDeHoy("", "")).toBe(false);
  });
});
