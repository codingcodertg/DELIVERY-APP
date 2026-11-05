/**
 * Los avisos (la campana 🔔) de las solicitudes de cliente (D-867, migración 243).
 *
 * El dueño: «cuando se cree un customer, que le notifique al usuario que lo pidió […] y si es rechazado, enviado a
 * revisar o aceptado, que le mande la notificación a ese usuario».
 *
 * Los avisos los ESCRIBE la base, en la misma transacción que la decisión (el disparador de la 243 sobre
 * `erp.customer_requests`), en `public.notifications`, la tabla de la campana de Entregas. Esto es lo puro: los textos
 * (que el SQL repite igual, y la prueba lo vigila), el enlace de cada aviso y a dónde lleva un aviso cualquiera al
 * pulsarlo, para las dos campanas.
 *
 * Sin la 243 en la base: la tabla no tiene `link` ni `message_es`; la campana enseña los avisos de siempre y estos
 * simplemente no llegan.
 */

export const AVISO_CLIENTE_NUEVA = "cliente_solicitud_nueva";
export const AVISO_CLIENTE_APROBADA = "cliente_solicitud_aprobada";
export const AVISO_CLIENTE_RECHAZADA = "cliente_solicitud_rechazada";
export const AVISO_CLIENTE_REVISAR = "cliente_solicitud_revisar";

export const AVISOS_DE_CLIENTE = [AVISO_CLIENTE_NUEVA, AVISO_CLIENTE_APROBADA, AVISO_CLIENTE_RECHAZADA, AVISO_CLIENTE_REVISAR] as const;
export type AvisoDeCliente = (typeof AVISOS_DE_CLIENTE)[number];

export const esAvisoDeCliente = (kind: string): kind is AvisoDeCliente => (AVISOS_DE_CLIENTE as readonly string[]).includes(kind);

export interface DatosDelAviso {
  /** El nombre del cliente (`payload.account`, o el de la fila en una edición). */
  cuenta: string;
  /** 'alta' o 'edicion'. */
  clase: "alta" | "edicion";
  /** Las tiendas («PHR», «PHR, ROMA»). */
  tiendas?: string;
  /** Quien pidió (en la nueva). */
  quien?: string;
  /** La nota del rechazo o de «Revisar». */
  nota?: string | null;
}

const conNota = (base: string, nota: string | null | undefined) => {
  const n = (nota ?? "").trim();
  return n ? `${base}: ${n}` : base;
};

/** El texto en los dos idiomas. La 243 lo arma igual en SQL. */
export function textoDelAviso(kind: AvisoDeCliente, d: DatosDelAviso): { en: string; es: string } {
  const cuenta = d.cuenta.trim() || "?";
  switch (kind) {
    case AVISO_CLIENTE_NUEVA: {
      const tiendas = d.tiendas?.trim() ? ` (${d.tiendas.trim()})` : "";
      const quien = d.quien?.trim() || "?";
      return d.clase === "edicion"
        ? { en: `📝 New edit request: ${cuenta}${tiendas} from ${quien}`, es: `📝 Nueva solicitud de edición: ${cuenta}${tiendas} de ${quien}` }
        : { en: `📝 New customer request: ${cuenta}${tiendas} from ${quien}`, es: `📝 Nueva solicitud de cliente: ${cuenta}${tiendas} de ${quien}` };
    }
    case AVISO_CLIENTE_APROBADA:
      return d.clase === "edicion"
        ? { en: `✅ Edit to ${cuenta} approved`, es: `✅ Edición de ${cuenta} aprobada` }
        : { en: `✅ Customer ${cuenta} approved`, es: `✅ Cliente ${cuenta} aprobado` };
    case AVISO_CLIENTE_RECHAZADA:
      return { en: conNota(`❌ Request for ${cuenta} rejected`, d.nota), es: conNota(`❌ Solicitud de ${cuenta} rechazada`, d.nota) };
    case AVISO_CLIENTE_REVISAR:
      return { en: conNota(`⚠️ Request for ${cuenta} needs a check`, d.nota), es: conNota(`⚠️ Solicitud de ${cuenta} por revisar`, d.nota) };
  }
}

/**
 * El enlace de un aviso: lo aprobado, a la ficha del cliente (el primero creado, o el editado); lo demás, a Clientes
 * con esa solicitud abierta. La 243 lo arma igual.
 */
export function enlaceDelAviso(kind: AvisoDeCliente, s: { id: number; customer_id?: number | null; created_ids?: readonly number[] | null }): string {
  if (kind === AVISO_CLIENTE_APROBADA) {
    const ficha = s.created_ids?.[0] ?? s.customer_id ?? null;
    if (ficha != null) return `/customers/${ficha}`;
  }
  return `/customers?solicitud=${s.id}`;
}

/** El id de `?solicitud=N`, o null. */
export function solicitudDelEnlace(valor: string | null | undefined): number | null {
  const n = Number((valor ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** El texto que se pinta: el español si lo hay y se mira en español; si no, `message`. */
export function mensajeDelAviso(n: { message: string; message_es?: string | null }, lang: string): string {
  return lang === "es" && n.message_es?.trim() ? n.message_es : n.message;
}

/** Solo enlaces internos de la app: nada de `//otro-sitio` ni `javascript:`. */
export function enlaceSeguro(link: string | null | undefined): string | null {
  const l = (link ?? "").trim();
  return l.startsWith("/") && !l.startsWith("//") ? l : null;
}
