import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** D-792: cambiar de pestaña (GOV Pool, STXP Pool, admin) deja los filtros como al entrar. */
const p = readFileSync(join(process.cwd(), "src/app/leads/Leads.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("los filtros se resetean al cambiar de pool", () => {
  it("las pestañas pasan por cambiaPestana, y ninguna por setPestana a secas", () => {
    for (const k of ["banco", "admin"]) expect(p).toContain(`data-pestana="${k}" onClick={() => cambiaPestana("${k}")}>`);
    expect(p.match(/onClick=\{\(\) => setPestana\(/g)).toBeNull();
  });
  it("y cambiaPestana llama a limpiaFiltros, que vacía todo: categoría («todas»), etapa, categoría buena, tipo, ciudad, búsqueda y «coinciden»", () => {
    const i = p.indexOf("const limpiaFiltros = ");
    const cuerpo = p.slice(i, p.indexOf("};", i));
    for (const s of ['setCategoria("todas")', 'setEtapa("")', "setBuena(false)", 'setTipo("")', 'setCiudad("")', 'setBusca("")', "setCoinciden(false)"]) expect(cuerpo).toContain(s);
    const j = p.indexOf("const cambiaPestana = ");
    expect(p.slice(j, p.indexOf("};", j))).toContain("limpiaFiltros();");
  });
  it("el botón «Quitar filtros» (D-798) llama a lo mismo", () => {
    expect(p).toContain("data-quitar-filtros onClick={limpiaFiltros}");
  });
  it("ya no hay pestaña «Mi pool», ni vista Libres/Todas, ni filtro de última acción aparte: las etapas son el filtro", () => {
    expect(p).not.toContain('data-pestana="mio"');
    expect(p).not.toContain("data-vista");
    expect(p).not.toContain("SelectAccion");
    expect(p).toContain("data-etapa={e}");
  });
});
