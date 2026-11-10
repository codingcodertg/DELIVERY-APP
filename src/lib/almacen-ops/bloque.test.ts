import { describe, it, expect } from "vitest";
import { etapaRequeridaPara, particionaPorEtapa, resumenDeBloque } from "./bloque";
import type { FilaConEtapa } from "./etapas";

const fila = (stage: string, over: Partial<FilaConEtapa> = {}): FilaConEtapa =>
  ({ stage, photos: ["x"], approved_at: null, dumped_at: null, adjusted_at: null, ...over } as FilaConEtapa);

describe("etapaRequeridaPara", () => {
  it("dumped viene de approved; adjusted de dumped", () => {
    expect(etapaRequeridaPara("dumped")).toBe("approved");
    expect(etapaRequeridaPara("adjusted")).toBe("dumped");
  });
  it("documented no tiene previa", () => {
    expect(etapaRequeridaPara("documented")).toBeNull();
  });
});

describe("particionaPorEtapa", () => {
  it("a dumped: solo las aprobadas son elegibles", () => {
    const rs = [fila("approved"), fila("photographed"), fila("approved"), fila("dumped")];
    const { elegibles, omitidos } = particionaPorEtapa(rs, "dumped");
    expect(elegibles).toHaveLength(2);
    expect(omitidos).toHaveLength(2);
  });
  it("a adjusted: solo las desechadas", () => {
    const rs = [fila("dumped"), fila("approved"), fila("adjusted")];
    const { elegibles, omitidos } = particionaPorEtapa(rs, "adjusted");
    expect(elegibles).toHaveLength(1);
    expect(omitidos).toHaveLength(2);
  });
  it("usa la etapa derivada cuando no hay stage escrito", () => {
    const rs = [fila(null as unknown as string, { approved_at: "2026-01-01" })];
    expect(particionaPorEtapa(rs, "dumped").elegibles).toHaveLength(1);
  });
});

describe("resumenDeBloque", () => {
  it("sin omitidas, solo cuenta", () => {
    expect(resumenDeBloque("dumped", 3, 0, "en")).toMatch(/3 marked as/i);
    expect(resumenDeBloque("dumped", 3, 0, "es")).toMatch(/3 marcadas como/i);
  });
  it("con omitidas, explica el porqué (la etapa previa)", () => {
    const es = resumenDeBloque("dumped", 2, 1, "es");
    expect(es).toMatch(/1 omitida/i);
    expect(es.toLowerCase()).toContain("aprobada");
    const en = resumenDeBloque("adjusted", 2, 1, "en");
    expect(en).toMatch(/1 skipped/i);
    expect(en.toLowerCase()).toContain("dumped");
  });
});
