import { describe, expect, it } from "vitest";
import { estadoDelGrupo, grupoAprobado, grupoRequiereFirma, puedeAprobarGrupo, type GrupoDeMerma } from "./grupos";
import type { FirmaDeMerma } from "./firmas";

const firma = (slot: "gerente" | "supervisor", signer_id: string): FirmaDeMerma => ({ slot, signer_id, signer_name: signer_id, signed_at: "2026-11-10T00:00:00Z" });

const grupo = (over: Partial<GrupoDeMerma>): GrupoDeMerma => ({
  id: "g1", name: "Grupo", store: "RDZ Pharr", created_by_name: "Ana", created_at: "2026-11-10T00:00:00Z",
  approved_at: null, approved_by: null, firmas: [], ...over,
});

describe("grupos de aprobación de merma", () => {
  it("sin firmas: requiere firma, no se puede aprobar", () => {
    const g = grupo({ firmas: [] });
    expect(grupoRequiereFirma(g)).toBe(true);
    expect(puedeAprobarGrupo(g)).toBe(false);
    expect(grupoAprobado(g)).toBe(false);
  });

  it("solo una firma: sigue pendiente", () => {
    const g = grupo({ firmas: [firma("gerente", "a")] });
    expect(grupoRequiereFirma(g)).toBe(true);
    expect(puedeAprobarGrupo(g)).toBe(false);
  });

  it("dos firmas de la MISMA persona: no basta", () => {
    const g = grupo({ firmas: [firma("gerente", "a"), firma("supervisor", "a")] });
    expect(puedeAprobarGrupo(g)).toBe(false);
    expect(grupoRequiereFirma(g)).toBe(true);
  });

  it("dos firmas de personas distintas: se puede aprobar", () => {
    const g = grupo({ firmas: [firma("gerente", "a"), firma("supervisor", "b")] });
    expect(puedeAprobarGrupo(g)).toBe(true);
    expect(grupoRequiereFirma(g)).toBe(false);
  });

  it("ya aprobado: ni requiere firma ni se vuelve a aprobar", () => {
    const g = grupo({ approved_at: "2026-11-10T01:00:00Z", approved_by: "a", firmas: [firma("gerente", "a"), firma("supervisor", "b")] });
    expect(grupoAprobado(g)).toBe(true);
    expect(grupoRequiereFirma(g)).toBe(false);
    expect(puedeAprobarGrupo(g)).toBe(false);
  });

  it("estadoDelGrupo: aprobado / listo / pendiente", () => {
    expect(estadoDelGrupo(grupo({ approved_at: "2026-11-10T01:00:00Z" }), "es")).toBe("Aprobado");
    expect(estadoDelGrupo(grupo({ approved_at: "2026-11-10T01:00:00Z" }), "en")).toBe("Approved");
    expect(estadoDelGrupo(grupo({ firmas: [firma("gerente", "a"), firma("supervisor", "b")] }), "es")).toBe("Listo para aprobar");
    expect(estadoDelGrupo(grupo({ firmas: [firma("gerente", "a")] }), "es")).toBe("Pendiente: firma del supervisor");
    expect(estadoDelGrupo(grupo({ firmas: [] }), "en")).toBe("Pending signature (manager and supervisor)");
  });
});
