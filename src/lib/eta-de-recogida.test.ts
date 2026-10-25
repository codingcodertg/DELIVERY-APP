import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { claveDeRecogida, ordenesDeLaRecogidaMedida } from "./usa-medida-de-rutas";

// D-616 (2026-10-20) · El dueño: «WHY DOES IT SAYS NO BASE». La recogida pendiente buscaba su hora con «P:» + su puesto en la
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
    // D-NEXT: con las órdenes de la PARADA del día, no las de la fila.
    expect(tabla).toContain("routeEtas[u.key]?.[claveDeRecogida(ordenesDeLaRecogidaMedida(dia.paradas, dia.deFila[k], f.ordenes))]");
    expect(tabla).not.toContain("[claveDeRecogida(f.ordenes)]");
    expect(tabla).not.toContain("[`P:${f.indice}`]");
  });
  it("D-NEXT: la fila busca con las órdenes de su PARADA del día (la medida va por paradas: tres filas en la misma tienda, una visita)", () => {
    // La ruta de Ernesto (26-oct): P1-P5 en McAllen son la parada 1 («P:a,b,c,d,e»); P8 sola en Pharr, la 5 («P:h»).
    const paradas = [
      { tipo: "P" as const, ordenes: ["a", "b", "c", "d", "e"] }, { tipo: "D" as const, ordenes: ["b", "x"] }, { tipo: "D" as const, ordenes: ["a"] },
      { tipo: "P" as const, ordenes: ["f", "g"] }, { tipo: "P" as const, ordenes: ["h"] },
    ];
    expect(ordenesDeLaRecogidaMedida(paradas, 1, ["c"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(ordenesDeLaRecogidaMedida(paradas, 4, ["g"])).toEqual(["f", "g"]);
    expect(ordenesDeLaRecogidaMedida(paradas, 5, ["h"])).toEqual(["h"]);
    // Sin número, con una parada que no es recogida, o con una que no contiene a la fila: las de la fila, como hasta aquí.
    expect(ordenesDeLaRecogidaMedida(paradas, undefined, ["c"])).toEqual(["c"]);
    expect(ordenesDeLaRecogidaMedida(paradas, 2, ["b"])).toEqual(["b"]); // una ENTREGA agrupada no es una recogida
    expect(ordenesDeLaRecogidaMedida(paradas, 4, ["c"])).toEqual(["c"]);
    expect(ordenesDeLaRecogidaMedida(paradas, 9, ["c"])).toEqual(["c"]);
  });
  it("puerta: Ayuda y Chat por encima de una orden abierta (overlay 50) y de los avisos (99)", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.help-fab \{[^}]*z-index: 1000;/);
    expect(css).toMatch(/\.chat-fab \{[^}]*z-index: 1000;/);
    expect(css).toMatch(/\.chat-panel \{[^}]*z-index: 1001;/);
  });
});
