import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { datosPdfDeMerma, nombreDelPdf } from "./pdf-de-merma";
import { COLUMNAS_EXCEL, type FilaDeMermaExcel } from "./tabla-de-merma";

/**
 * Pedido del dueño (10 nov): «de paso quiero que cree reporte en PDF también». El PDF usa las mismas columnas que el
 * Excel/CSV, para las filas que se ven (rango + filtros), con el total de la pérdida al pie. Aquí se prueba la parte pura.
 */
const lee = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const LISTA = lee("src/app/operaciones/ListaDeReportes.tsx");

const personas = [{ id: "11111111-1111-4111-8111-111111111111", full_name: "Luis Treviño" }, { id: "22222222-2222-4222-8222-222222222222", full_name: "Ana García" }];
const base: FilaDeMermaExcel = {
  kind: "scrap", created_at: "2026-11-05T15:00:00Z", broken_on: "2026-11-03",
  product_sku: "PORC-2448-GRY", product_name: "Porcelain 24x48 Ash Grey", scrap_type: "mixed",
  boxes: 3, pieces_per_box: 2, total_pieces: 7, damaged_pieces: 5, sample_pieces: 2, unit_cost: 9.4, total_loss: 47,
  return_type: "internal", reason: "forklift", broken_by: [personas[0].id], crma: null,
  answers: { reported_by: [personas[1].id], comments: "ok" },
};

describe("datos del PDF de merma", () => {
  it("encabezados = columnas del Excel; una fila de texto por reporte", () => {
    const d = datosPdfDeMerma([base], personas, "en", { hoy: "2026-11-10" });
    expect(d.encabezados).toEqual(COLUMNAS_EXCEL.map((c) => c.en));
    expect(d.filas).toHaveLength(1);
    expect(d.filas[0][0]).toBe("2026-11-03"); // fecha del daño
    expect(d.filas[0][1]).toBe("PORC-2448-GRY");
    expect(d.filas[0]).toHaveLength(COLUMNAS_EXCEL.length);
  });

  it("el total suma solo lo que cuenta como pérdida (una devolución sin CRMA no cuenta)", () => {
    const devSinCrma: FilaDeMermaExcel = { ...base, return_type: "customer_return", crma: null, total_loss: 30 };
    const d = datosPdfDeMerma([base, devSinCrma], personas, "en", { hoy: "2026-11-10" });
    expect(d.total).toBe(47); // 47 cuenta; 30 (devolución sin CRMA) no
    const conCrma = datosPdfDeMerma([base, { ...devSinCrma, crma: "CR-9" }], personas, "en", { hoy: "2026-11-10" });
    expect(conCrma.total).toBe(77); // con CRMA sí cuenta
  });

  it("subtítulo: rango (si hay), tienda (o «todas») y cuántos reportes; títulos traducidos", () => {
    const d = datosPdfDeMerma([base, base], personas, "es", { hoy: "2026-11-10", rango: "Este mes", tienda: "McAllen" });
    expect(d.titulo).toBe("Reporte de merma");
    expect(d.subtitulo).toBe("Este mes · McAllen · 2 reportes");
    const en = datosPdfDeMerma([base], personas, "en", { hoy: "2026-11-10" });
    expect(en.titulo).toBe("Scrap report");
    expect(en.subtitulo).toBe("All stores · 1 report");
    expect(en.etiquetaTotal).toBe("Total loss");
  });

  it("el archivo se llama scrap-<tienda o all>-<yyyy-mm-dd>.pdf", () => {
    expect(nombreDelPdf("Rio Grande City", "2026-11-10")).toBe("scrap-rio-grande-city-2026-11-10.pdf");
    expect(nombreDelPdf(null, "2026-11-10")).toBe("scrap-all-2026-11-10.pdf");
    expect(datosPdfDeMerma([base], personas, "en", { hoy: "2026-11-10", tienda: "McAllen" }).nombreArchivo).toBe("scrap-mcallen-2026-11-10.pdf");
  });
});

describe("la pantalla: PDF y todas las columnas en Reportes", () => {
  it("hay botón «Descargar PDF» que carga jspdf de forma diferida y lo baja", () => {
    expect(LISTA).toContain('t("Download PDF", "Descargar PDF")');
    expect(LISTA).toContain('import("jspdf")');
    expect(LISTA).toContain('import("jspdf-autotable")');
    expect(LISTA).toContain("datosPdfDeMerma(");
    expect(LISTA).toContain("doc.save(");
  });
  it("Reportes muestra todas las columnas (tabla Excel) cuando lo que se ve es puro scrap", () => {
    expect(LISTA).toContain("const listaUsaExcel = tipo === \"scrap\" || listaSoloMerma;");
    expect(LISTA).toContain("listaUsaExcel");
    // Se mantiene la tabla simple para listas mezcladas / de otros tipos.
    expect(LISTA).toContain('<TablaDeReportes filas={visibles} ctx={ctx} onAbrir={setAbierto} repetidas={repetidas} data-lista="todos"');
  });
});
