import { describe, expect, it } from "vitest";
import { corte, enLotes, resumen, rutasVencidas, RETENCION_DIAS } from "./purga-atrasada.mjs";

// Los helpers puros del one-off de purga atrasada. Sin red: el script solo corre como programa (no al importarlo).

const DIA = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 3, 0, 0);

describe("corte", () => {
  it("son 14 días hacia atrás por defecto", () => {
    expect(RETENCION_DIAS).toBe(14);
    expect(corte(NOW)).toBe(NOW - 14 * DIA);
  });
});

describe("rutasVencidas", () => {
  const corteMs = corte(NOW);
  const obj = (path, diasAtras, created_at = new Date(NOW - diasAtras * DIA).toISOString()) => ({ path, created_at, size: 1 });

  it("devuelve solo los archivos tomados ANTES del corte", () => {
    const objetos = [obj("a/1.jpg", 20), obj("a/2.jpg", 15), obj("a/3.jpg", 2)];
    expect(rutasVencidas(objetos, corteMs).map((o) => o.path)).toEqual(["a/1.jpg", "a/2.jpg"]);
  });

  it("un archivo justo en el corte no vence (la comparación es estricta) y uno un ms antes sí", () => {
    const enCorte = obj("x/exacto.jpg", 0, new Date(corteMs).toISOString());
    const unMsAntes = obj("x/antes.jpg", 0, new Date(corteMs - 1).toISOString());
    expect(rutasVencidas([enCorte, unMsAntes], corteMs).map((o) => o.path)).toEqual(["x/antes.jpg"]);
  });

  it("un objeto sin fecha no se borra por accidente", () => {
    expect(rutasVencidas([{ path: "x/sin.jpg", created_at: undefined, size: 1 }], corteMs)).toEqual([]);
    expect(rutasVencidas([{ path: "x/nula.jpg", created_at: null, size: 1 }], corteMs)).toEqual([]);
  });
});

describe("resumen", () => {
  it("cuenta, suma bytes y da el más viejo y el más nuevo", () => {
    const r = resumen([
      { path: "a", created_at: "2026-08-20T10:00:00.000Z", size: 100 },
      { path: "b", created_at: "2026-09-01T10:00:00.000Z", size: 250 },
      { path: "c", created_at: "2026-08-25T10:00:00.000Z", size: "50" },
    ]);
    expect(r).toEqual({
      n: 3,
      bytes: 400,
      masViejo: "2026-08-20T10:00:00.000Z",
      masNuevo: "2026-09-01T10:00:00.000Z",
    });
  });

  it("vacío: cero, sin fechas", () => {
    expect(resumen([])).toEqual({ n: 0, bytes: 0, masViejo: null, masNuevo: null });
  });
});

describe("enLotes", () => {
  it("parte en lotes de 100 con el resto al final", () => {
    const lotes = enLotes(Array.from({ length: 250 }, (_, i) => i), 100);
    expect(lotes.map((l) => l.length)).toEqual([100, 100, 50]);
    expect(lotes[2][0]).toBe(200);
  });
});
