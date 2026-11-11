/**
 * Columnas de la tabla de merma A GUSTO de cada quien (dueño, 11 nov): mostrar/ocultar y reordenar (⚙ Columnas y
 * arrastrando la cabecera). Regla PURA: la pantalla solo pinta. La casilla de selección no está aquí: va siempre primero.
 *
 * Las columnas «de cantidades» (cajas … pérdida) llevan arriba el rótulo «Cantidades»; como se pueden mover sueltas,
 * el rótulo abarca cada TRAMO seguido de columnas de cantidades visibles (`tramosDeCabecera`).
 */
import { COLUMNAS_EXCEL } from "./tabla-de-merma";

export interface ColumnaDeMerma { key: string; en: string; es: string; cantidad?: boolean }

/** Las fijas de la pantalla (antes de las del Excel) y luego las del Excel, en el orden de siempre. */
export const COLUMNAS_DE_MERMA: readonly ColumnaDeMerma[] = [
  { key: "reportada", en: "Date reported", es: "Fecha reportada" },
  { key: "etapa", en: "Stage", es: "Etapa" },
  { key: "grupo", en: "Group", es: "Grupo" },
  { key: "tipo", en: "Type", es: "Tipo" },
  { key: "tienda", en: "Store", es: "Tienda" },
  { key: "lleno", en: "Filed by", es: "Lo llenó" },
  ...COLUMNAS_EXCEL.map((c) => ({ key: c.id, en: c.en, es: c.es, cantidad: !!c.grupo })),
];

export const ORDEN_INICIAL: readonly string[] = COLUMNAS_DE_MERMA.map((c) => c.key);

export interface PrefsDeColumnas { orden: string[]; ocultas: string[] }
export const PREFS_INICIALES: PrefsDeColumnas = { orden: [...ORDEN_INICIAL], ocultas: [] };

/** Limpia lo guardado: quita claves que ya no existen y agrega al final las nuevas. */
export function normalizaPrefs(p: Partial<PrefsDeColumnas> | null | undefined): PrefsDeColumnas {
  const validas = new Set(ORDEN_INICIAL);
  const orden = (p?.orden ?? []).filter((k, i, a) => validas.has(k) && a.indexOf(k) === i);
  for (const k of ORDEN_INICIAL) if (!orden.includes(k)) orden.push(k);
  const ocultas = (p?.ocultas ?? []).filter((k, i, a) => validas.has(k) && a.indexOf(k) === i);
  return { orden, ocultas };
}

/** Las columnas visibles, en el orden de la persona. */
export function columnasVisibles(p: PrefsDeColumnas): ColumnaDeMerma[] {
  const porKey = new Map(COLUMNAS_DE_MERMA.map((c) => [c.key, c]));
  return normalizaPrefs(p).orden.filter((k) => !p.ocultas.includes(k)).map((k) => porKey.get(k)!);
}

export function alternaColumna(p: PrefsDeColumnas, key: string): PrefsDeColumnas {
  const ocultas = p.ocultas.includes(key) ? p.ocultas.filter((k) => k !== key) : [...p.ocultas, key];
  return { ...p, ocultas };
}

/** Mueve `key` un lugar (flechas ↑ ↓ del ⚙). */
export function mueveColumna(p: PrefsDeColumnas, key: string, delta: -1 | 1): PrefsDeColumnas {
  const orden = [...normalizaPrefs(p).orden];
  const i = orden.indexOf(key); const j = i + delta;
  if (i < 0 || j < 0 || j >= orden.length) return p;
  [orden[i], orden[j]] = [orden[j], orden[i]];
  return { ...p, orden };
}

/** Arrastrar la cabecera `desde` y soltarla sobre `sobre`: queda en el lugar de `sobre`. */
export function sueltaColumna(p: PrefsDeColumnas, desde: string, sobre: string): PrefsDeColumnas {
  if (desde === sobre) return p;
  const orden = normalizaPrefs(p).orden.filter((k) => k !== desde);
  const j = orden.indexOf(sobre);
  if (j < 0) return p;
  const iOriginal = normalizaPrefs(p).orden.indexOf(desde);
  const jOriginal = normalizaPrefs(p).orden.indexOf(sobre);
  orden.splice(iOriginal < jOriginal ? j + 1 : j, 0, desde);
  return { ...p, orden };
}

export function ordenPropio(p: PrefsDeColumnas): boolean {
  const o = normalizaPrefs(p).orden;
  return o.some((k, i) => k !== ORDEN_INICIAL[i]) || p.ocultas.length > 0;
}

/**
 * La primera fila de la cabecera: cada columna suelta ocupa dos filas; cada tramo seguido de columnas de cantidades
 * comparte un «Cantidades» encima (y sus nombres van en la segunda fila).
 */
export type Tramo = { tipo: "suelta"; col: ColumnaDeMerma } | { tipo: "cantidades"; cols: ColumnaDeMerma[] };
export function tramosDeCabecera(visibles: readonly ColumnaDeMerma[]): Tramo[] {
  const out: Tramo[] = [];
  for (const c of visibles) {
    const ult = out[out.length - 1];
    if (c.cantidad) {
      if (ult && ult.tipo === "cantidades") ult.cols.push(c);
      else out.push({ tipo: "cantidades", cols: [c] });
    } else out.push({ tipo: "suelta", col: c });
  }
  return out;
}

/** La fecha del daño corta (dueño, 11 nov): MM/DD/YY, igual en los dos idiomas. «2026-11-11» → «11/11/26». */
export function fmtDiaCorto(dia: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : "";
}
