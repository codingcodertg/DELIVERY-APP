import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Reporte } from "@/lib/almacen-ops/datos";
import { filasDeHoja, pendienteDeAprobar } from "@/lib/almacen-ops/etapas";
import { seleccionadasEnGrupo } from "@/lib/almacen-ops/grupos";
import { borrarGrupoDePractica, cargaPractica, conAprobacionDePractica, crearGrupoDePractica, firmarGrupoDePractica } from "./grupos-de-practica";

/**
 * D-1021 (revisión EN PANTALLA de Merma, 12 nov). Lo que se vio roto en el navegador y no tenía prueba:
 * en práctica el grupo no dejaba rastro en la merma (seguía «Fotografiada», dejaba «Iniciar aprobación» otra vez y, ya
 * aprobado, no se podía seguir a desechar); los chips elegidos no se pintaban; la hoja salía con la fecha de mañana.
 */
const almacen = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const rep = (id: string, stage = "photographed") => ({ id, store: "McAllen", stage, approved_at: null, approved_by: null, scrap_group_id: null }) as unknown as Reporte;

describe("la lista refleja los grupos de práctica", () => {
  it("grupo PENDIENTE: la merma queda ligada al grupo → se ve «Pendiente» y avisa «ya está en un grupo»", () => {
    cargaPractica("u-lista-1", almacen());
    const id = crearGrupoDePractica("g", [rep("a")], "Ana");
    const [a, b] = conAprobacionDePractica([rep("a"), rep("b")]);
    expect(a.scrap_group_id).toBe(id);
    expect(a.stage).toBe("photographed");
    expect(pendienteDeAprobar(a)).toBe(true);
    expect(seleccionadasEnGrupo([a, b]).map((r) => r.id)).toEqual(["a"]);
    expect(b.scrap_group_id).toBeNull();
  });
  it("grupo APROBADO (dos firmas): la merma se ve aprobada, con la fecha y el grupo, para seguir a «Desechada»", () => {
    cargaPractica("u-lista-2", almacen());
    const id = crearGrupoDePractica("g", [rep("a")], "Ana");
    firmarGrupoDePractica(id, "gerente", "data:image/png;base64,x", { id: "u1", nombre: "Ana" });
    firmarGrupoDePractica(id, "supervisor", "data:image/png;base64,x", { id: "u2", nombre: "Beto" });
    const [a] = conAprobacionDePractica([rep("a")]);
    expect(a.stage).toBe("approved");
    expect(a.approved_at).toBeTruthy();
    expect(a.scrap_group_id).toBe(id);
  });
  it("no toca lo que ya avanzó ni lo que no está en un grupo; al borrar el grupo, la merma queda libre", () => {
    cargaPractica("u-lista-3", almacen());
    const id = crearGrupoDePractica("g", [rep("a"), rep("d", "dumped")], "Ana");
    const libres = [rep("z")];
    expect(conAprobacionDePractica([rep("d", "dumped")])[0].scrap_group_id).toBeNull();
    expect(conAprobacionDePractica(libres)[0]).toBe(libres[0]);
    borrarGrupoDePractica(id);
    expect(conAprobacionDePractica([rep("a")])[0].scrap_group_id).toBeNull();
  });
});

describe("la hoja de aprobación usa el día de TEXAS", () => {
  it("una merma reportada a las 9 PM de Texas no sale con fecha de mañana (antes: día UTC)", () => {
    const r = { id: "r1", kind: "scrap", store: "McAllen", created_at: "2026-11-13T03:10:00.000Z", broken_on: null, product_sku: "X", product_name: "Y", total_loss: 1, reason: null, broken_by: [], scrap_type: null, total_pieces: 1 };
    const [f] = filasDeHoja([r] as unknown as Parameters<typeof filasDeHoja>[0], () => "", () => "", () => 1);
    expect(f.dia).toBe("2026-11-12");
  });
});

describe("el chip elegido se pinta (operaciones.css)", () => {
  const css = readFileSync("src/app/operaciones/operaciones.css", "utf8");
  const tsx = ["ListaDeReportes.tsx", "Asistente.tsx", "HojaDeGrupo.tsx"].map((f) => readFileSync(`src/app/operaciones/${f}`, "utf8")).join("\n");
  it("Operaciones marca el chip elegido con `active`, y esa clase tiene estilo", () => {
    expect(tsx).toMatch(/chip\$\{[^}]*" active"/);
    expect(css).toMatch(/^\.chip\.active \{[^}]*background: var\(--text\)/m);
  });
  it("el botón sin variante no queda como texto suelto, y en el teléfono lo que se toca mide 44 px", () => {
    expect(css).toMatch(/\.ops \.btn:not\(\.btn-primary\):not\(\.btn-ghost\):not\(\.btn-danger\) \{[^}]*box-shadow/);
    expect(css).toMatch(/\.ops \.btn, \.ops \.ops-busca-merma, \.ops \.ops-filtro-tienda \{ min-height: 44px; \}/);
  });
});
