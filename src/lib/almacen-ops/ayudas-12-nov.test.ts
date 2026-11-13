import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coincideBusqueda, normalizaBusqueda } from "./busqueda-de-merma";
import { alternaColumnaDeHoja, normalizaOcultasDeHoja, tramoDelTotal } from "./columnas-de-hoja";
import { puedeBorrarMerma } from "./etapas";

/** Ayudas del 12 nov en Operaciones → Reportes → Merma (Roberto y Rosa). */
describe("búsqueda de la tabla de merma", () => {
  it("sin acentos ni mayúsculas, y cada palabra en algún campo", () => {
    expect(normalizaBusqueda("  Marmól  FORLI ")).toBe("marmol forli");
    expect(coincideBusqueda(["MARMOL FORLI SAND (M) 24X24", "Baudelio Sepeda"], "forli baudelio")).toBe(true);
    expect(coincideBusqueda(["MARMOL FORLI SAND (M) 24X24", "Baudelio Sepeda"], "forli rosa")).toBe(false);
    expect(coincideBusqueda(["Devolución de cliente"], "devolucion")).toBe(true);
    expect(coincideBusqueda(["x"], "   ")).toBe(true);
  });
});

describe("columnas de la hoja de aprobación", () => {
  it("se ocultan y vuelven; lo guardado raro se ignora", () => {
    expect(alternaColumnaDeHoja([], "rompio")).toEqual(["rompio"]);
    expect(alternaColumnaDeHoja(["rompio"], "rompio")).toEqual([]);
    expect(normalizaOcultasDeHoja(["rompio", "x", "rompio", 3])).toEqual(["rompio"]);
    expect(normalizaOcultasDeHoja(null)).toEqual([]);
  });
  it("el pie «Total» va bajo «Pérdida»; sin ella, en su propia fila", () => {
    expect(tramoDelTotal([], 1)).toEqual({ antes: 5, despues: 3 });
    expect(tramoDelTotal(["folio", "rompio"], 1)).toEqual({ antes: 4, despues: 2 });
    expect(tramoDelTotal(["perdida"], 1)).toBeNull();
  });
});

describe("borrar un reporte: admin y gerente (299)", () => {
  const r = { kind: "scrap" as const, store: "RDZ Pharr" };
  const q = (o: object) => ({ id: "u", full_name: "x", role: "manager", store: "RDZ Pharr", visible_stores: null, permissions: [], module_access: ["warehouse_ops"], warehouse_ops_role: null, ...o }) as never;
  it("gerente de su tienda sí; de otra no; supervisor no; admin sí", () => {
    expect(puedeBorrarMerma(q({}), r)).toBe(true);
    expect(puedeBorrarMerma(q({ store: "RDZ McAllen" }), r)).toBe(false);
    expect(puedeBorrarMerma(q({ role: "warehouse", warehouse_ops_role: "full", permissions: ["warehouse_ops_supervisor"] }), r)).toBe(false);
    expect(puedeBorrarMerma(q({ role: "admin" }), r)).toBe(true);
  });
  it("la migración 299 cambia solo la puerta y conserva las salvaguardas de la 297", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/299_merma_gerente_borra_reporte.sql"), "utf8");
    expect(sql).toContain("public.warehouse_ops_can_start_approval(r.store)");
    expect(sql).toContain("primero deshaz la aprobacion");
    expect(sql).toContain("x.adjustment_proof = f");
  });
});
