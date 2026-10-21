import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { claveDeRecogida } from "./usa-medida-de-rutas";

// D-NEXT (2026-10-20) · El dueño: «WHY DOES IT SAYS NO BASE». La recogida pendiente buscaba su hora con «P:» + su puesto en la
// lista de pendientes, y la medida la guardaba con «P:» + su puesto en la lista del día (con lo hecho delante): no coincidían.

describe("la hora estimada de una recogida se busca con la misma clave con que se guarda", () => {
  it("la clave son las órdenes de la recogida, no un puesto", () => {
    expect(claveDeRecogida(["a"])).toBe("P:a");
    expect(claveDeRecogida(["a", "b"])).toBe("P:a,b");
  });
  it("puerta: la medida guarda y la tabla busca con claveDeRecogida; ningún «P:» + índice queda", () => {
    const medida = readFileSync(new URL("./usa-medida-de-rutas.ts", import.meta.url), "utf8");
    expect(medida).toContain("puntos.push({ id: claveDeRecogida(p.ordenes)");
    expect(medida).not.toContain("id: `P:${i}`");
    const tabla = readFileSync(new URL("../app/(app)/routes/page.tsx", import.meta.url), "utf8");
    expect(tabla).toContain("routeEtas[u.key]?.[claveDeRecogida(f.ordenes)]");
    expect(tabla).not.toContain("[`P:${f.indice}`]");
  });
  it("puerta: Ayuda y Chat por encima de una orden abierta (overlay 50) y de los avisos (99)", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.help-fab \{[^}]*z-index: 1000;/);
    expect(css).toMatch(/\.chat-fab \{[^}]*z-index: 1000;/);
    expect(css).toMatch(/\.chat-panel \{[^}]*z-index: 1001;/);
  });
});
