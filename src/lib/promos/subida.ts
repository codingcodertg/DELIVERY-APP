import type { NamedLocation } from "@/lib/types";
import type { ResultadoPromo } from "./excel";

/**
 * RTG PROMOS — la parte **pura** de subir una ronda: qué se acepta, qué se rechaza y qué filas se
 * escriben exactamente.
 *
 * Vive aquí y no dentro de las rutas a propósito. Lo que `commit` acaba escribiendo en producción
 * con la llave de servicio —que se salta la RLS entera— es el resultado de `filasParaGuardar`, y
 * una función pura se prueba sin base de datos, sin navegador y sin tocar nada. Las rutas quedan
 * finas: comprobar quién llama, leer el fichero, y escribir lo que esto devuelva.
 */

/** Los topes. Los tres últimos **copian las restricciones de la migración 140** a propósito. */
export const LIMITES = {
  /** El libro real pesa 43 KB. Cinco megas deja sitio de sobra sin aceptar cualquier cosa. */
  bytesDelFichero: 5 * 1024 * 1024,
  /** El libro real trae 60 productos. Dos mil es un techo, no una expectativa. */
  productosPorRonda: 2000,
  /** `promo_rounds_label_no_vacia`: entre 1 y 120. */
  largoDeEtiqueta: 120,
  /** `promo_products_code_no_vacio`: entre 1 y 80. */
  largoDeCodigo: 80,
  /** `promo_suggestions_grupo_no_vacio` y el de decisiones: entre 1 y 40. */
  largoDeGrupo: 40,
} as const;

/**
 * Los grupos de promociones que el admin ya cruzó en Ajustes, sin repetir y en el orden en que
 * aparecen. De aquí sale el `gruposConocidos` de `leePromo`, y es lo único que convierte el nombre
 * de una hoja en «sugerencias de este grupo».
 *
 * Vacío es un estado legítimo —el día que se estrena esto ninguna tienda lo tiene puesto— y
 * entonces el libro entero es universo y no hay sugerencias. No es un error; es lo honesto.
 */
export function gruposDeAjustes(stores: readonly NamedLocation[] | null | undefined): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const s of stores ?? []) {
    const g = (s.promo_group ?? "").trim();
    if (!g) continue;
    const clave = g.toUpperCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(g);
  }
  return out;
}

export type ProblemaDeSubida =
  | { codigo: "FICHERO_FALTA"; detalle: string }
  | { codigo: "FICHERO_GRANDE"; detalle: string }
  | { codigo: "ETIQUETA"; detalle: string }
  | { codigo: "SIN_PRODUCTOS"; detalle: string }
  | { codigo: "DEMASIADOS_PRODUCTOS"; detalle: string }
  | { codigo: "CODIGO_LARGO"; detalle: string }
  | { codigo: "GRUPO_LARGO"; detalle: string };

/** Qué etiqueta lleva la ronda: la que escribió el admin, o el nombre del fichero sin extensión. */
export function etiquetaDeRonda(escrita: string | null | undefined, nombreDeFichero: string | null | undefined): string {
  const a = (escrita ?? "").trim();
  if (a) return a.slice(0, LIMITES.largoDeEtiqueta);
  const b = (nombreDeFichero ?? "").trim().replace(/\.[a-z0-9]+$/i, "");
  return b.slice(0, LIMITES.largoDeEtiqueta);
}

/** El fichero, antes de gastar nada en leerlo. */
export function problemaDelFichero(nombre: string | null | undefined, bytes: number): ProblemaDeSubida | null {
  if (!nombre || bytes <= 0) return { codigo: "FICHERO_FALTA", detalle: "no llegó ningún fichero" };
  if (bytes > LIMITES.bytesDelFichero) {
    return { codigo: "FICHERO_GRANDE", detalle: `el fichero pesa ${bytes} bytes y el tope son ${LIMITES.bytesDelFichero}` };
  }
  return null;
}

/**
 * Lo leído, antes de escribir nada.
 *
 * Los tres últimos casos son las restricciones de la 140: un código de 81 caracteres o un grupo de
 * 41 **reventarían el `insert` entero** y la ronda quedaría a medias. Se comprueban aquí para poder
 * decir cuál es la fila mala, que es lo que un error de Postgres no dice.
 */
