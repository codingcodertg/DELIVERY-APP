import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** En el Quote Builder, el campo «Tienda (sale en la cotización)» solo lo ve el admin (D-771). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("el campo de la tienda", () => {
  const e = sinComentarios(leer("src/app/estimator/Estimador.tsx"));
  it("va dentro de «me.admin &&»; la hoja del cliente sigue llevando la tienda del perfil", () => {
    const i = e.indexOf('{t("Store (printed on the quote)", "Tienda (sale en la cotización)")}');
    expect(i).toBeGreaterThan(0);
    const antes = e.slice(e.lastIndexOf("{me.admin && (", i), i);
    expect(antes).toContain("{me.admin && (");
    expect(antes).not.toContain(")}");
    expect(e).toContain("const hoja = useMemo(() => hojaDelCliente(draft, tiendaHoja, idiomaDeLaHoja), [draft, tiendaHoja, idiomaDeLaHoja]);");
  });
});
