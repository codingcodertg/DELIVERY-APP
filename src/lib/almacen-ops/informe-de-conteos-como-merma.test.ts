import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// D-1148 (ayuda de Roberto, 2026-11-24: «Need this page to look like the scrap report page. Needs to be consistent in
// design»): el informe de conteos usa las mismas piezas que el de merma.
describe("Reportes → Conteos se ve como Reportes → Merma (D-1148)", () => {
  const informe = readFileSync("src/app/operaciones/InformeDeConteos.tsx", "utf8").replace(/\r\n/g, "\n");
  const lista = readFileSync("src/app/operaciones/ListaDeReportes.tsx", "utf8").replace(/\r\n/g, "\n");
  it("el renglón de arriba es el de la merma: pestañas, rango y tienda (ya no hay un selector de mes aparte)", () => {
    expect(lista).toContain("{selectorDeRango}\n          <InformeDeConteos ctx={ctx} tiendas={tiendasDeConteos} rango={rango} etiqueta={etiqueta} />");
    expect(informe).not.toContain("data-fila-mes");
    expect(informe).not.toContain("mesVecino");
  });
  it("cuatro tarjetas con la cifra ARRIBA y el rótulo debajo, en la misma rejilla", () => {
    const tarjetas = informe.slice(informe.indexOf("data-kpi-conteos"), informe.indexOf("Counts in this range"));
    expect(tarjetas.split('<div className={`ops-merma-total').length - 1 + tarjetas.split('<div className="ops-merma-total">').length - 1).toBe(4);
    expect(tarjetas).not.toContain("ops-informe-principal");
    // En cada tarjeta, la cifra va antes que su rótulo.
    expect(tarjetas.indexOf("data-faltan-cajas-total")).toBeLessThan(tarjetas.indexOf("Boxes missing"));
    expect(tarjetas.indexOf("data-neto-usd")).toBeLessThan(tarjetas.indexOf('t("Net $"'));
  });
  it("las etapas son chips con su cuenta y filtran la tabla; la tabla trae buscador", () => {
    expect(informe).toContain('className="filters-oneline ops-filtros"');
    expect(informe).toContain("{ETAPAS_DE_CONTEO.map((e) => (");
    expect(informe).toContain('filas={aLaVista}');
    expect(informe).toContain('className="ops-busca-merma"');
  });
  it("un rango abierto no limita, y sin rango válido no se enseña ninguna cifra", () => {
    expect(informe).toContain('desde: rango?.desde || "0000-01-01", hasta: rango?.hasta || "9999-12-31"');
    expect(informe).toContain("{datos && rango && (");
  });
});
