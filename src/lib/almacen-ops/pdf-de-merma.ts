/**
 * El reporte de merma en PDF (pedido del dueño, 10 nov): mismas columnas que el Excel de Roberto (`COLUMNAS_EXCEL`),
 * para las filas que se ven en pantalla (respeta el rango y los filtros). Aquí va SOLO la parte pura —armar encabezados,
 * filas de texto, total y nombre de archivo—; el `jsPDF` lo monta la pantalla (carga diferida, como `@zumer/snapdom`).
 * Sin React, sin la librería de PDF: así se puede probar sin ejecutar nada del navegador.
 */
import { COLUMNAS_EXCEL, celdasDeMerma, type FilaDeMermaExcel } from "./tabla-de-merma";
import { cuentaComoPerdida } from "./perdida";
import { EMPRESA } from "./etapas";

type Lang = "en" | "es";

/** Lo que la pantalla sabe del contexto del reporte (para el subtítulo y el nombre del archivo). */
export interface MetaPdfDeMerma {
  /** La etiqueta del rango elegido (ej. «Este mes»); null si no aplica. */
  rango?: string | null;
  /** La tienda, si todas las filas son de la misma; null = varias/todas. */
  tienda?: string | null;
  /** yyyy-mm-dd, para el nombre del archivo. */
  hoy: string;
}

export interface DatosPdfDeMerma {
  empresa: string;
  titulo: string;
  subtitulo: string;
  encabezados: string[];
  filas: string[][];
  /** Suma de la pérdida de las filas que cuentan como pérdida (una devolución sin CRMA no cuenta). */
  total: number;
  etiquetaTotal: string;
  nombreArchivo: string;
}

/** scrap-<tienda o all>-<yyyy-mm-dd>.pdf (misma forma que `nombreDelCsv`). */
export function nombreDelPdf(tienda: string | null | undefined, hoy: string): string {
  const t = (tienda ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `scrap-${t || "all"}-${hoy}.pdf`;
}

/** Arma todo lo que el PDF necesita, ya en texto. Mismas celdas que el CSV, para que cuadren. */
export function datosPdfDeMerma(
  filas: readonly FilaDeMermaExcel[],
  personas: readonly { id: string; full_name: string }[],
  lang: Lang,
  meta: MetaPdfDeMerma,
): DatosPdfDeMerma {
  const encabezados = COLUMNAS_EXCEL.map((c) => (lang === "es" ? c.es : c.en));
  const cuerpo = filas.map((r) => {
    const c = celdasDeMerma(r, personas, lang);
    return COLUMNAS_EXCEL.map((k) => c[k.id]);
  });
  const total = filas.reduce((s, r) => s + (cuentaComoPerdida(r) && typeof r.total_loss === "number" ? r.total_loss : 0), 0);
  const nReportes = filas.length;
  const partes: string[] = [];
  if (meta.rango) partes.push(meta.rango);
  partes.push(meta.tienda && meta.tienda.trim() ? meta.tienda : (lang === "es" ? "Todas las tiendas" : "All stores"));
  partes.push(`${nReportes} ${lang === "es" ? (nReportes === 1 ? "reporte" : "reportes") : (nReportes === 1 ? "report" : "reports")}`);
  return {
    empresa: EMPRESA,
    titulo: lang === "es" ? "Reporte de merma" : "Scrap report",
    subtitulo: partes.join(" · "),
    encabezados,
    filas: cuerpo,
    total,
    etiquetaTotal: lang === "es" ? "Pérdida total" : "Total loss",
    nombreArchivo: nombreDelPdf(meta.tienda, meta.hoy),
  };
}
