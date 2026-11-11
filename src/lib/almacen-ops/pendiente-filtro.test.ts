import { describe, expect, it } from "vitest";
import { pendienteDeAprobar } from "./etapas";

const base = { kind: "scrap", photos: [], approved_at: null, dumped_at: null, adjusted_at: null } as const;

describe("chip «⏳ Pendiente» de la merma", () => {
  it("documentada y fotografiada (con o sin grupo) son pendientes; aprobada, desechada y ajustada no", () => {
    expect(pendienteDeAprobar({ ...base, stage: "documented" } as never)).toBe(true);
    expect(pendienteDeAprobar({ ...base, stage: "photographed", scrap_group_id: "g1" } as never)).toBe(true);
    expect(pendienteDeAprobar({ ...base, stage: "approved" } as never)).toBe(false);
    expect(pendienteDeAprobar({ ...base, stage: "dumped" } as never)).toBe(false);
    expect(pendienteDeAprobar({ ...base, stage: "adjusted" } as never)).toBe(false);
  });
});
