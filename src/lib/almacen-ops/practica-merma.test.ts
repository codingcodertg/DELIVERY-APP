import { describe, it, expect } from "vitest";
import { esCorteDePractica, CorteDePractica } from "@/lib/practica/es-corte";
import { cambiarEtapa, firmarMerma, editarReporteDeMerma, crearGrupoDeMerma, registrar, type Envio } from "./datos";

// Un cliente de Supabase de mentira: la RPC/upload devuelve lo que la prueba diga.
function sbFalso(resultado: { data?: unknown; error?: unknown }) {
  return {
    rpc: async () => resultado,
    storage: { from: () => ({ upload: async () => resultado }) },
  } as unknown as Parameters<typeof cambiarEtapa>[0];
}
const CORTE = { code: "ENSENANZA", message: "En práctica no se guarda." };
const OTRO = { code: "42501", message: "sin acceso" };

describe("esCorteDePractica", () => {
  it("reconoce ENSENANZA y CAPACITACION, no otros", () => {
    expect(esCorteDePractica({ code: "ENSENANZA" })).toBe(true);
    expect(esCorteDePractica({ code: "CAPACITACION" })).toBe(true);
    expect(esCorteDePractica(new CorteDePractica())).toBe(true);
    expect(esCorteDePractica({ code: "42501" })).toBe(false);
    expect(esCorteDePractica(null)).toBe(false);
    expect(esCorteDePractica(new Error("x"))).toBe(false);
  });
});

describe("merma: el corte de práctica se traga (no rompe)", () => {
  it("cambiarEtapa con corte NO lanza (corre la UI optimista)", async () => {
    await expect(cambiarEtapa(sbFalso({ error: CORTE }), "r1", "approved")).resolves.toBeUndefined();
  });
  it("firmarMerma con corte NO lanza", async () => {
    await expect(firmarMerma(sbFalso({ error: CORTE }), "r1", "gerente", "data:image/png;base64,x")).resolves.toBeUndefined();
  });
  it("editarReporteDeMerma con corte NO lanza", async () => {
    await expect(editarReporteDeMerma(sbFalso({ error: CORTE }), "r1", { reason: "x" })).resolves.toBeUndefined();
  });
  it("un error REAL sí lanza (no se traga)", async () => {
    await expect(cambiarEtapa(sbFalso({ error: OTRO }), "r1", "approved")).rejects.toBeTruthy();
  });
  it("crearGrupoDeMerma con corte lanza CorteDePractica (el caller lo trata suave)", async () => {
    await expect(crearGrupoDeMerma(sbFalso({ error: CORTE }), "grupo", ["r1"])).rejects.toSatisfy((e: unknown) => esCorteDePractica(e));
  });
  it("registrar con corte lanza CorteDePractica", async () => {
    await expect(registrar(sbFalso({ error: CORTE }), { kind: "scrap", store: "A", subjectIds: [], answers: {}, photos: [], scrap: null } as Envio))
      .rejects.toSatisfy((e: unknown) => esCorteDePractica(e));
  });
});
