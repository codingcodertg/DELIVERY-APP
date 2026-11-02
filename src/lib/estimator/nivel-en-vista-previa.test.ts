import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** El nivel de detalle para el cliente se elige en la vista previa, con la hoja a la vista y en vivo (D-775). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("el nivel de detalle", () => {
  const e = sinComentarios(leer("src/app/estimator/Estimador.tsx"));
  it("está UNA vez, dentro de la vista previa (después de la barra de Imprimir) y antes de la hoja; ya no en la tarjeta «Copia del cliente»", () => {
    expect(e.split('data-nivel-de-detalle')).toHaveLength(2);
    const vista = e.indexOf("data-vista-previa");
    const nivel = e.indexOf("data-nivel-de-detalle");
    const hoja = e.indexOf("<HojaCliente hoja={hoja} />");
    expect(vista).toBeGreaterThan(0);
    expect(nivel).toBeGreaterThan(e.indexOf("data-imprimir"));
    expect(nivel).toBeLessThan(hoja);
    const tarjeta = e.slice(e.indexOf('t("Customer copy", "Copia del cliente")'), vista);
    expect(tarjeta).not.toContain('name="nivel"');
  });
  it("cambia el borrador (set display_level), del que sale la hoja: cambia en vivo", () => {
    expect(e).toContain('onChange={() => set("display_level", k)}');
    expect(e).toContain("const hoja = useMemo(() => hojaDelCliente(draft, tiendaHoja, idiomaDeLaHoja), [draft, tiendaHoja, idiomaDeLaHoja]);");
  });
  it("al imprimir no sale: solo la hoja es visible", () => {
    const css = leer("src/app/estimator/estimator.css");
    expect(css).toContain("body * { visibility: hidden !important; }");
    expect(css).toContain(".hoja-cliente, .hoja-cliente * { visibility: visible !important; }");
    expect(css).toContain(".est-vista-previa .est-radios label { background: #fff; }");
  });
});
