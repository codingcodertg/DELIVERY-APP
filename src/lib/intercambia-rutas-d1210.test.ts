import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pagina = readFileSync(join(__dirname, "..", "app", "(app)", "routes", "page.tsx"), "utf8");
const trozo = pagina.slice(pagina.indexOf("const intercambiaRutas = async"), pagina.indexOf("const clearLane = async"));

describe("D-1210 · ⇄ Intercambiar ruta", () => {
  it("only moves pending stops; picked-up and delivered stay", () => {
    expect(trozo).toContain("filter((d) => !ETAPAS_HECHAS.has(d.stage))");
  });
  it("swaps both ways in the same order, without re-optimizing", () => {
    expect(trozo).toContain("planea(pa, a, b);");
    expect(trozo).toContain("planea(pb, b, a);");
    expect(trozo).toContain("escrituraDeLaLista(listaDe(origen, pend), desde)");
    expect(trozo).not.toContain("trasAsignar(");
  });
  it("asks first, writes in batches of 6 and can be undone", () => {
    expect(trozo).toContain("confirmAction(");
    expect(trozo).toContain("i += 6");
    expect(trozo).toContain("anotaMovimiento(");
  });
  it("the ⇄ picker sits on the route header, hidden in read-only and on routes without driver", () => {
    expect(pagina).toContain("{!soloLectura && !needsDriver && stops.some((d) => !ETAPAS_HECHAS.has(d.stage)) && (");
    expect(pagina).toContain("void intercambiaRutas(u.key, v)");
  });
});
