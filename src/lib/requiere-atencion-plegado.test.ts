import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** «Requiere atención» del Panel nace plegado: solo un botón con la cuenta; «Ocultar» lo vuelve a plegar (D-NEXT). */
const fuente = readFileSync(join(process.cwd(), "src/components/AttentionPanel.tsx"), "utf8").split("\r\n").join("\n");

describe("requiere atención plegado", () => {
  it("nace cerrado y sin nada que avisar no pinta nada", () => {
    expect(fuente).toContain("const [abierto, setAbierto] = useState(false);");
    expect(fuente).toContain("if (!items.length) return null;");
    expect(fuente).not.toContain("dismissed");
  });
  it("cerrado: un botón con la cuenta que lo abre; abierto: «Ocultar» lo cierra en vez de borrarlo", () => {
    const cerrado = fuente.indexOf("if (!abierto) {");
    expect(cerrado).toBeGreaterThan(0);
    expect(fuente.slice(cerrado)).toContain("data-abrir-atencion onClick={() => setAbierto(true)}");
    expect(fuente.slice(cerrado)).toContain('<span className="count-tag">{items.length}</span>');
    expect(fuente).toContain("data-ocultar-atencion onClick={() => setAbierto(false)}");
  });
});
