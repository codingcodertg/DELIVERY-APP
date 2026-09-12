import { fmtMoney } from "@/lib/utils";

/**
 * Cómo se dicen un rango y una regla de la fórmula, en el idioma de quien mira (D-NEXT).
 *
 * Vive aparte porque lo piden **dos** pantallas —el desglose de un pedido y la tabla de
 * Ajustes— y una regla escrita dos veces es una regla que acaba diciendo dos cosas. Recibe la
 * función de traducir en vez de importarla: así es pura y se puede probar sin dibujar nada.
 *
 * Los números **no** se calculan aquí. Llegan ya decididos por `pasoTarifa`, que es quien
 * también decide el precio; esto solo los pone en palabras.
 */

/** La forma de `t(en, es)` que usan las pantallas del hub. */
export type Traducir = (en: string, es: string) => string;

/**
 * «menos de 11 mi», «11–50 mi», «más de 50 mi», «cualquier distancia».
 *
 * Los bordes son los del código —`< 11` y `> 50`—, así que **11 y 50 están dentro** del tramo
 * del medio. Por eso el rango cerrado se dice `11–50` y nunca «11 a 49»: esa segunda forma
 * sería falsa en un punto y nadie lo notaría hasta que un pedido de 50 millas cobrara otra cosa.
 */
export function textoDelRango(t: Traducir, desde: number | null, hasta: number | null): string {
  if (desde == null && hasta == null) return t("any distance", "cualquier distancia");
  if (desde == null) return t(`under ${hasta} mi`, `menos de ${hasta} mi`);
  if (hasta == null) return t(`over ${desde} mi`, `más de ${desde} mi`);
  return `${desde}–${hasta} mi`;
}

/**
 * «$100 fijo», «350 + mi», «120 + 0.8 × mi».
 *
 * El factor decide la forma: 0 es un precio plano, 1 es «base + millas», y cualquier otro lleva
 * el multiplicador a la vista. No hay una cuarta forma porque no hay un cuarto tramo.
 */
export function textoDeLaRegla(t: Traducir, base: number, factor: number): string {
  if (factor === 0) return t(`flat ${fmtMoney(base)}`, `${fmtMoney(base)} fijo`);
  if (factor === 1) return `${base} + mi`;
  return `${base} + ${factor} × mi`;
}
