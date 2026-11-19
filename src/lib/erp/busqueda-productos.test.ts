import { describe, expect, it } from "vitest";
import {
  CAMPOS_DE_BUSQUEDA,
  coincidenciasDeBusqueda,
  filtrosDeBusqueda,
  MAX_PALABRAS_DE_BUSQUEDA,
  terminosDeBusqueda,
} from "./busqueda-productos";

describe("terminosDeBusqueda", () => {
  it("parte por espacios, en minúscula, sin vacíos", () => {
    expect(terminosDeBusqueda("  Daltile   24x48 ")).toEqual(["daltile", "24x48"]);
    expect(terminosDeBusqueda("")).toEqual([]);
    expect(terminosDeBusqueda(null)).toEqual([]);
  });

  it("quita los caracteres que rompen el filtro (%, comas, paréntesis, comillas, asterisco, barra)", () => {
    expect(terminosDeBusqueda("a%b,c(d)e\"f*g\\h")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("tope de palabras", () => {
    const muchas = Array.from({ length: 20 }, (_, i) => `p${i}`).join(" ");
    expect(terminosDeBusqueda(muchas)).toHaveLength(MAX_PALABRAS_DE_BUSQUEDA);
  });
});

describe("filtrosDeBusqueda", () => {
  it("una cadena por palabra, con un ilike por cada campo descriptivo", () => {
    const [primero] = filtrosDeBusqueda("daltile");
    expect(primero.split(",")).toHaveLength(CAMPOS_DE_BUSQUEDA.length);
    expect(primero).toContain("vendor_name.ilike.%daltile%");
    expect(primero).toContain("sku.ilike.%daltile%");
    expect(primero).toContain("category_path.ilike.%daltile%");
  });

  it("dos palabras dan dos filtros (el Y se hace al encadenar .or())", () => {
    const filtros = filtrosDeBusqueda("daltile 24x48");
    expect(filtros).toHaveLength(2);
    expect(filtros[0]).toContain("ilike.%daltile%");
    expect(filtros[1]).toContain("ilike.%24x48%");
  });

  it("no incluye costo ni margen (la búsqueda nunca debe tocar el costo)", () => {
    const todo = filtrosDeBusqueda("x").join(",");
    expect(todo).not.toMatch(/cost|margin|gm_amount/);
  });

  it("una entrada con sintaxis de filtro no escapa de su valor", () => {
    // Sin comas ni paréntesis en la palabra, no hay forma de cerrar el valor y abrir otro filtro:
    // cada filtro tiene exactamente un ilike por campo, en el orden de la lista.
    for (const f of filtrosDeBusqueda("x),sku.eq.(1")) {
      const partes = f.split(",");
      expect(partes).toHaveLength(CAMPOS_DE_BUSQUEDA.length);
      partes.forEach((p, i) => expect(p.startsWith(`${CAMPOS_DE_BUSQUEDA[i]}.ilike.%`)).toBe(true));
    }
  });

  it("vacío cuando no hay palabras (el llamador decide no buscar)", () => {
    expect(filtrosDeBusqueda("   ")).toEqual([]);
    expect(filtrosDeBusqueda("%%")).toEqual([]);
  });
});

describe("coincidenciasDeBusqueda", () => {
  const fila = {
    sku: "DAL-2448-GRY",
    name: "Porcelain Gray 24x48",
    vendor_name: "Daltile",
    category_path: "Tile > Porcelain",
    size_in: "24x48",
    color1: null,
  };

  it("enseña, por palabra, el primer campo que la contiene", () => {
    const c = coincidenciasDeBusqueda(fila, "daltile 24x48");
    // «24x48» aparece antes en el nombre que en el tamaño (el orden de CAMPOS_DE_BUSQUEDA manda).
    expect(c).toEqual([
      { termino: "daltile", campo: "vendor_name", valor: "Daltile" },
      { termino: "24x48", campo: "name", valor: "Porcelain Gray 24x48" },
    ]);
  });

  it("no repite un campo ya usado por otra palabra", () => {
    const c = coincidenciasDeBusqueda(fila, "24x48 24x48");
    expect(c.map((x) => x.campo)).toEqual(["name", "size_in"]);
  });

  it("ignora campos vacíos y las palabras que no aparecen", () => {
    expect(coincidenciasDeBusqueda(fila, "porcelain color")).toEqual([
      { termino: "porcelain", campo: "name", valor: "Porcelain Gray 24x48" },
    ]);
  });

  it("sin texto de búsqueda, no hay razones", () => {
    expect(coincidenciasDeBusqueda(fila, "")).toEqual([]);
  });
});
