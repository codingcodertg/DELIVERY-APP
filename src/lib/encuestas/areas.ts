/**
 * Las áreas de la encuesta de clientes (migración 155, app «Encuestas» en /surveys).
 *
 * NO es la encuesta de `src/lib/encuesta.ts` (D-418, tabla `delivery_surveys`): aquella son las estrellas de una
 * orden entregada en la página de seguimiento. Esta es la encuesta del sitio público aparte, con su tabla
 * `survey_responses`.
 *
 * Las claves son el contrato con el sitio público y con la base: `survey_areas_valid()` y
 * `submit_survey_response()` de la 155 aceptan exactamente estas ocho, en este orden (lo compara
 * `encuestas/modulo.test.ts`). Los rótulos son los que escribió el dueño, español primero.
 */
export const AREA_KEYS = [
  "staff_service",
  "wait_time",
  "product_availability",
  "product_quality",
  "pricing",
  "delivery_pickup",
  "returns_exchanges",
  "other",
] as const;

export type AreaKey = (typeof AREA_KEYS)[number];

export const AREA_LABELS: Record<AreaKey, { es: string; en: string }> = {
  staff_service: { es: "Atención del personal", en: "Staff service" },
  wait_time: { es: "Tiempo de espera", en: "Wait time" },
  product_availability: { es: "Disponibilidad de producto", en: "Product availability" },
  product_quality: { es: "Calidad del producto", en: "Product quality" },
  pricing: { es: "Precio", en: "Pricing" },
  delivery_pickup: { es: "Entrega o recogida", en: "Delivery or pickup" },
  returns_exchanges: { es: "Devoluciones o cambios", en: "Returns or exchanges" },
  other: { es: "Otro", en: "Other" },
};

export const NADA_LABEL = { es: "Nada, todo estuvo bien", en: "Nothing, everything was great" };

export const esArea = (k: string): k is AreaKey => (AREA_KEYS as readonly string[]).includes(k);

export function areaLabel(k: string, lang: "en" | "es"): string {
  return esArea(k) ? AREA_LABELS[k][lang] : k;
}
