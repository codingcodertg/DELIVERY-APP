/**
 * La lista de merma como el Excel de Roberto (gerente de almacén): una fila por reporte, con las columnas de su hoja
 * (DATE, ITEM CODE, ITEM DESCRIPTION, cantidades, HOW, REASON, BROKEN BY, REPORTED BY, CRMA #, COMMENTS) además de las
 * que ya tenía la tabla (Cuándo, Etapa, Tipo, Tienda, Lo llenó). Aquí van las funciones puras: fila → celdas y el CSV
 * para que lo pegue en Excel. Sin React: lo importan la pantalla y las pruebas.
 */
import { CLAVE_ROMPIO_TEXTO, PASO_QUIEN_REPORTO, etiquetaDeOpcion } from "./pasos";
import { nombreOTexto } from "./personas";
import { repartoDeReporte } from "./perdida";
import { diaDelReporte } from "./fecha-del-dano";

type Lang = "en" | "es";

/** Lo que la tabla necesita de un reporte de merma (un subconjunto de `Reporte`, para que las pruebas no armen todo). */
export interface FilaDeMermaExcel {
  kind: string;
  created_at: string;
  broken_on?: string | null;
  product_sku: string | null;
  product_name: string | null;
  product_not_in_catalog?: boolean;
  scrap_type: string | null;
  boxes: number | null;
  pieces_per_box: number | null;
  total_pieces: number | null;
  damaged_pieces?: number | null;
  sample_pieces?: number | null;
  unit_cost: number | null;
  total_loss: number | null;
  return_type: string | null;
  reason: string | null;
  broken_by: string[];
  crma: string | null;
  answers: Record<string, unknown>;
}

/** Las celdas del Excel de una merma, ya en texto (lo que se ve en la tabla y lo que va al CSV). */
export interface CeldasDeMerma {
  fecha: string;
  codigo: string;
  descripcion: string;
  cajas: string;
  piezasPorCaja: string;
  total: string;
  muestra: string;
  danadas: string;
  /** Cajas dañadas = piezas dañadas ÷ piezas por caja (reunión 12 nov: antes de tirar se revisa por caja). */
  cajasDanadas: string;
  costo: string;
  /** Precio de venta por pieza (272), para el título (tooltip) de la celda de pérdida. */
  costoUnitario: string;
  como: string;
  motivo: string;
  loRompio: string;
  loReporto: string;
  crma: string;
  comentarios: string;
}

/** Las columnas del Excel, en el orden de la hoja de Roberto; `grupo` marca las que van bajo «Cantidades». */
export const COLUMNAS_EXCEL: { id: keyof CeldasDeMerma; en: string; es: string; num?: boolean; grupo?: boolean }[] = [
  // El día en que se ROMPIÓ (no el de reporte; ese va en «Fecha reportada»). Dueño, 10 nov: que se distingan las dos.
  { id: "fecha", en: "Date broken", es: "Fecha del daño" },
  { id: "codigo", en: "Item code", es: "Código" },
  { id: "descripcion", en: "Item description", es: "Descripción" },
  { id: "cajas", en: "Boxes", es: "Cajas", num: true, grupo: true },
  { id: "piezasPorCaja", en: "Pcs/box", es: "Pzas/caja", num: true, grupo: true },
  { id: "total", en: "Total", es: "Total", num: true, grupo: true },
  { id: "muestra", en: "Sample", es: "Muestra", num: true, grupo: true },
  // Reunión 12 nov (Roberto): dos columnas — piezas dañadas y CAJAS dañadas (lo que se revisa afuera antes de tirar).
  { id: "danadas", en: "Damaged pcs", es: "Dañadas (pzas)", num: true, grupo: true },
  { id: "cajasDanadas", en: "Damaged boxes", es: "Cajas dañadas", num: true, grupo: true },
  { id: "costo", en: "$ loss", es: "Pérdida $", num: true, grupo: true },
  { id: "como", en: "How", es: "Cómo" },
  { id: "motivo", en: "Reason", es: "Motivo" },
  { id: "loRompio", en: "Broken by", es: "Lo rompió" },
  { id: "loReporto", en: "Reported by", es: "Lo reportó" },
  { id: "crma", en: "CRMA #", es: "CRMA #" },
  { id: "comentarios", en: "Comments", es: "Comentarios" },
];

