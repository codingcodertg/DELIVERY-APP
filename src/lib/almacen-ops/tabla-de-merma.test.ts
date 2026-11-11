import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMNAS_EXCEL, celdasDeMerma, csvDeMermas, escaparCsv, nombreDelCsv, type FilaDeMermaExcel } from "./tabla-de-merma";

/**
 * Pedido de Roberto (gerente de almacén): la lista de merma de Reportes → Merma debe verse como su Excel, una fila por
 * reporte con DATE, ITEM CODE, ITEM DESCRIPTION, cantidades (BOXES, PCS/BOX, TOTAL, SMPLE, DMGE, COST; la de COST es hoy «$ loss», la pérdida al precio de venta, 272), HOW, REASON,
 * BROKEN BY, REPORTED BY, CRMA #, COMMENTS; y un botón para bajarla en CSV y pegarla en Excel.
 */
const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const LISTA = lee("src/app/operaciones/ListaDeReportes.tsx");
const CSS = lee("src/app/operaciones/operaciones.css");

const personas = [{ id: "11111111-1111-4111-8111-111111111111", full_name: "Luis Treviño" }, { id: "22222222-2222-4222-8222-222222222222", full_name: "Ana García" }];
const base: FilaDeMermaExcel = {
  kind: "scrap", created_at: "2026-11-05T15:00:00Z", broken_on: "2026-11-03",
  product_sku: "PORC-2448-GRY", product_name: "Porcelain 24x48 Ash Grey", scrap_type: "mixed",
  boxes: 3, pieces_per_box: 2, total_pieces: 7, damaged_pieces: 5, sample_pieces: 2, unit_cost: 9.4, total_loss: 47,
  return_type: "internal", reason: "forklift", broken_by: [personas[0].id], crma: null,
  answers: { reported_by: [personas[1].id, "Pedro (sin cuenta)"], comments: 'Pallet slid off the forks, "ouch"' },
};

describe("celdas del Excel de merma", () => {
  it("mapea cada campo del reporte a su columna, en el orden de la hoja de Roberto", () => {
    expect(COLUMNAS_EXCEL.map((c) => c.en)).toEqual(["Date broken", "Item code", "Item description", "Boxes", "Pcs/box", "Total", "Sample", "Damaged", "$ loss", "How", "Reason", "Broken by", "Reported by", "CRMA #", "Comments"]);
    const c = celdasDeMerma(base, personas, "en");
    expect(c.fecha).toBe("2026-11-03"); // la fecha del daño, no la del reporte
    expect(c.codigo).toBe("PORC-2448-GRY");
    expect(c.descripcion).toBe("Porcelain 24x48 Ash Grey");
    expect([c.cajas, c.piezasPorCaja, c.total, c.muestra, c.danadas]).toEqual(["3", "2", "7", "2", "5"]);
    expect(c.costo).toBe("47.00");
    expect(c.costoUnitario).toBe("9.40");
    expect(c.como).toBe("Internal");
    expect(c.motivo).toBe("Forklift");
    expect(c.loRompio).toBe("Luis Treviño");
    expect(c.loReporto).toBe("Ana García, Pedro (sin cuenta)"); // ids → nombre; texto a mano tal cual
    expect(c.crma).toBe("NA");
    expect(c.comentarios).toBe('Pallet slid off the forks, "ouch"');
  });

  it("sin fecha del daño usa la del reporte; sin reparto guardado lo deduce del tipo", () => {
    const c = celdasDeMerma({ ...base, broken_on: null, damaged_pieces: null, sample_pieces: null, scrap_type: "sample", total_pieces: 6 }, personas, "en");
    expect(c.fecha).toBe("2026-11-05");
    expect(c.muestra).toBe("6");
    expect(c.danadas).toBe("0");
  });

  it("IDK cuando no se sabe quién lo rompió o quién lo reportó, como en su hoja; NA sin CRMA; etiquetas en español", () => {
    const c = celdasDeMerma({ ...base, broken_by: [], answers: {}, return_type: "customer_return", reason: "transportation_delivery", crma: "  CR-2291 " }, personas, "es");
    expect(c.loRompio).toBe("IDK");
    expect(c.loReporto).toBe("IDK");
    expect(c.crma).toBe("CR-2291");
    expect(c.como).toBe("Devolución de cliente");
    expect(c.motivo).toBe("Transporte – entrega de la tienda");
    expect(c.comentarios).toBe("");
    // Un id que ya no está en la lista de personas no cuenta como nombre.
    expect(celdasDeMerma({ ...base, broken_by: ["33333333-3333-4333-8333-333333333333"] }, personas, "en").loRompio).toBe("IDK");
  });

  it("producto fuera de catálogo: el código lo dice; sin cantidades, celdas vacías", () => {
    const c = celdasDeMerma({ ...base, product_sku: null, product_not_in_catalog: true, boxes: null, pieces_per_box: null, total_pieces: null, total_loss: null, unit_cost: null }, personas, "en");
    expect(c.codigo).toBe("(not in catalog)");
    expect([c.cajas, c.piezasPorCaja, c.total, c.costo, c.costoUnitario]).toEqual(["", "", "", "", ""]);
  });
});

