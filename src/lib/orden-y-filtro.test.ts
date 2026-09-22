import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SIN_VALOR, claveDeFiltro, comparaCeldas, filtraFilas, opcionesDeFiltro, ordenaFilas } from "./orden-y-filtro";

/** Ordenar y filtrar por columna, fuera de la pantalla (D-NEXT): la lógica que comparten Órdenes y el Gestor. */

type Fila = { id: string; n: number | null; txt: string | null };
// Desordenadas a propósito, con nulos en medio y un texto con número («#10» tiene que ir después de «#9»).
const FILAS: Fila[] = [
  { id: "c", n: 3, txt: "#10" },
  { id: "nulo", n: null, txt: null },
  { id: "a", n: 1, txt: "#9" },
  { id: "vacio", n: 0, txt: "" },
  { id: "b", n: 2, txt: "b" },
];
const ids = (f: Fila[]) => f.map((x) => x.id);

describe("comparaCeldas", () => {
  it("números como números, texto con numeric e ignorando mayúsculas, y el nulo siempre después", () => {
    expect(comparaCeldas(2, 10)).toBeLessThan(0);
    expect(comparaCeldas("#9", "#10")).toBeLessThan(0);
    expect(comparaCeldas("b", "A")).toBeGreaterThan(0);
    expect(comparaCeldas(null, 0)).toBeGreaterThan(0);
    expect(comparaCeldas("x", null)).toBeLessThan(0);
    expect(comparaCeldas(null, null)).toBe(0);
  });
});

describe("ordenaFilas", () => {
  it("ascendente por número, con el nulo al final", () => {
    expect(ids(ordenaFilas(FILAS, (f) => f.n, "asc"))).toEqual(["vacio", "a", "b", "c", "nulo"]);
  });
  it("descendente invierte los valores pero el nulo SIGUE al final (no es lo que hace Órdenes desde D-275, y se deja dicho)", () => {
    expect(ids(ordenaFilas(FILAS, (f) => f.n, "desc"))).toEqual(["c", "b", "a", "vacio", "nulo"]);
  });
  it("por texto, «#9» antes que «#10»; el texto vacío no es nulo y va el primero", () => {
    expect(ids(ordenaFilas(FILAS, (f) => f.txt, "asc"))).toEqual(["vacio", "a", "c", "b", "nulo"]);
  });
  it("sin dirección devuelve el orden de entrada, y nunca muta la lista que le dan", () => {
    const copia = [...FILAS];
    expect(ids(ordenaFilas(FILAS, (f) => f.n, null))).toEqual(ids(FILAS));
    ordenaFilas(FILAS, (f) => f.n, "asc");
    expect(FILAS).toEqual(copia);
  });
});

describe("claveDeFiltro y filtraFilas", () => {
  const valorDe = (k: string, f: Fila) => (k === "n" ? f.n : f.txt);
  it("nulo y cadena vacía son la misma clave, «sin valor», y no se puede escribir a mano", () => {
    expect(claveDeFiltro(null)).toBe(SIN_VALOR);
    expect(claveDeFiltro("")).toBe(SIN_VALOR);
    expect(claveDeFiltro(0)).toBe("0");
    expect(SIN_VALOR.startsWith(" ")).toBe(true);
  });
  it("sin filtros, o con conjuntos vacíos, pasan todas; con uno, solo las marcadas — el «sin valor» se marca también", () => {
    expect(ids(filtraFilas(FILAS, {}, valorDe))).toEqual(ids(FILAS));
    expect(ids(filtraFilas(FILAS, { n: new Set() }, valorDe))).toEqual(ids(FILAS));
    expect(ids(filtraFilas(FILAS, { n: new Set(["1", "3"]) }, valorDe))).toEqual(["c", "a"]);
    expect(ids(filtraFilas(FILAS, { txt: new Set([SIN_VALOR]) }, valorDe))).toEqual(["nulo", "vacio"]);
  });
  it("dos filtros se cruzan (Y), y `saltar` deja de aplicar el de UNA columna para su propio menú", () => {
    const filtros = { n: new Set(["1", "2", "3"]), txt: new Set(["b"]) };
    expect(ids(filtraFilas(FILAS, filtros, valorDe))).toEqual(["b"]);
    expect(ids(filtraFilas(FILAS, filtros, valorDe, "txt"))).toEqual(["c", "a", "b"]);
  });
});

describe("opcionesDeFiltro", () => {
  // El «—» sale el PRIMERO: `localeCompare` pone la raya antes que letras y números (medido con Node el
  // 2026-09-22). Es lo que ya hacía Órdenes desde D-275 y se conserva: quien filtra encuentra el «sin valor» arriba.
  it("cada valor una vez, «—» para el sin valor (arriba), y las demás por etiqueta con numeric", () => {
    const conRepetida = [...FILAS, { id: "otra", n: 3, txt: "#10" }];
    expect(opcionesDeFiltro(conRepetida, (f) => f.txt)).toEqual([
      { key: SIN_VALOR, label: "—" }, { key: "#9", label: "#9" }, { key: "#10", label: "#10" }, { key: "b", label: "b" },
    ]);
  });
  it("la etiqueta cambia lo que se lee, no la clave por la que se filtra", () => {
    const ops = opcionesDeFiltro(FILAS.slice(0, 3), (f) => f.n, (v) => (v == null ? "?" : `${v} pallets`));
    expect(ops).toEqual([{ key: SIN_VALOR, label: "—" }, { key: "1", label: "1 pallets" }, { key: "3", label: "3 pallets" }]);
  });
});

describe("OrdersTable usa la librería en vez de su copia (D-NEXT)", () => {
  const tabla = readFileSync(join(process.cwd(), "src/components/OrdersTable.tsx"), "utf8").split("\r\n").join("\n");
  it("compara, filtra y lista opciones con las funciones extraídas; su comparador ya no vive dentro", () => {
    expect(tabla.indexOf('from "@/lib/orden-y-filtro"')).toBeGreaterThan(-1);
    expect(tabla).toContain("const cmp = comparaCeldas(col.value(a, ctx), col.value(b, ctx));");
    expect(tabla).toContain("return filtraFilas(data, visiblesConFiltro,");
    expect(tabla).toContain("const optionsFor = (col: OrderColumn) => opcionesDeFiltro(applyFilters(rows, col.key)");
    expect(tabla).not.toContain("localeCompare(String(vb)");
    expect(tabla).not.toContain("function filterKey(");
  });
  it("el menú de columna se exporta, y solo pide el nombre en los dos idiomas", () => {
    expect(tabla).toContain("export function ColumnFilterMenu(");
    expect(tabla).toContain('col: Pick<OrderColumn, "en" | "es">;');
  });
});