/**
 * Cajas dañadas = piezas dañadas ÷ piezas por caja, con hasta 2 decimales y sin ceros de sobra («1», «0.5», «1.33»).
 * Sin piezas por caja (o cero) no se puede saber: sale vacío. No se redondea a enteros: media caja rota es media caja.
 */
export function cajasDanadas(danadas: number | null | undefined, piezasPorCaja: number | null | undefined): string {
  const d = Number(danadas), p = Number(piezasPorCaja);
  if (danadas == null || !Number.isFinite(d) || !Number.isFinite(p) || p <= 0) return "";
  return String(Math.round((d / p) * 100) / 100);
}

/** Los nombres escritos a mano de «¿Quién lo rompió?» (gente sin cuenta; reunión 12 nov). Van en `answers`. */
export function rompioEscrito(answers: Record<string, unknown> | null | undefined): string[] {
  const v = answers?.[CLAVE_ROMPIO_TEXTO];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

const numero = (v: number | null | undefined): string => (v == null || !Number.isFinite(Number(v)) ? "" : String(v));
const dinero = (v: number | null | undefined): string => (v == null || !Number.isFinite(Number(v)) ? "" : Number(v).toFixed(2));

/**
 * Una merma → sus celdas del Excel. Quién lo rompió y quién lo reportó se resuelven con la lista de personas (un
 * nombre escrito a mano sale tal cual); vacío = «IDK», como en la hoja de Roberto. CRMA vacío = «NA».
 */
export function celdasDeMerma(r: FilaDeMermaExcel, personas: readonly { id: string; full_name: string }[], lang: Lang): CeldasDeMerma {
  const reparto = repartoDeReporte(r);
  const nombres = (ids: unknown): string => (Array.isArray(ids) ? (ids as string[]).map((x) => nombreOTexto(personas, x)).filter((x) => x && x !== "—") : []).join(", ");
  const loRompio = [nombres(r.broken_by), ...rompioEscrito(r.answers)].filter(Boolean).join(", ");
  const loReporto = nombres(r.answers?.[PASO_QUIEN_REPORTO]);
  const comentarios = r.answers?.comments;
  return {
    fecha: diaDelReporte(r),
    codigo: r.product_sku ?? (r.product_not_in_catalog ? (lang === "es" ? "(fuera de catálogo)" : "(not in catalog)") : ""),
    descripcion: r.product_name ?? "",
    cajas: numero(r.boxes),
    piezasPorCaja: numero(r.pieces_per_box),
    total: numero(r.total_pieces),
    muestra: String(reparto.sample),
    danadas: String(reparto.damaged),
    cajasDanadas: cajasDanadas(reparto.damaged, r.pieces_per_box),
    costo: dinero(r.total_loss),
    costoUnitario: dinero(r.unit_cost),
    como: etiquetaDeOpcion("scrap", "return_type", r.return_type, lang),
    motivo: etiquetaDeOpcion("scrap", "reason", r.reason, lang),
    loRompio: loRompio || "IDK",
    loReporto: loReporto || "IDK",
    crma: r.crma?.trim() || "NA",
    comentarios: typeof comentarios === "string" ? comentarios : "",
  };
}

/** Entre comillas, comillas dobladas. Si empieza por = + - @ tab o CR, se antepone un apóstrofo para que Excel no lo
 * ejecute como fórmula (el comentario lo escribe el empleado). */
export function escaparCsv(v: string): string {
  const t = String(v ?? "");
  const s = /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
  return `"${s.replace(/"/g, "\"\"")}"`;
}

/** El CSV completo (encabezado + una línea por merma), separado por comas y con saltos CRLF, que es lo que Excel espera. */
export function csvDeMermas(filas: readonly FilaDeMermaExcel[], personas: readonly { id: string; full_name: string }[], lang: Lang): string {
  const cab = COLUMNAS_EXCEL.map((c) => escaparCsv(lang === "es" ? c.es : c.en));
  const lineas = filas.map((r) => { const c = celdasDeMerma(r, personas, lang); return COLUMNAS_EXCEL.map((k) => escaparCsv(c[k.id])).join(","); });
  return [cab.join(","), ...lineas].join("\r\n") + "\r\n";
}

/** El nombre del archivo: scrap-<tienda o all>-<yyyy-mm-dd>.csv (la tienda sin espacios ni símbolos raros). */
export function nombreDelCsv(tienda: string | null | undefined, hoy: string): string {
  const t = (tienda ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `scrap-${t || "all"}-${hoy}.csv`;
}
