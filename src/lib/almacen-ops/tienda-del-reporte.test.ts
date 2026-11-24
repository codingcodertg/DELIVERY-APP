import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-1147 (ayuda de Roberto, 2026-11-24: «Will need a filter per store»): el filtro por tienda de «Todos los reportes →
// Merma» va junto al rango y manda sobre las cifras, la lista y los grupos.
describe("Reportes → Merma: filtro por tienda arriba (D-1147)", () => {
  const src = readFileSync("src/app/operaciones/ListaDeReportes.tsx", "utf8").replace(/\r\n/g, "\n");
  it("la merma se filtra por la tienda elegida ANTES de sumar: cifras, etapas, lista y exportación la siguen", () => {
    expect(src).toContain('propias.filter((r) => r.kind === "scrap" && (tiendaElegida === "" || r.store === tiendaElegida))');
    // Todo lo demás sale de `mermas`: los totales y lo del rango.
    expect(src).toContain("const mermasDeDinero = useMemo(() => sinRechazadas(mermas), [mermas]);");
    expect(src).toContain("const mermasEnRango = useMemo(() => (rango ? filtrarPorRango(mermas, rango) : []), [mermas, rango]);");
  });
  it("los grupos de aprobación también son solo los de esa tienda", () => {
    expect(src).toContain('filtrarGrupos(tiendaElegida === "" ? grupos : grupos.filter((g) => g.store === tiendaElegida), estadoGrupos, rango, verTodosGrupos)');
  });
  it("sale junto al rango, en merma y en conteos (D-1148), y solo con más de una tienda; una tienda que ya no está no filtra", () => {
    expect(src).toContain('{(pestana === "merma" || pestana === "conteos") && tiendasDelFiltro.length > 1 && (');
    expect(src).toContain("data-tienda-del-reporte");
    expect(src).toContain('const tiendaElegida = tiendasDelFiltro.length > 1 && tiendasDelFiltro.includes(tiendaDelReporte) ? tiendaDelReporte : "";');
  });
});
