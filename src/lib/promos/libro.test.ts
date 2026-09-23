import { describe, expect, it } from "vitest";
import { leeLibro } from "./libro";
import { leePromo } from "./excel";

/**
 * La costura: que `leeLibro` (impura, `exceljs`) y `leePromo` (pura) encajen de verdad.
 *
 * Las pruebas de `excel.test.ts` construyen las celdas **a mano**, así que prueban las reglas pero
 * no que `exceljs` entregue lo que ellas suponen. Aquí el libro se escribe con `exceljs` y se vuelve
 * a leer con él, o sea que el dato pasa por la librería de verdad. Sin fichero en disco y sin ningún
 * dato del dueño: el libro se inventa aquí.
 */

const ENCABEZADOS = [
  "SUPPLIER", "SIZE", "Unified Code", "Unified Description", "NOTES", "QOH", "DEMAND", "MO",
  "AA1", "BB2", "CC3", "COST", "PRICE", "DIFF",
];

async function libroDePrueba(): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  const todo = wb.addWorksheet("TODO");
  // Fila 1: el rótulo suelto encima de las columnas de tienda, como el libro real.
  todo.getRow(1).getCell(9).value = "QOH";
  todo.getRow(2).values = [undefined, ...ENCABEZADOS];
  todo.getRow(3).values = [undefined, "PROV", "8X48", "X1", "UNO", "NOTA", 100, 10, 5, 1, 2, 3, 1.5, 2.5, { formula: "N3-M3", result: 1 }];
  // Fila 4 EN BLANCO a propósito: si el lector se saltara las vacías, todo lo de abajo cambiaría
  // de número y el admin buscaría en Excel una fila que no es.
  todo.getRow(5).values = [undefined, "PROV", "8X48", "X2", "DOS", null, 200, 20, 6, 4, 5, 6, "", null, null];
  // Fila 6: descripción y NINGÚN código — no es un producto.
  todo.getRow(6).values = [undefined, null, null, null, "EPIGRAFE"];

  const g1 = wb.addWorksheet("G1");
  g1.getRow(2).values = [undefined, ...ENCABEZADOS];
  g1.getRow(3).values = [undefined, "PROV", "8X48", "X2", "DOS", null, 200, 20, 6, 4, 5, 6, "", null, null];

  // Una hoja que no es de productos, como la de reglas del dueño.
  const reglas = wb.addWorksheet("REGLAS");
  reglas.getRow(1).getCell(1).value = "MANAGERS CAN";

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("leeLibro + leePromo, con un libro escrito por exceljs", () => {
  it("las filas conservan su NÚMERO DE EXCEL, con la vacía en medio", async () => {
    const r = leePromo(await leeLibro(await libroDePrueba()), ["G1"]);
    expect(r.productos.map((p) => [p.code, p.rowNo])).toEqual([["X1", 3], ["X2", 5]]);
  });

  it("una celda con fórmula llega por su `result`", async () => {
    const r = leePromo(await leeLibro(await libroDePrueba()), ["G1"]);
    expect(r.productos.find((p) => p.code === "X1")!.diff).toBe(1);
  });

  it("el costo en blanco del libro llega como AUSENTE, no como cero", async () => {
    // El caso que trae el libro real cinco veces, comprobado extremo a extremo y no solo contra
    // una celda inventada a mano.
    const x2 = leePromo(await leeLibro(await libroDePrueba()), ["G1"]).productos.find((p) => p.code === "X2")!;
    expect(x2.cost).toBeNull();
    expect(x2.cost).not.toBe(0);
    expect(x2.price).toBeNull();
  });

  it("las existencias por tienda salen con el nombre que da el encabezado", async () => {
    const x1 = leePromo(await leeLibro(await libroDePrueba()), ["G1"]).productos.find((p) => p.code === "X1")!;
    expect(x1.qohByStore).toEqual({ AA1: 1, BB2: 2, CC3: 3 });
  });

  it("la hoja que no es de productos se avisa, y la de grupo son sugerencias", async () => {
    const r = leePromo(await leeLibro(await libroDePrueba()), ["G1"]);
    expect(r.sugerencias).toEqual([{ code: "X2", groupCode: "G1" }]);
    // Las hojas ignoradas van PRIMERO, y no es casualidad: `leePromo` clasifica todas las hojas
    // antes de leer ninguna fila, porque hasta saber cuál es el universo no puede decidir si un
    // sugerido está fuera de él. El orden se afirma porque es el que verá el admin en la lista.
    expect(r.avisos.map((a) => [a.tipo, a.hoja])).toEqual([
      ["hoja-ignorada", "REGLAS"],
      ["fila-sin-codigo", "TODO"],
    ]);
  });
});
