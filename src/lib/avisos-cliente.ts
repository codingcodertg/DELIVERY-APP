import { isStoreToStore, type OrderTypeRules } from "@/lib/required";
import { BUSINESS_TZ, fmtDateShort, isoInTZ, orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * Avisos al cliente, como OptimoRoute (D-416, migración 150). LA REGLA, sin red ni base.
 *
 * El dueño, 2026-09-27, tras explicarle OptimoRoute (optimoroute.com/customer-notifications): eligió «solos haz 1 3 y
 * 4»; el 1 son estos avisos. Dos:
 *   - `night_before`: la NOCHE ANTES de la entrega, a una hora que se edita en Ajustes.
 *   - `on_the_way`: cuando el chofer VA EN CAMINO — su parada pasa a ser la siguiente de la ruta y ya va en el camión.
 * Por SMS o correo según la preferencia de la orden, con el enlace de seguimiento (/track/<id>) y uno de baja
 * (/unsubscribe/<token>).
 *
 * Aquí vive QUÉ se manda, A QUIÉN y CON QUÉ TEXTO. Quién lo envía (proveedor inyectable) y el registro que lo hace
 * idempotente están en `avisos-cliente-envio.ts`.
 */

export const TIPOS_DE_AVISO = ["night_before", "on_the_way"] as const;
export type TipoDeAviso = typeof TIPOS_DE_AVISO[number];

/** La preferencia de la orden (`deliveries.notify_pref`, 150). `both` es el defecto: se usa lo que haya. */
export const PREFERENCIAS_DE_AVISO = ["both", "sms", "email", "none"] as const;
export type PreferenciaDeAviso = typeof PREFERENCIAS_DE_AVISO[number];

export type IdiomaDelCliente = "en" | "es";

/** Los campos de una orden que este módulo lee. Opcionales los de la 150: una base sin ella no los trae. */
export type OrdenParaAviso = Pick<Delivery, "id" | "order_no" | "order_type" | "stage" | "delivery_date" | "delivery_windows" | "delivery_phone" | "is_training" | "assigned_driver"> & {
  order_code?: string | null;
  order_suffix?: string | null;
  customer_email?: string | null;
  notify_pref?: string | null;
  customer_lang?: string | null;
};

/** Las etapas en las que se avisa. La noche antes: aprobada en adelante y sin entregar (una pendiente puede ser
 * rechazada todavía; un borrador no existe para el cliente). En camino: solo `picked_up`, ya en el camión. */
export const ETAPAS_DEL_AVISO: Record<TipoDeAviso, readonly string[]> = {
  night_before: ["approved", "fulfilling", "ready", "picked_up"],
  on_the_way: ["picked_up"],
};

// ---------------------------------------------------------------------------
// Contacto
// ---------------------------------------------------------------------------

/** Un teléfono de EE. UU. en E.164 (+1XXXXXXXXXX), o null. 10 dígitos, o 11 empezando por 1; el código de área no
 * empieza por 0 ni 1 (esos no existen en el NANP). Un número raro no se manda: un SMS a un número mal escrito cuesta
 * igual y le llega a otra persona. */
export function telefonoValido(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  if (d[0] === "0" || d[0] === "1") return null;
  return `+1${d}`;
}

/** Un correo con forma de correo, en minúsculas, o null. No se valida más: el proveedor rebota el resto. */
export function correoValido(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

/** La preferencia de la orden; lo que no se reconoce (una base sin la 150, un valor viejo) es `both`. */
export function preferenciaDe(o: { notify_pref?: string | null }): PreferenciaDeAviso {
  const v = String(o.notify_pref ?? "");
  return (PREFERENCIAS_DE_AVISO as readonly string[]).includes(v) ? (v as PreferenciaDeAviso) : "both";
}

export function idiomaDe(o: { customer_lang?: string | null }): IdiomaDelCliente | null {
  return o.customer_lang === "en" || o.customer_lang === "es" ? o.customer_lang : null;
}

// ---------------------------------------------------------------------------
// ¿Se avisa?
// ---------------------------------------------------------------------------

export type Decision =
  | { ok: true; sms: string | null; email: string | null }
  | { ok: false; motivo: string };

/**
 * La decisión entera para una orden y un tipo de aviso. En orden:
 * 1. Nunca una orden de enseñanza (`is_training`).
 * 2. Solo lo que va a un CLIENTE: con tipo, y que no sea tienda-a-tienda (Transfer, Intertienda) según las reglas de
 *    Ajustes (`isStoreToStore`, la misma que decide si la ficha pide contacto). Sin tipo, no: no se sabe a quién va.
 * 3. En una etapa del aviso (`ETAPAS_DEL_AVISO`).
 * 4. Preferencia `none` → nada.
 * 5. Los canales que pida la preferencia, solo con un contacto válido y que no se haya dado de baja (`bajas`: teléfonos
 *    en E.164 y correos en minúsculas).
 */
export function decidirAviso(
  o: OrdenParaAviso,
  tipo: TipoDeAviso,
  reglas: OrderTypeRules | undefined,
  bajas: ReadonlySet<string>,
): Decision {
  if (o.is_training === true) return { ok: false, motivo: "training" };
  if (!String(o.order_type ?? "").trim()) return { ok: false, motivo: "sin_tipo" };
  if (isStoreToStore(o.order_type, reglas)) return { ok: false, motivo: "tienda_a_tienda" };
  if (!ETAPAS_DEL_AVISO[tipo].includes(String(o.stage ?? ""))) return { ok: false, motivo: "etapa" };
  const pref = preferenciaDe(o);
  if (pref === "none") return { ok: false, motivo: "no_avisar" };
  const tel = pref === "sms" || pref === "both" ? telefonoValido(o.delivery_phone) : null;
  const mail = pref === "email" || pref === "both" ? correoValido(o.customer_email) : null;
  const sms = tel && !bajas.has(tel) ? tel : null;
  const email = mail && !bajas.has(mail) ? mail : null;
  if (!sms && !email) return { ok: false, motivo: tel || mail ? "dado_de_baja" : "sin_contacto" };
  return { ok: true, sms, email };
}

// ---------------------------------------------------------------------------
// Cuándo
// ---------------------------------------------------------------------------

/** La hora (0-23) en Texas de un instante. */
export function horaEnTexas(ahora: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", hourCycle: "h23" }).format(ahora);
  return Number(h) % 24;
}

/** Mañana (YYYY-MM-DD) en Texas. Se suma sobre el mediodía de hoy para que un cambio de hora no salte dos días. */
export function mananaEnTexas(ahora: Date): string {
  const hoy = isoInTZ(ahora);
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Las horas que se pueden elegir para el aviso de la noche antes, en Texas. Las cubre `vercel.json` (una entrada
 * diaria por hora UTC de 17 a 02, que en verano son 12-21 y en invierno 11-20 en Texas). */
export const HORAS_NOCHE_ANTES = [12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
export const HORA_NOCHE_ANTES_POR_DEFECTO = 18;
/** Pasada esta hora de Texas no se manda nada la noche antes: un SMS a las 10 de la noche molesta más que ayuda (y la
 * TCPA pone el límite en las 9 PM). */
export const HORA_LIMITE_NOCHE_ANTES = 21;

/** ¿Toca mandar los de la noche antes ahora? Desde la hora elegida hasta el límite. Un cron que llegue tarde (Hobby
 * dispara en cualquier momento de su hora) todavía entra; el registro evita repetir. */
export function tocaNocheAntes(ahora: Date, horaElegida: number | null | undefined): boolean {
  const h = horaEnTexas(ahora);
  const elegida = (HORAS_NOCHE_ANTES as readonly number[]).includes(Number(horaElegida)) ? Number(horaElegida) : HORA_NOCHE_ANTES_POR_DEFECTO;
  return h >= elegida && h < HORA_LIMITE_NOCHE_ANTES;
}

/** La parada que toca AHORA en una ruta ya ordenada: la primera sin entregar. Es la misma que «Mi ruta» enseña como
 * «Siguiente parada», y la usan las dos (la pantalla y el aviso «en camino»), para que no puedan discrepar. */
export function siguienteParada<T extends { stage: string }>(ordenadas: readonly T[]): T | null {
  return ordenadas.find((d) => d.stage !== "delivered") ?? null;
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** El alfabeto GSM-7 (básico). Un solo carácter fuera de él pasa TODO el SMS a UCS-2, con 70 caracteres por segmento
 * en vez de 160: más del doble de coste. Por eso los textos en español van sin á/í/ó/ú (é y ñ sí están). */
const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export function esGsm7(texto: string): boolean {
  for (const c of texto) if (!GSM7.includes(c) && !GSM7_EXT.includes(c)) return false;
  return true;
}

/** Cuántos segmentos cobra el operador por este SMS. GSM-7: 160 en uno, 153 por segmento si son varios (los de la
 * extensión cuentan doble). UCS-2: 70, y 67 por segmento. */
export function segmentosSms(texto: string): number {
  if (esGsm7(texto)) {
    let n = 0;
    for (const c of texto) n += GSM7_EXT.includes(c) ? 2 : 1;
    return n <= 160 ? 1 : Math.ceil(n / 153);
  }
  const n = [...texto].length;
  return n <= 70 ? 1 : Math.ceil(n / 67);
}

export type Enlaces = { seguimiento: string; baja: string };
export type TextoDelAviso = { sms: string; asunto: string; correo: string };

/**
 * El texto. Idioma: el de la orden (`customer_lang`, 150) si lo tiene; si no, INGLÉS Y ESPAÑOL en un solo mensaje
 * corto. La orden no guardaba idioma, el cliente puede ser de cualquiera de los dos, y un aviso que no se entiende es
 * un aviso perdido. Medido el 2026-09-27 con los enlaces de producción: los seis textos (2 tipos × en/es/bilingüe) dan
 * 2 segmentos, 201-273 caracteres — los dos enlaces pesan más que el idioma, así que el bilingüe no cuesta más. La
 * prueba exige ≤ 3 bilingüe y ≤ 2 en un idioma, con un número y una ventana largos. La marca es «RDZ», como el SMS de
 * seguimiento que ya existía (OrderModal).
 */
export function textoDelAviso(o: OrdenParaAviso, tipo: TipoDeAviso, enlaces: Enlaces): TextoDelAviso {
  const n = `#${orderLabel({ order_code: o.order_code ?? null, order_no: o.order_no, order_suffix: o.order_suffix ?? null })}`;
  const idioma = idiomaDe(o);
  const ventana = ventanaCorta(o.delivery_windows);
  const fechaEn = fmtDateShort(o.delivery_date, "en");
  const fechaEs = fmtDateShort(o.delivery_date, "es");
  const cuandoEn = [fechaEn, ventana].filter(Boolean).join(" ");
  const cuandoEs = [fechaEs, ventana].filter(Boolean).join(" ");

  const en = tipo === "night_before"
    ? `Your delivery ${n} is scheduled for tomorrow${cuandoEn ? ` (${cuandoEn})` : ""}.`
    : `Your driver is on the way with delivery ${n}.`;
  const es = tipo === "night_before"
    ? `Su entrega ${n} llega mañana${cuandoEs ? ` (${cuandoEs})` : ""}.`
    : `Su chofer va en camino con su entrega ${n}.`;

  const cuerpo = idioma === "en" ? `RDZ: ${en} Track: ${enlaces.seguimiento} Stop alerts: ${enlaces.baja}`
    : idioma === "es" ? `RDZ: ${es} Siga su entrega: ${enlaces.seguimiento} No recibir avisos: ${enlaces.baja}`
    : `RDZ: ${en} / ${es} Track/Siga: ${enlaces.seguimiento} Stop/Baja: ${enlaces.baja}`;

  const asuntoEn = tipo === "night_before" ? `Your delivery ${n} is tomorrow` : `Your delivery ${n} is on the way`;
  const asuntoEs = tipo === "night_before" ? `Su entrega ${n} llega mañana` : `Su entrega ${n} va en camino`;
  const asunto = idioma === "en" ? asuntoEn : idioma === "es" ? asuntoEs : `${asuntoEn} / ${asuntoEs}`;

  const correoEn = `${en}\n\nTrack it live: ${enlaces.seguimiento}\n\nTo stop these updates: ${enlaces.baja}`;
  const correoEs = `${es}\n\nSiga su entrega en vivo: ${enlaces.seguimiento}\n\nPara no recibir estos avisos: ${enlaces.baja}`;
  const correo = idioma === "en" ? correoEn : idioma === "es" ? correoEs : `${correoEn}\n\n---\n\n${correoEs}`;

  return { sms: cuerpo, asunto, correo };
}

/** «0800-1000» → «8-10AM»; «1300-1500» → «1-3PM»; lo que no se entienda, fuera (el texto no lleva basura). */
export function ventanaCorta(w: string | null | undefined): string {
  const m = String(w ?? "").match(/(\d{1,2}):?(\d{2})\s*-\s*(\d{1,2}):?(\d{2})/);
  if (!m) return "";
  const h1 = Number(m[1]), m1 = Number(m[2]), h2 = Number(m[3]), m2 = Number(m[4]);
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return "";
  const hh = (h: number, mm: number) => `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`;
  const ap = (h: number) => (h < 12 ? "AM" : "PM");
  return ap(h1) === ap(h2) ? `${hh(h1, m1)}-${hh(h2, m2)}${ap(h2)}` : `${hh(h1, m1)}${ap(h1)}-${hh(h2, m2)}${ap(h2)}`;
}

/** Un token de baja no adivinable: 16 caracteres base64url de 12 bytes aleatorios (96 bits). Corto porque va en un SMS. */
export function tokenDeBaja(bytes: Uint8Array): string {
  if (bytes.length < 12) throw new Error("tokenDeBaja: hacen falta 12 bytes aleatorios");
  let bin = "";
  for (const b of bytes.slice(0, 12)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const TOKEN_DE_BAJA_RE = /^[A-Za-z0-9_-]{16}$/;

// ---------------------------------------------------------------------------
// ¿Tiene la base la 150? (las migraciones se aplican DESPUÉS de fusionar)
// ---------------------------------------------------------------------------

/** Ajustes con los interruptores de la 150. `settings` es la fila tal cual (`select *`), así que la clave está si y
 * solo si la columna existe. */
export function laBaseTieneAjustesDeAvisos(settings: object): boolean {
  return "notify_night_before_enabled" in settings;
}

/** Órdenes con los campos de la 150 (mismo patrón que `laBaseTienePrioridad`, 147). */
export function laBaseTieneAvisos(ordenes: readonly object[]): boolean {
  return ordenes.some((o) => "notify_pref" in o);
}

/** El guardado de la ficha, con los campos de la 150 solo si la base los admite; sin ella, las claves se quitan
 * (mandarlas haría fallar el guardado de la orden entera). */
export function conAvisosSiCabe<T extends { customer_email?: unknown; notify_pref?: unknown; customer_lang?: unknown }>(payload: T, ordenes: readonly object[]): T {
  if (laBaseTieneAvisos(ordenes)) return payload;
  const { customer_email: _a, notify_pref: _b, customer_lang: _c, ...resto } = payload;
  void _a; void _b; void _c;
  return resto as T;
}

/** Las etapas que mueven la ruta del chofer: al recoger o al entregar, la «siguiente parada» puede cambiar. */
export const ETAPAS_QUE_MUEVEN_LA_RUTA = ["picked_up", "delivered"] as const;

/**
 * Lo que hace la app después de guardar una etapa: si el aviso «en camino» está encendido y la etapa mueve la ruta,
 * pide al servidor que lo compruebe. No espera ni enseña nada: el chofer ya siguió, y un fallo aquí no puede
 * deshacerle la parada. Devuelve si lo pidió (para la prueba).
 */
export function pedirAvisoEnCamino(
  id: string, etapa: string, encendido: boolean | undefined,
  f: (url: string, init: RequestInit) => Promise<unknown> = (u, i) => fetch(u, i),
): boolean {
  if (encendido !== true) return false;
  if (!(ETAPAS_QUE_MUEVEN_LA_RUTA as readonly string[]).includes(etapa)) return false;
  void Promise.resolve()
    .then(() => f("/api/avisos-cliente/en-camino", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }))
    .catch(() => { /* no bloquea al chofer */ });
  return true;
}