export function problemaDeLoLeido(r: ResultadoPromo, etiqueta: string): ProblemaDeSubida | null {
  if (etiqueta.length < 1 || etiqueta.length > LIMITES.largoDeEtiqueta) {
    return { codigo: "ETIQUETA", detalle: `la etiqueta de la ronda tiene que medir entre 1 y ${LIMITES.largoDeEtiqueta} caracteres` };
  }
  if (r.productos.length === 0) {
    return { codigo: "SIN_PRODUCTOS", detalle: "el libro no trae ninguna hoja de productos que se pueda leer" };
  }
  if (r.productos.length > LIMITES.productosPorRonda) {
    return { codigo: "DEMASIADOS_PRODUCTOS", detalle: `el libro trae ${r.productos.length} productos y el tope son ${LIMITES.productosPorRonda}` };
  }
  const largo = r.productos.find((p) => p.code.length > LIMITES.largoDeCodigo);
  if (largo) {
    return { codigo: "CODIGO_LARGO", detalle: `«${largo.code.slice(0, 20)}…» (hoja ${largo.sourceSheet}, fila ${largo.rowNo}) pasa de ${LIMITES.largoDeCodigo} caracteres` };
  }
  const grupo = r.sugerencias.find((s) => s.groupCode.length > LIMITES.largoDeGrupo);
  if (grupo) {
    return { codigo: "GRUPO_LARGO", detalle: `el grupo «${grupo.groupCode}» pasa de ${LIMITES.largoDeGrupo} caracteres` };
  }
  return null;
}

export interface FilaDeProducto {
  round_id: string;
  code: string;
  supplier: string | null;
  size: string | null;
  description: string | null;
  notes: string | null;
  demand: number | null;
  months_of_stock: number | null;
  cost: number | null;
  diff: number | null;
  qoh: number | null;
  qoh_by_store: Record<string, number | null>;
  price: number | null;
  source_sheet: string;
  row_no: number;
}

export interface FilaDeSugerencia {
  round_id: string;
  code: string;
  group_code: string;
}

/**
 * Las filas exactas que se escriben. **Esto es lo que acaba en producción**, así que se prueba
 * aquí, campo por campo, en vez de comprobarlo después mirando la base.
 *
 * Las claves son las columnas de la 140, en `snake_case`; el lector devuelve `camelCase` porque es
 * TypeScript. La traducción es este sitio y ningún otro.
 */
export function filasParaGuardar(roundId: string, r: ResultadoPromo): {
  productos: FilaDeProducto[];
  sugerencias: FilaDeSugerencia[];
} {
  return {
    productos: r.productos.map((p) => ({
      round_id: roundId,
      code: p.code,
      supplier: p.supplier,
      size: p.size,
      description: p.description,
      notes: p.notes,
      demand: p.demand,
      months_of_stock: p.monthsOfStock,
      cost: p.cost,
      diff: p.diff,
      qoh: p.qoh,
      qoh_by_store: p.qohByStore,
      price: p.price,
      source_sheet: p.sourceSheet,
      row_no: p.rowNo,
    })),
    sugerencias: r.sugerencias.map((s) => ({ round_id: roundId, code: s.code, group_code: s.groupCode })),
  };
}

/**
 * Lo que `preview` devuelve al navegador.
 *
 * **Sin las cinco columnas privadas**, y eso es una decisión, no un descuido: quien sube es un
 * admin y la base sí le dejaría verlas, pero para confirmar que un libro se leyó bien hacen falta
 * el código, la descripción, el precio y las existencias — el costo no. No se manda por el cable lo
 * que no se necesita, que es la misma idea que sostiene el privilegio de columna de la 140.
 */
export function resumenParaPantalla(r: ResultadoPromo) {
  return {
    productos: r.productos.length,
    sugerencias: r.sugerencias.length,
    avisos: r.avisos,
    muestra: r.productos.map((p) => ({
      code: p.code,
      description: p.description,
      price: p.price,
      qoh: p.qoh,
      sourceSheet: p.sourceSheet,
      rowNo: p.rowNo,
    })),
    gruposConSugerencias: Array.from(new Set(r.sugerencias.map((s) => s.groupCode))),
  };
}