describe("CSV de merma", () => {
  it("escapa comillas, comas y saltos de línea; todo va entre comillas", () => {
    expect(escaparCsv("plain")).toBe('"plain"');
    expect(escaparCsv('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(escaparCsv("two\nlines")).toBe('"two\nlines"');
    expect(escaparCsv("")).toBe('""');
  });

  it("arma encabezado + una línea por merma con las mismas columnas de la tabla, separado por comas y CRLF", () => {
    const csv = csvDeMermas([base, { ...base, crma: "CR-1", return_type: "customer_return" }], personas, "en");
    const lineas = csv.split("\r\n");
    expect(lineas[0]).toBe('"Date broken","Item code","Item description","Boxes","Pcs/box","Total","Sample","Damaged","$ loss","How","Reason","Broken by","Reported by","CRMA #","Comments"');
    expect(lineas[1]).toBe('"2026-11-03","PORC-2448-GRY","Porcelain 24x48 Ash Grey","3","2","7","2","5","47.00","Internal","Forklift","Luis Treviño","Ana García, Pedro (sin cuenta)","NA","Pallet slid off the forks, ""ouch"""');
    expect(lineas[2]).toContain('"Customer return"');
    expect(lineas[2]).toContain('"CR-1"');
    expect(lineas).toHaveLength(4); // 1 + 2 + la línea vacía final
    expect(lineas[3]).toBe("");
    expect(csvDeMermas([], personas, "es").split("\r\n")[0]).toContain('"Fecha del daño","Código"');
  });

  it("el archivo se llama scrap-<tienda o all>-<yyyy-mm-dd>.csv", () => {
    expect(nombreDelCsv("McAllen", "2026-11-07")).toBe("scrap-mcallen-2026-11-07.csv");
    expect(nombreDelCsv("Rio Grande City", "2026-11-07")).toBe("scrap-rio-grande-city-2026-11-07.csv");
    expect(nombreDelCsv(null, "2026-11-07")).toBe("scrap-all-2026-11-07.csv");
    expect(nombreDelCsv("", "2026-11-07")).toBe("scrap-all-2026-11-07.csv");
  });
});

describe("la pantalla usa la tabla Excel solo en la pestaña de merma", () => {
  it("la lista de merma en rango va con las columnas del Excel; la de todos los reportes sigue igual", () => {
    expect(LISTA).toContain("<TablaDeMermaExcel");
    expect(LISTA).toContain('data-lista="merma-en-rango"');
    expect(LISTA).toContain('<TablaDeReportes filas={visibles} ctx={ctx} onAbrir={setAbierto} repetidas={repetidas} data-lista="todos"');
    // Encabezado de dos niveles con el grupo «Cantidades», y se abre la tarjeta al tocar la fila.
    expect(LISTA).toContain('t("Quantities", "Cantidades")');
    expect(LISTA).toContain("onClick={() => onAbrir(r)}");
    // Botón de exportar: CSV en el navegador (Blob), con el nombre scrap-<tienda>-<día>.csv.
    expect(LISTA).toContain('t("Export CSV", "Exportar CSV")');
    expect(LISTA).toContain("new Blob(");
    expect(LISTA).toContain("nombreDelCsv(");
    expect(LISTA).toContain("csvDeMermas(");
  });
  it("las columnas numéricas van a la derecha y la tabla se desplaza dentro de su caja en pantallas angostas", () => {
    expect(CSS).toContain(".ops-tabla-excel");
    expect(CSS).toMatch(/\.ops-tabla-excel[^{]*\.num[^{]*\{[^}]*text-align: right/);
  });
});

it("escaparCsv neutraliza una celda que empieza como fórmula", () => {
  expect(escaparCsv("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
  expect(escaparCsv("-5 cajas")).toBe("\"'-5 cajas\"");
  expect(escaparCsv("normal")).toBe("\"normal\"");
});
