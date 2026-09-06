// ============================================================
// Mensajes del servidor del ERP, en los dos idiomas (G-10b).
//
// El servidor no sabe el idioma del usuario (usePrefs vive en localStorage, sin cookie), así que
// una acción de servidor NO devuelve texto: devuelve un código, y si el mensaje lleva datos
// variables (un importe, el detalle de un fallo de lectura), esos datos van aparte en `params`.
// Es el mismo patrón que `clock-in/actions/clock.ts` (D-201): `{ ok: false, code }` y el cliente
// traduce. Los pares viven aquí, en un solo sitio, y el guardián de i18n del ERP (i18n.test.ts)
// comprueba que cada código que emite `actions.ts` o `domain/po-parse.ts` tiene su par, y al revés.
//
// Lo que NO pasa por aquí: los `error.message` de Supabase / PostgREST, que las pantallas enseñan
// tal cual como dato del servidor (D-192, D-204), y los textos de `error-codes.ts`, que solo
// consume la ruta de trabajos `/api/erp/jobs/refresh-daltile-matches` y ninguna pantalla.
//
// Puro e isomorfo: lo importan las acciones ("use server") para el tipo y `fail()`, y los
// componentes de cliente para el texto.
// ============================================================

export type Params = Record<string, string>;
type Par = { en: string; es: string };

/** Los textos en inglés son los literales que había en el servidor, letra por letra. */
export const ERP_MESSAGES = {
  // actions.ts
  NOT_SIGNED_IN: { en: "Not signed in", es: "No has iniciado sesión" },
  NOT_AUTHORIZED: { en: "not authorized", es: "sin permiso" },
  NO_EDITABLE_FIELDS: { en: "no editable fields", es: "ningún campo editable" },
  SAME_RELATION: { en: "same relation", es: "misma relación" },
  DESCRIBE_FIX: { en: "Describe the fix", es: "Describe el arreglo" },
  NEW_ITEM_FIELDS_REQUIRED: {
    en: "SKU, name, product type and status are required",
    es: "SKU, nombre, tipo de producto y estado son obligatorios",
  },
  NO_UNMATCHED_LINES: { en: "No unmatched lines to import", es: "No hay líneas sin emparejar que importar" },
  NO_PDF_FILE: { en: "No PDF file provided.", es: "No se adjuntó ningún PDF." },
  PDF_TOO_LARGE: { en: "PDF too large (max 10 MB).", es: "PDF demasiado grande (máx. 10 MB)." },
  PDF_NOT_RECOGNIZED: {
    en: "Couldn't recognize this PDF as a PO or acknowledgment. Try paste / CSV / manual.",
    es: "No se reconoció este PDF como PO ni como confirmación. Prueba pegar texto, CSV o a mano.",
  },
  PDF_READ_FAILED: { en: "Couldn't read the PDF: {detail}", es: "No se pudo leer el PDF: {detail}" },
  // domain/po-parse.ts (avisos de lectura, `warnings`)
  PO_NUMBER_NOT_READ: {
    en: "Could not read the PO number — enter it manually.",
    es: "No se pudo leer el número de PO — introdúcelo a mano.",
  },
  NO_LINES_RECOGNIZED: {
    en: "No line items recognized — use CSV or manual entry.",
    es: "No se reconoció ninguna línea — usa CSV o entrada manual.",
  },
  TOTAL_MISMATCH: {
    en: "Line amounts sum to {sum} but the document total is {total} — review.",
    es: "Las líneas suman {sum} pero el total del documento es {total} — revísalo.",
  },
  ACK_NUMBER_NOT_READ: {
    en: "Could not read the acknowledgment document number — enter it manually.",
    es: "No se pudo leer el número de la confirmación — introdúcelo a mano.",
  },
  ACK_PO_NOT_READ: {
    en: "Could not read the linked PO number — set it so the proforma matches its PO.",
    es: "No se pudo leer el número de PO vinculado — ponlo para que la proforma case con su PO.",
  },
} as const satisfies Record<string, Par>;

export type ErpCode = keyof typeof ERP_MESSAGES;

/** Un mensaje tal como viaja: código y, si hace falta, datos. Sin texto. */
export type Mensaje = { code: ErpCode; params?: Params };

/** Fallo de una acción del servidor con un mensaje propio (no un `error.message` de Supabase). */
export type ErpFail = { ok: false; code: ErpCode; params?: Params };

export function fail(code: ErpCode, params?: Params): ErpFail {
  return params ? { ok: false, code, params } : { ok: false, code };
}

/** Rellena `{clave}` con `params[clave]`; una clave sin dato queda vacía, nunca se enseña la llave. */
export function rellenar(plantilla: string, params?: Params): string {
  return plantilla.replace(/\{(\w+)\}/g, (_, k: string) => params?.[k] ?? "");
}

type T = (en: string, es: string) => string;

/** El texto de un mensaje en el idioma del usuario (`t` es el de usePrefs). */
export function mensajeTexto(m: Mensaje, t: T): string {
  const par = ERP_MESSAGES[m.code];
  return t(rellenar(par.en, m.params), rellenar(par.es, m.params));
}

/**
 * El texto de un fallo de acción: si trae código, su par; si trae `error`, es un mensaje de
 * Supabase y se enseña tal cual (dato del servidor, no se traduce).
 */
export function failText(f: { error: string } | Mensaje, t: T): string {
  return "code" in f ? mensajeTexto(f, t) : f.error;
}
