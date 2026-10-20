import { describe, expect, it } from "vitest";
import { SCORECARDS } from "./scorecards";
import { scoreAverage } from "./utils";

// D-605 (2026-10-19) · El dueño: «el rating system … están al revés … todas deberían ser uno como worst y four como good …
// afecta sería número uno». Toda escala de las tarjetas va 1 = lo peor … 4 = lo mejor, sin «descending».

describe("escalas al derecho: 1 = lo peor, 4 = lo mejor", () => {
  it("ninguna escala de las tarjetas lleva «descending», y la de riesgo va Afecta (1) … Sin riesgo (4)", () => {
    const escalas = SCORECARDS.flatMap((s) => s.items.map((i) => i.scale));
    expect(escalas.length).toBeGreaterThan(20);
    for (const sc of escalas) {
      expect(sc.map((l) => l.value)).toEqual([1, 2, 3, 4]);
      expect(sc.some((l) => l.descending)).toBe(false);
    }
    const riesgo = escalas.find((sc) => sc.some((l) => l.label_en === "No Risk"))!;
    expect(riesgo.map((l) => l.label_en)).toEqual(["Affecting", "Slightly Affecting", "Possible", "No Risk"]);
    expect(riesgo.map((l) => l.label_es)).toEqual(["Afecta", "Afecta levemente", "Posible", "Sin riesgo"]);
  });

  it("con la escala al derecho, «Sin riesgo» (4) sube la media y «Afecta» (1) la baja, sin ninguna vuelta", () => {
    const riesgo = SCORECARDS.flatMap((s) => s.items).find((i) => i.scale.some((l) => l.label_en === "No Risk"))!.scale;
    const qs = [{ id: "a", scale: riesgo }, { id: "b", scale: null }];
    expect(scoreAverage({ a: { grade: 4 }, b: { grade: 4 } }, qs, { scale: [] })).toBe(4);
    expect(scoreAverage({ a: { grade: 1 }, b: { grade: 4 } }, qs, { scale: [] })).toBe(2.5);
  });

  it("el guion de arreglo: detecta la de riesgo al revés y la revuelta, la de desempeño revuelta, y la rota; respeta las que ya están bien; traduce los grados por etiqueta", async () => {
    const m = await import("../../../scripts/arregla-escalas-de-preguntas.mjs");
    const n = (value: number, en: string) => ({ value, label_en: en, label_es: en, example_en: "", example_es: "" });
    const alReves = [n(1, "No Risk"), n(2, "Possible"), n(3, "Slightly Affecting"), n(4, "Affecting")];
    const revuelta = [n(1, "Affecting"), n(2, "No Risk"), n(3, "Possible"), n(4, "Slightly Affecting")];
    const bien = [n(1, "Affecting"), n(2, "Slightly Affecting"), n(3, "Possible"), n(4, "No Risk")];
    const desRevuelta = [n(1, "Good"), n(2, "Great"), n(3, "Mediocre"), n(4, "Bad / None")];
    const rota = [n(1, "Worst"), n(2, "Bad"), n(3, "Bad"), n(4, "Worst")];
    expect(m.arregloDe({ scale: alReves })!.mapa).toEqual({ 1: 4, 2: 3, 3: 2, 4: 1 });
    expect(m.arregloDe({ scale: alReves })!.nueva!.map((l: { label_es: string }) => l.label_es)).toEqual(["Afecta", "Afecta levemente", "Posible", "Sin riesgo"]);
    expect(m.arregloDe({ scale: revuelta })!.mapa).toEqual({ 1: 1, 2: 4, 3: 3, 4: 2 });
    expect(m.arregloDe({ scale: bien })).toBeNull();
    expect(m.arregloDe({ scale: desRevuelta })!.mapa).toEqual({ 1: 3, 2: 4, 3: 2, 4: 1 });
    expect(m.arregloDe({ scale: rota })).toEqual({ nueva: null, mapa: null, motivo: "etiquetas rotas → escala global" });
    expect(m.arregloDe({ scale: null })).toBeNull();
    expect(m.arregloDe({ scale: [n(1, "1–3"), n(2, "4–6"), n(3, "7–8"), n(4, "9–10")] })).toBeNull();
    expect(m.desmojibakea("Â¿Tiene una licencia CDL A vigente?")).toBe("¿Tiene una licencia CDL A vigente?");
    expect(m.mojibake("¿Tiene?")).toBe(false);
  });
});
