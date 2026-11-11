import { describe, expect, it } from "vitest";
import { gruposPendientesDeMiFirma, slotsQueMeTocan } from "./grupos";

const firma = (slot: "gerente" | "supervisor") => ({ slot, signer_id: "x", signer_name: "X", signed_at: "2026-11-10T00:00:00Z" });
const g = (id: string, store: string, firmas: ReturnType<typeof firma>[], aprobado: string | null = null) =>
  ({ id, store, firmas, approved_at: aprobado, created_at: `2026-11-10T0${id.length}:00:00Z` });
const grupos = [
  g("a", "RDZ Pharr", []),
  g("bb", "RDZ Pharr", [firma("supervisor")]),
  g("ccc", "RDZ Pharr", [firma("gerente")]),
  g("dddd", "RDZ McAllen", []),
  g("eeeee", "RDZ Pharr", [firma("gerente"), firma("supervisor")], "2026-11-10T09:00:00Z"),
];

describe("292: lo que está pendiente de MI firma", () => {
  it("cada quien mira su espacio", () => {
    expect(slotsQueMeTocan({ role: "warehouse", permissions: ["warehouse_ops_supervisor"] })).toEqual(["supervisor"]);
    expect(slotsQueMeTocan({ role: "manager" })).toEqual(["gerente"]);
    expect(slotsQueMeTocan({ role: "admin" })).toEqual(["gerente", "supervisor"]);
    expect(slotsQueMeTocan({ role: "sales" })).toEqual([]);
  });
  it("el supervisor de almacén ve los de su tienda sin su firma; no los aprobados ni los de otra tienda", () => {
    const sup = { role: "warehouse", store: "RDZ Pharr", permissions: ["warehouse_ops_supervisor"] };
    expect(gruposPendientesDeMiFirma(grupos, sup).map((x) => x.id)).toEqual(["a", "ccc"]);
  });
  it("el gerente ve los que no tienen la firma de gerente", () => {
    expect(gruposPendientesDeMiFirma(grupos, { role: "manager", store: "RDZ Pharr" }).map((x) => x.id)).toEqual(["a", "bb"]);
  });
});
