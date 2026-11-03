import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cambioEnBloqueDeGrupos, filasDePromo, filasDePromoDeGrupos, type DecisionDeGrupo, type ProductoDeCatalogo } from "./tabla";

/**
 * D-810: el admin decide por VARIOS grupos a la vez. El dueño, con la captura de «Deciding for: WES»: «que se pueda
 * elegir múltiple y aprobar o negar por ese mismo grupo así».
 */
const producto = (code: string): ProductoDeCatalogo => ({
  round_id: "R1", code, supplier: "PROV", size: "8X48", description: code, qoh: 1, qoh_by_store: {}, price: 1,
  source_sheet: "TODO", row_no: 1, private: null,
});
const decision = (code: string, group_code: string, status: DecisionDeGrupo["status"]): DecisionDeGrupo =>
  ({ round_id: "R1", code, group_code, status, note: null });
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");

describe("las filas con varios grupos", () => {
  const productos = [producto("A"), producto("B"), producto("C")];
  const decisiones = [
    decision("A", "WES", "approved"), decision("A", "PHR", "approved"),
    decision("B", "WES", "approved"), decision("B", "PHR", "rejected"),
  ];
  it("con UN grupo, lo de siempre (y sin `porGrupo`)", () => {
    expect(filasDePromoDeGrupos(productos, decisiones, ["WES"])).toEqual(filasDePromo(productos, decisiones, "WES"));
  });
  it("si todos dicen lo mismo, ese estado; si no, pendiente y «mezclado» con el detalle", () => {
    const f = filasDePromoDeGrupos(productos, decisiones, ["WES", "PHR"]);
    expect(f.map((x) => [x.code, x.estado, !!x.mezclado])).toEqual([["A", "approved", false], ["B", "pending", true], ["C", "pending", false]]);
    expect(f[1].porGrupo).toEqual({ WES: "approved", PHR: "rejected" });
  });
  it("sin decisión en un grupo cuenta como pendiente: aprobado en uno solo es mezclado", () => {
    const f = filasDePromoDeGrupos([producto("A")], [decision("A", "WES", "approved")], ["WES", "PHR"]);
    expect(f[0]).toMatchObject({ estado: "pending", mezclado: true, porGrupo: { WES: "approved", PHR: "pending" } });
  });
});

describe("escribir en todos los grupos elegidos", () => {
  it("una fila por código y grupo, sin repetir", () => {
    const filas = cambioEnBloqueDeGrupos({ roundId: "R1", grupos: ["WES", "PHR", "WES"], codigos: ["A", "B", "A"], estado: "approved" });
    expect(filas.map((f) => `${f.group_code}:${f.code}:${f.status}`)).toEqual(["WES:A:approved", "WES:B:approved", "PHR:A:approved", "PHR:B:approved"]);
  });
});

describe("la pantalla", () => {
  const src = leer("src/app/promos/[id]/TablaDeRonda.tsx");
  it("elige varios grupos con casillas y escribe en todos", () => {
    expect(src).toContain('<input type="checkbox" data-grupo={g} checked={gruposActivos.includes(g)} onChange={() => alternaGrupo(g)}');
    expect(src).toContain("cambioEnBloqueDeGrupos({ roundId: ronda.id, grupos: gruposActivos, codigos, estado })");
    expect(src).toContain("filasDePromoDeGrupos(productos, decisiones, gruposActivos)");
  });
  it("nunca se queda sin grupo: quitar el último no lo quita", () => {
    expect(src).toContain("gs.includes(g) ? (gs.length > 1 ? gs.filter((x) => x !== g) : gs) : [...gs, g]");
  });
  it("un vendedor sigue decidiendo solo por el suyo", () => {
    expect(src).toContain("const gruposActivos: string[] = esAdmin ? gruposElegidos : grupo ? [grupo] : [];");
  });
});
