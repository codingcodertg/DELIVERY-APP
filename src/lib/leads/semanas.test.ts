import { describe, expect, it } from "vitest";
import { diaDeChicago, etiquetaDeSemana, semanaInicial, semanasDelPool } from "./semanas";

/** Las semanas del STXP Pool: el día de Chicago, el orden y las etiquetas (función pura). */

const priv = (id: string, imported_at: string | null) => ({ id, source: "privado", imported_at });

describe("el día de Chicago", () => {
  it("una hora UTC de la noche del 30 es el 30 en Chicago (CDT, -05:00)", () => {
    // 2026-10-31 03:00 UTC = 2026-10-30 22:00 en Chicago: el día de Chicago es el 30, no el 31 de UTC.
    expect(diaDeChicago("2026-10-31T03:00:00Z")).toBe("2026-10-30");
  });
  it("el cambio de día se mide en Chicago: 00:30 del 31 es ya el 31", () => {
    expect(diaDeChicago("2026-10-31T05:30:00Z")).toBe("2026-10-31");
  });
  it("después del cambio de horario (CST, -06:00) también cuenta bien", () => {
    // 2026-11-18 03:00 UTC = 2026-11-17 21:00 CST.
    expect(diaDeChicago("2026-11-18T03:00:00Z")).toBe("2026-11-17");
  });
  it("sin fecha o con basura, null", () => {
    expect(diaDeChicago(null)).toBeNull();
    expect(diaDeChicago(undefined)).toBeNull();
    expect(diaDeChicago("no es fecha")).toBeNull();
  });
});

describe("semanasDelPool", () => {
  it("dos imports del mismo día (Chicago) son una sola semana, aunque en UTC caigan en días distintos", () => {
    const { semanas, semanaDeLead } = semanasDelPool([
      priv("a", "2026-10-31T03:00:00Z"), // 10/30 22:00 Chicago
      priv("b", "2026-10-30T20:00:00Z"), // 10/30 15:00 Chicago
    ]);
    expect(semanas).toHaveLength(1);
    expect(semanas[0]).toMatchObject({ numero: 1, dia: "2026-10-30", fecha: "10/30", cuenta: 2 });
    expect(semanaDeLead.get("a")).toBe(1);
    expect(semanaDeLead.get("b")).toBe(1);
  });

  it("ordena de la más vieja a la más nueva, aunque lleguen desordenados", () => {
    const { semanas, semanaDeLead } = semanasDelPool([
      priv("nuevo1", "2026-11-17T17:00:00Z"),
      priv("viejo1", "2026-10-30T17:00:00Z"),
      priv("nuevo2", "2026-11-17T18:00:00Z"),
      priv("viejo2", "2026-10-30T18:00:00Z"),
    ]);
    expect(semanas.map((s) => [s.numero, s.fecha, s.cuenta])).toEqual([[1, "10/30", 2], [2, "11/17", 2]]);
    expect(semanaDeLead.get("viejo1")).toBe(1);
    expect(semanaDeLead.get("nuevo2")).toBe(2);
  });

  it("cuenta por semana y ignora lo que no es privado o no tiene fecha de import", () => {
    const { semanas, semanaDeLead } = semanasDelPool([
      priv("p1", "2026-10-30T17:00:00Z"),
      priv("p2", null),
      { id: "g1", source: "tdlr", imported_at: "2026-10-30T17:00:00Z" },
      { id: "g2", imported_at: "2026-11-17T17:00:00Z" },
      priv("p3", "2026-11-17T17:00:00Z"),
    ]);
    expect(semanas.map((s) => s.cuenta)).toEqual([1, 1]);
    expect(semanaDeLead.has("p1")).toBe(true);
    expect(semanaDeLead.has("p2")).toBe(false);
    expect(semanaDeLead.has("g1")).toBe(false);
    expect(semanaDeLead.has("g2")).toBe(false);
    expect(semanaDeLead.get("p3")).toBe(2);
  });

  it("sin leads privados no hay semanas", () => {
    expect(semanasDelPool([])).toEqual({ semanas: [], semanaDeLead: new Map() });
  });
});

describe("etiquetas", () => {
  it("«Week N · MM/DD», y en español «Semana N · MM/DD»", () => {
    const { semanas } = semanasDelPool([priv("a", "2026-10-30T17:00:00Z"), priv("b", "2026-11-17T17:00:00Z")]);
    expect(etiquetaDeSemana(semanas[0])).toBe("Week 1 · 10/30");
    expect(etiquetaDeSemana(semanas[1])).toBe("Week 2 · 11/17");
    expect(etiquetaDeSemana(semanas[1], "es")).toBe("Semana 2 · 11/17");
  });
});

describe("semanaInicial", () => {
  const dos = [{ numero: 1 }, { numero: 2 }];
  it("sin elección, la semana más nueva", () => {
    expect(semanaInicial(null, dos)).toBe(2);
  });
  it("respeta la elección guardada: una semana o todas", () => {
    expect(semanaInicial("1", dos)).toBe(1);
    expect(semanaInicial("todas", dos)).toBe("todas");
  });
  it("una semana guardada que ya no existe cae a la más nueva", () => {
    expect(semanaInicial("7", dos)).toBe(2);
    expect(semanaInicial("", dos)).toBe(2);
  });
  it("sin semanas, todas", () => {
    expect(semanaInicial(null, [])).toBe("todas");
    expect(semanaInicial("2", [])).toBe("todas");
  });
});
