import type { CancelReason, Delivery, Settings } from "./types";

/**
 * Los motivos por los que se anula una orden (D-291, migración 122).
 *
 * El dueño: «agrega una opción para anular órdenes y deben dejar razón por qué la anularon, ya sea
 * duplicación, o cliente canceló, o cliente recogerá en tienda».
 *
 * Lo que ya había y por qué no bastaba: la ficha enseñaba un selector con seis motivos **fijos en el
 * código**, el admin no podía tocarlos, faltaba el de recoger en tienda, y el motivo **no se guardaba
 * en ninguna columna** — solo como nota del evento de etapa. Peor: se guardaba la etiqueta **traducida**,
 * así que la misma causa quedaba escrita «Customer canceled» o «Cliente canceló» según el idioma de
 * quien anulara, y eso no se puede contar en un reporte.
 *
 * Por eso lo que viaja a la base es la **clave**, y la pantalla la traduce. Una clave que el admin haya
 * borrado de la lista se enseña tal cual, sin inventarse una etiqueta: es lo que se anotó entonces.
 */

/** La clave del motivo «otro», la única que exige texto libre — y la única que conoce por su nombre el
 *  guard de la 122, que rechaza dejarla sin escribir. */
export const MOTIVO_OTRO = "other";

/** El motivo de la barrida automática por retraso (`AUTO_CANCEL_LATE_ENABLED`, hoy apagada). Existe para
 *  que, si algún día se enciende, lo que anule quede con motivo como todo lo demás y no con una nota
 *  suelta en inglés. */
export const MOTIVO_POR_RETRASO = "late_no_reschedule";

/** Lo que trae la app si nadie ha tocado la lista. Los tres primeros son, literalmente, los que pidió
 *  el dueño; los otros dos estaban en la lista vieja del formulario y se conservan para no perderlos. */
export const MOTIVOS_SEMBRADOS: CancelReason[] = [
  { key: "duplicate", en: "Duplicate order", es: "Orden duplicada" },
  { key: "customer_canceled", en: "Customer canceled", es: "Cliente canceló" },
  { key: "customer_pickup", en: "Customer will pick up at the store", es: "Cliente recogerá en tienda" },
  { key: "out_of_stock", en: "Out of stock", es: "Sin existencias" },
  { key: "wrong_info", en: "Wrong information", es: "Información incorrecta" },
  { key: MOTIVO_POR_RETRASO, en: "Late without rescheduling", es: "Atrasada sin reprogramar" },
  { key: MOTIVO_OTRO, en: "Other", es: "Otro", free_text: true },
];

/** Las claves que la app necesita que existan, pasara lo que pasara con la lista: el editor de Datos no
 *  deja borrarlas. `other` porque el guard la nombra; la del retraso porque la escribe la barrida. */
export const MOTIVOS_QUE_NO_SE_BORRAN: readonly string[] = [MOTIVO_OTRO, MOTIVO_POR_RETRASO];

/** La lista vigente: la del admin, o la sembrada si nunca se guardó ninguna. Una lista guardada vacía
 *  también cae en la sembrada — un desplegable obligatorio sin opciones no se puede rellenar. */
export function motivosDeAnulacion(settings: Pick<Settings, "cancel_reasons">): CancelReason[] {
  const suya = settings.cancel_reasons;
  return suya && suya.length > 0 ? suya : MOTIVOS_SEMBRADOS;
}

/** ¿Este motivo pide texto libre? Lo dice la lista; si la clave ya no está, solo `other`. */
export function pideTextoLibre(key: string | null | undefined, motivos: CancelReason[]): boolean {
  const m = motivos.find((x) => x.key === key);
  return m ? m.free_text === true : key === MOTIVO_OTRO;
}

/** La etiqueta en el idioma de quien mira. Una clave desconocida —borrada de la lista, o de una orden
 *  anulada antes de la 122— se devuelve tal cual: se enseña lo que se anotó, no una suposición. */
export function etiquetaDeMotivo(key: string | null | undefined, motivos: CancelReason[], lang: "en" | "es"): string {
  if (!key) return "";
  const m = motivos.find((x) => x.key === key);
  if (!m) return key;
  return lang === "es" ? m.es : m.en;
}

/** Lo que se lee en la ficha y en la lista: la etiqueta y, si lo hay, el texto libre detrás. */
export function motivoDeAnulacion(
  d: Pick<Delivery, "canceled_reason" | "canceled_reason_note">,
  motivos: CancelReason[],
  lang: "en" | "es",
): string {
  const etiqueta = etiquetaDeMotivo(d.canceled_reason, motivos, lang);
  const nota = (d.canceled_reason_note ?? "").trim();
  if (!etiqueta) return nota;
  return nota ? `${etiqueta} — ${nota}` : etiqueta;
}

/**
 * Lo que impide anular, o nada. **Es el espejo del guard de la 122**: el mismo motivo por el que la base
 * rechazaría la escritura, dicho antes de mandarla. Lo llaman el formulario, la anulación en bloque y
 * los dos proveedores de datos, para que no haya un camino que llegue a la base sin motivo — que es
 * justo lo que pasaba con el botón de anular en bloque, que no mandaba ninguno.
 */
export function faltaParaAnular(
  reason: string | null | undefined,
  nota: string | null | undefined,
  motivos: CancelReason[],
  lang: "en" | "es",
): string | null {
  if (!(reason ?? "").trim()) {
    return lang === "es" ? "Una orden anulada necesita un motivo." : "A canceled order needs a reason.";
  }
  if (pideTextoLibre(reason, motivos) && !(nota ?? "").trim()) {
    return lang === "es"
      ? `El motivo «${etiquetaDeMotivo(reason, motivos, lang)}» necesita que se escriba cuál.`
      : `The «${etiquetaDeMotivo(reason, motivos, lang)}» reason needs its free text.`;
  }
  return null;
}

/** Los diacríticos que deja `normalize("NFD")`, por sus códigos. Escritos como escape unicode, la
 *  herramienta que editó este fichero los resolvía a caracteres invisibles dentro de la clase. */
const DIACRITICOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");

/** La clave que se guarda cuando el admin añade un motivo nuevo escribiendo su etiqueta. Se calcula una
 *  vez, al crearlo; renombrar la etiqueta después **no** la cambia, que es el sentido de que sea estable.
 *  Sin acentos ni signos, porque viaja a la base y se lee en consultas a mano. */
export function claveDesdeEtiqueta(etiqueta: string, yaUsadas: readonly string[]): string {
  const base = etiqueta
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const raiz = base || "reason";
  if (!yaUsadas.includes(raiz)) return raiz;
  for (let i = 2; i < 100; i++) {
    const intento = `${raiz}_${i}`;
    if (!yaUsadas.includes(intento)) return intento;
  }
  return `${raiz}_${Date.now()}`;
}
