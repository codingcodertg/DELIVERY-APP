import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * D-1187 (2026-11-25). El dueño, en la lista de paradas del Gestor, bajo la FACTURA: «quiero que se miren los po en vez del
 * orden id». La celda la pinta `facturaDeLaParada` (la PO); «Sin asignar», «Todas» y las demás tablas siguen con el ID.
 */

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const PAGINA = "src/app/(app)/routes/page.tsx";

describe("La PO bajo la factura en la lista de paradas del Gestor (D-1187)", () => {
  const pagina = leer(PAGINA);
  const celda = pagina.slice(pagina.indexOf("const facturaDeLaParada = (d: Delivery) => {"), pagina.indexOf("// ---- Las cargas de una orden"));

  it("la página importa el helper y la celda de la parada lo usa para el texto gris y su título", () => {
    expect(pagina).toContain('import { textoBajoLaFactura, tituloDeLaFactura } from "@/lib/po-en-la-factura";');
    expect(celda).toContain("const po = textoBajoLaFactura(d);");
    expect(celda).toContain("const titulo = tituloDeLaFactura(d, codigo, lang === \"es\");");
    expect(celda).toContain("{po && <span data-po-de-la-orden title={titulo}>{po}</span>}");
  });

  it("sin PO no va nada debajo: el ID no se pinta como respaldo, y se queda en el `title` del enlace", () => {
    expect(celda).not.toContain("data-id-de-la-orden");
    expect(celda).not.toContain("n.id");
    expect(celda).toContain("title={n.esFactura && !po ? [gesto.title, titulo].filter(Boolean).join(\" · \") : gesto.title}");
  });

  it("la celda conserva la factura que abre la orden y el estilo de `.factura-e-id`; el texto gris usa la misma clase", () => {
    expect(celda).toContain('<span className="factura-e-id">');
    expect(celda).toContain("<span {...gesto} data-abre-la-orden data-factura={n.esFactura ? \"\" : undefined}");
    expect(celda).toContain("{n.principal}</span>");
    const css = leer("src/app/globals.css");
    expect(css).toContain(".factura-e-id > [data-po-de-la-orden] {");
    expect(css).toContain("font-size: 11px; font-weight: 500; font-family: inherit; color: var(--gray); text-decoration: none;");
  });

  it("las cuatro filas de la tabla de paradas (recogida, entrega, otra carga, ya hecha) usan `facturaDeLaParada`", () => {
    expect(pagina.split("{facturaDeLaParada(").length - 1).toBe(4);
    expect(pagina).toContain("{facturaDeLaParada(x)}{iconoDeReprogramar(x)}");
    expect(pagina).toContain('<td className="ordno">{facturaDeLaParada(d)}{etiquetaDeLaCarga(d)}</td>');
  });

  it("«Sin asignar» y «Todas» siguen con `facturaConSuId`, que sigue pintando el ID al lado de la factura", () => {
    expect(pagina.split("{facturaConSuId(").length - 1).toBe(1);
    expect(pagina).toMatch(/<td key=\{c\.key\} className="ordno">\s*\{facturaConSuId\(d\)\}/);
    const comun = pagina.slice(pagina.indexOf("const facturaConSuId = (d: Delivery) => {"), pagina.indexOf("const facturaDeLaParada = (d: Delivery) => {"));
    expect(comun).toContain("{n.id && <span data-id-de-la-orden title={n.id}>{n.id}</span>}");
    expect(comun).not.toContain("po-en-la-factura");
    expect(comun).not.toContain("data-po-de-la-orden");
  });

  it("las otras tablas y pantallas no leen la PO: siguen enseñando su ID como antes", () => {
    for (const ruta of [
      "src/components/DispatchBoard.tsx",
      "src/components/GanttTimeline.tsx",
      "src/components/PlanDelDia.tsx",
      "src/components/RutaDelPlan.tsx",
      "src/components/FotoDeLaRuta.tsx",
      "src/app/(app)/my-route/page.tsx",
    ]) {
      const fuente = leer(ruta);
      expect(fuente, ruta).not.toContain("po-en-la-factura");
      expect(fuente, ruta).not.toContain("data-po-de-la-orden");
    }
  });
});
