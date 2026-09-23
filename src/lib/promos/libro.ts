import type { Celda, HojaCruda } from "./excel";

/**
 * RTG PROMOS — **la mitad impura**: abrir el `.xlsx` y dejarlo en la estructura tonta que lee
 * `leePromo`.
 *
 * Aquí no se decide nada. Todo lo que es una regla —qué hoja es de productos, qué fila es un
 * producto, qué vale una celda— vive en `excel.ts`, que se prueba sin fichero y sin librería. Este
 * fichero existe para que esa frontera sea un import y no una intención.
 *
 * `exceljs` se carga **dentro** de la función, no arriba: es una librería grande y solo hace falta
 * cuando alguien sube un libro. Es el mismo patrón que `lib/export.ts` (G-20, D-209).
 */
export async function leeLibro(datos: ArrayBuffer): Promise<HojaCruda[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(datos);

  return wb.worksheets.map((ws) => {
    const filas: Celda[][] = [];
    // `rowCount` y no `eachRow`: hacen falta las filas VACÍAS en su sitio para que el número de
    // fila que se le enseña al admin sea el que ve en Excel. `eachRow` las salta y todo lo de
    // debajo se desplazaría — el libro real trae tres vacías en medio de una hoja.
    for (let r = 1; r <= ws.rowCount; r++) {
      const fila = ws.getRow(r);
      const celdas: Celda[] = [];
      // Igual con las columnas: `columnCount` incluye la columna de más que el libro real trae
      // vacía al final, y dejarla no molesta a nadie — `disposicionDe` busca por encabezado.
      for (let c = 1; c <= ws.columnCount; c++) celdas.push(fila.getCell(c).value as Celda);
      filas.push(celdas);
    }
    return { nombre: ws.name, filas };
  });
}
