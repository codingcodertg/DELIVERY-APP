import { describe, it, expect } from "vitest";
import {
  SLOTS_DE_FIRMA, esSlotDeFirma, firmaDe, slotFirmado, firmasFaltantes, tieneAmbasFirmas, puedeFirmarSlot,
  requiereFirma, puedeAprobar, mensajePendienteDeFirma, firmaValida, soloEnRevision, type FirmaDeMerma,
} from "./firmas";

const f = (slot: "gerente" | "supervisor", signer_id: string): FirmaDeMerma => ({ slot, signer_id, signer_name: signer_id, signed_at: "2026-11-10T12:00:00Z" });

// Una merma fotografiada (con foto, sin aprobar) con las firmas dadas.
const merma = (firmas: FirmaDeMerma[]) => ({ kind: "scrap" as const, created_at: "2026-11-10T00:00:00Z", photos: ["a.jpg"], stage: "photographed" as string | null, firmas });

describe("slots de firma", () => {
  it("son gerente y supervisor, en ese orden", () => {
    expect([...SLOTS_DE_FIRMA]).toEqual(["gerente", "supervisor"]);
    expect(esSlotDeFirma("gerente")).toBe(true);
    expect(esSlotDeFirma("otro")).toBe(false);
  });
});

describe("firmaDe / slotFirmado / firmasFaltantes", () => {
  it("encuentra la firma de un slot y lista las que faltan", () => {
    const firmas = [f("gerente", "u1")];
    expect(firmaDe(firmas, "gerente")?.signer_id).toBe("u1");
    expect(firmaDe(firmas, "supervisor")).toBeUndefined();
    expect(slotFirmado(firmas, "gerente")).toBe(true);
    expect(slotFirmado(firmas, "supervisor")).toBe(false);
    expect(firmasFaltantes(firmas)).toEqual(["supervisor"]);
    expect(firmasFaltantes([])).toEqual(["gerente", "supervisor"]);
    expect(firmasFaltantes([f("gerente", "u1"), f("supervisor", "u2")])).toEqual([]);
  });
});

describe("tieneAmbasFirmas: dos firmas de personas distintas", () => {
  it("con las dos, de distintas personas → true", () => {
    expect(tieneAmbasFirmas([f("gerente", "u1"), f("supervisor", "u2")])).toBe(true);
  });
  it("falta una → false", () => {
    expect(tieneAmbasFirmas([f("gerente", "u1")])).toBe(false);
    expect(tieneAmbasFirmas([])).toBe(false);
  });
  it("las dos pero de la MISMA persona → false", () => {
    expect(tieneAmbasFirmas([f("gerente", "u1"), f("supervisor", "u1")])).toBe(false);
  });
  it("sin signer_id → false", () => {
    expect(tieneAmbasFirmas([{ ...f("gerente", "u1"), signer_id: null }, f("supervisor", "u2")])).toBe(false);
  });
});

describe("puedeFirmarSlot: distinto firmante y sin pisar", () => {
  it("slot libre, no firmó el otro → sí", () => {
    expect(puedeFirmarSlot([], "gerente", "u1")).toBe(true);
    expect(puedeFirmarSlot([f("gerente", "u1")], "supervisor", "u2")).toBe(true);
  });
  it("si ya firmó el OTRO slot, no puede firmar este (dos personas distintas)", () => {
    expect(puedeFirmarSlot([f("gerente", "u1")], "supervisor", "u1")).toBe(false);
  });
  it("no puede pisar la firma de otra persona en el mismo slot, pero sí re-firmar la suya", () => {
    expect(puedeFirmarSlot([f("gerente", "u2")], "gerente", "u1")).toBe(false);
    expect(puedeFirmarSlot([f("gerente", "u1")], "gerente", "u1")).toBe(true);
  });
});

describe("requiereFirma / puedeAprobar / En revisión", () => {
  it("fotografiada sin las dos firmas → requiere firma, no se puede aprobar", () => {
    const r = merma([f("gerente", "u1")]);
    expect(requiereFirma(r)).toBe(true);
    expect(puedeAprobar(r)).toBe(false);
  });
  it("fotografiada con las dos firmas distintas → ya no requiere, se puede aprobar", () => {
    const r = merma([f("gerente", "u1"), f("supervisor", "u2")]);
    expect(requiereFirma(r)).toBe(false);
    expect(puedeAprobar(r)).toBe(true);
  });
  it("documentada (sin foto) no entra a revisión todavía", () => {
    const r = { kind: "scrap" as const, created_at: "x", photos: [], stage: "documented" as string | null, firmas: [] };
    expect(requiereFirma(r)).toBe(false);
    expect(puedeAprobar(r)).toBe(false);
  });
  it("ya aprobada no requiere firma ni es aprobable de nuevo", () => {
    const r = { kind: "scrap" as const, created_at: "x", photos: ["a.jpg"], stage: "approved" as string | null, approved_at: "2026-11-10", firmas: [f("gerente", "u1"), f("supervisor", "u2")] };
    expect(requiereFirma(r)).toBe(false);
    expect(puedeAprobar(r)).toBe(false);
  });
  it("lo que no es merma nunca requiere firma", () => {
    const r = { kind: "safety" as unknown as "scrap", created_at: "x", photos: [], stage: null, firmas: [] };
    expect(requiereFirma(r)).toBe(false);
  });
  it("soloEnRevision filtra las que requieren firma", () => {
    const a = { ...merma([f("gerente", "u1")]), id: "a" };
    const b = { ...merma([f("gerente", "u1"), f("supervisor", "u2")]), id: "b" };
    expect(soloEnRevision([a, b]).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("mensajePendienteDeFirma", () => {
  it("dice qué firma falta, bilingüe", () => {
    const soloGerente = merma([f("gerente", "u1")]);
    expect(mensajePendienteDeFirma(soloGerente, "es")).toBe("Pendiente: firma del supervisor");
    expect(mensajePendienteDeFirma(soloGerente, "en")).toBe("Pending: supervisor signature");
    const ninguna = merma([]);
    expect(mensajePendienteDeFirma(ninguna, "es")).toBe("Pendiente de firma (gerente y supervisor)");
    expect(mensajePendienteDeFirma(ninguna, "en")).toBe("Pending signature (manager and supervisor)");
  });
  it("sin pendiente → null", () => {
    expect(mensajePendienteDeFirma(merma([f("gerente", "u1"), f("supervisor", "u2")]), "es")).toBeNull();
  });
});

describe("firmaValida", () => {
  it("acepta un data URL de imagen y rechaza lo vacío", () => {
    expect(firmaValida("data:image/png;base64,AAAA")).toBe(true);
    expect(firmaValida("")).toBe(false);
    expect(firmaValida(null)).toBe(false);
    expect(firmaValida("hola")).toBe(false);
  });
});
