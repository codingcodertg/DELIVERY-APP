import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** D-792: cambiar de pestaña (GOV Pool, Mi pool, STXP Pool, admin) deja los filtros como al entrar. */
const p = readFileSync(join(process.cwd(), "src/app/leads/Leads.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("los filtros se resetean al cambiar de pool", () => {
  it("las cuatro pestañas pasan por cambiaPestana, y ninguna por setPestana a secas", () => {
    for (const k of ["banco", "mio", "admin", "privado"]) expect(p).toContain(`data-pestana="${k}" onClick={() => cambiaPestana("${k}")}>`);
    expect(p.match(/onClick=\{\(\) => setPestana\(/g)).toBeNull();
  });
  it("y cambiaPestana vacía todos los filtros: vista, categoría, situación, tipo, ciudad, búsqueda y «coinciden»", () => {
    const i = p.indexOf("const cambiaPestana = ");
    const cuerpo = p.slice(i, p.indexOf("};", i));
    for (const s of ['setVista("libres")', 'setCategoria("utiles")', 'setSituacion("")', 'setTipo("")', 'setCiudad("")', 'setBusca("")', "setCoinciden(false)"]) expect(cuerpo).toContain(s);
  });
});
