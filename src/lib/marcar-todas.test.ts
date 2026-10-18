import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { alternaTodasLasVisibles, estadoDeLaCabecera } from "./marcar-todas";

/**
 * «Marcar todas» sobre una tabla filtrada (D-NEXT). El dueño, 2026-10-18: *«When selecting all orders on a
 * filtered table, it selects hidden rows instead of just the filtered»*.
 *
 * Las pruebas se arman siempre con algo OCULTO ya marcado: es el caso que distingue «toca solo las visibles» de
 * «vuelve a la lista completa» y de «desmarcar vacía todo».
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

const VISIBLES = ["a", "b", "c"];
const OCULTA = "z";

describe("alternaTodasLasVisibles", () => {
  it("marca exactamente las visibles y deja la oculta marcada como estaba", () => {
    const antes = new Set([OCULTA]);
    const despues = alternaTodasLasVisibles(antes, VISIBLES);
    expect([...despues].sort()).toEqual(["a", "b", "c", "z"]);
    expect(antes.size).toBe(1); // no muta la entrada
  });

  it("con alguna visible sin marcar, completa las visibles (no desmarca)", () => {
    const despues = alternaTodasLasVisibles(new Set(["a", OCULTA]), VISIBLES);
    expect([...despues].sort()).toEqual(["a", "b", "c", "z"]);
  });

  it("con todas las visibles marcadas, desmarca solo esas: la oculta sigue marcada", () => {
    const despues = alternaTodasLasVisibles(new Set(["a", "b", "c", OCULTA]), VISIBLES);
    expect([...despues]).toEqual([OCULTA]);
  });

  it("sin visibles no toca nada", () => {
    expect([...alternaTodasLasVisibles(new Set([OCULTA]), [])]).toEqual([OCULTA]);
  });
});

describe("estadoDeLaCabecera", () => {
  it("cuenta solo las visibles: una oculta marcada no la pone indeterminada", () => {
    expect(estadoDeLaCabecera(new Set([OCULTA]), VISIBLES)).toBe("ninguna");
  });
  it("todas las visibles marcadas es «todas», aunque haya ocultas sin marcar", () => {
    expect(estadoDeLaCabecera(new Set(["a", "b", "c"]), VISIBLES)).toBe("todas");
  });
  it("todas las visibles marcadas MÁS una oculta sigue siendo «todas»: la oculta no cuenta", () => {
    expect(estadoDeLaCabecera(new Set(["a", "b", "c", OCULTA]), VISIBLES)).toBe("todas");
  });
  it("algunas visibles marcadas es «algunas»", () => {
    expect(estadoDeLaCabecera(new Set(["a", OCULTA]), VISIBLES)).toBe("algunas");
  });
  it("sin visibles es «ninguna», aunque haya ocultas marcadas", () => {
    expect(estadoDeLaCabecera(new Set([OCULTA]), [])).toBe("ninguna");
  });
});

describe("quién la usa", () => {
  it("la tabla de Órdenes calcula la cabecera y «todas» sobre las filas ya filtradas y ordenadas, no sobre `rows`", () => {
    const tabla = leer("src/components/OrdersTable.tsx");
    expect(tabla).toContain("const idsVisibles = sortedRows.map((r) => r.id);");
    expect(tabla).toContain("estadoDeLaCabecera(selected, idsVisibles)");
    expect(tabla).toContain("onChange={() => onToggleAll?.(idsVisibles)}");
    expect(tabla).not.toMatch(/rows\.every\(\(r\) => selected\.has/);
  });
  it("la página de Órdenes alterna con la función pura y los ids que le pasa la tabla", () => {
    const pagina = leer("src/app/(app)/page.tsx");
    expect(pagina).toContain("const toggleAll = (idsVisibles: string[]) => setSelected((prev) => alternaTodasLasVisibles(prev, idsVisibles));");
    expect(pagina).not.toMatch(/rows\.every\(\(r\) => prev\.has/);
  });
});
