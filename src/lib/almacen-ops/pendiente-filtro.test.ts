import { describe, expect, it } from "vitest";
import { ETAPAS_VISIBLES, etapaVisible, nombreDeEtapaVisible, pendienteDeAprobar } from "./etapas";

const base = { kind: "scrap", photos: [], approved_at: null, dumped_at: null, adjusted_at: null } as const;

describe("«⏳ Pendiente» = en un grupo y sin aprobar (Roberto, 11 nov)", () => {
  it("solo las que YA tienen grupo y no están aprobadas", () => {
    expect(pendienteDeAprobar({ ...base, stage: "photographed", scrap_group_id: "g1" } as never)).toBe(true);
    expect(pendienteDeAprobar({ ...base, stage: "documented", scrap_group_id: "g1" } as never)).toBe(true);
    // Sin grupo NO es pendiente: sigue siendo documentada o fotografiada.
    expect(pendienteDeAprobar({ ...base, stage: "photographed" } as never)).toBe(false);
    expect(pendienteDeAprobar({ ...base, stage: "documented" } as never)).toBe(false);
    // Aprobada (o después) ya no es pendiente aunque esté en un grupo.
    expect(pendienteDeAprobar({ ...base, stage: "approved", scrap_group_id: "g1" } as never)).toBe(false);
    expect(pendienteDeAprobar({ ...base, stage: "dumped", scrap_group_id: "g1" } as never)).toBe(false);
  });
  it("modo enseñanza: un grupo de práctica cuenta por id (no trae scrap_group_id)", () => {
    expect(pendienteDeAprobar({ ...base, id: "r1", stage: "photographed" } as never, new Set(["r1"]))).toBe(true);
    expect(pendienteDeAprobar({ ...base, id: "r2", stage: "photographed" } as never, new Set(["r1"]))).toBe(false);
  });
  it("la etapa visible va entre fotografiada y aprobada", () => {
    expect(ETAPAS_VISIBLES.indexOf("pending")).toBe(ETAPAS_VISIBLES.indexOf("photographed") + 1);
    expect(ETAPAS_VISIBLES.indexOf("approved")).toBe(ETAPAS_VISIBLES.indexOf("pending") + 1);
    expect(etapaVisible({ ...base, stage: "photographed", scrap_group_id: "g" } as never)).toBe("pending");
    expect(etapaVisible({ ...base, stage: "photographed" } as never)).toBe("photographed");
    expect(nombreDeEtapaVisible("pending", "es")).toBe("Pendiente");
    expect(nombreDeEtapaVisible("pending", "en")).toBe("Pending");
  });
});
