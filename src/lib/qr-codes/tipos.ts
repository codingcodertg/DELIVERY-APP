/**
 * Los tipos de página de la app «QR Codes»: lo que se abre al elegir una tarjeta del selector. Para añadir un tipo
 * nuevo basta una entrada en `TIPOS_QR` (y su sección en `QrCodesApp`). `soloAdmin` lo decide quién lo ve.
 */
export const CLAVES_TIPO_QR = ["encuestas", "tarjetas"] as const;
export type ClaveTipoQr = (typeof CLAVES_TIPO_QR)[number];

export interface TipoQr {
  clave: ClaveTipoQr;
  titulo_en: string;
  titulo_es: string;
  descripcion_en: string;
  descripcion_es: string;
  emoji: string;
  /** Solo lo ve el admin. Quien no lo es no ve la tarjeta en el selector. */
  soloAdmin: boolean;
}

export const TIPOS_QR: readonly TipoQr[] = [
  {
    clave: "encuestas",
    titulo_en: "Surveys",
    titulo_es: "Encuestas",
    descripcion_en: "Customer survey answers and the QR codes that open the survey",
    descripcion_es: "Respuestas de la encuesta de clientes y los QR que abren la encuesta",
    emoji: "📋",
    soloAdmin: false,
  },
  {
    clave: "tarjetas",
    titulo_en: "Business cards",
    titulo_es: "Tarjetas de presentación",
    descripcion_en: "One digital card per person, opened from its NFC tag",
    descripcion_es: "Una tarjeta digital por persona, que se abre desde su NFC",
    emoji: "🪪",
    soloAdmin: true,
  },
];

/** Los tipos que ve quien mira: el admin ve todos; los demás, los que no son solo de admin. */
export function tiposVisibles(esAdmin: boolean, tipos: readonly TipoQr[] = TIPOS_QR): TipoQr[] {
  return tipos.filter((t) => esAdmin || !t.soloAdmin);
}

/** El tipo de la URL (`?tipo=…`), si existe y lo puede ver quien mira; si no, null. */
export function tipoDesdeParam(valor: string | null | undefined, visibles: readonly TipoQr[]): ClaveTipoQr | null {
  if (!valor) return null;
  return visibles.some((t) => t.clave === valor) ? (valor as ClaveTipoQr) : null;
}
