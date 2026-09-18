import type { FicheroAdjunto } from "./help-attachments";
import { AYUDA_ATENDIDA_KIND, type NotifSeed } from "./notifications";

/**
 * El historial de solicitudes de ayuda (D-285).
 *
 * El dueño: «en mi usuario de Andrés, créame una vista para ver todas las solicitudes de ayuda en el
 * hub». Antes no había historial: `/api/help` mandaba el correo y no guardaba nada, así que una
 * solicitud que no llegara —o que llegara a una bandeja que nadie mira— se perdía sin rastro.
 *
 * Aquí vive lo que decide la pantalla: qué se enseña, qué se filtra y qué se escribe al atender. Quién
 * ve qué **no se decide aquí**, sino en la 120: el admin lee todo y cada persona lee las suyas.
 */

export type EstadoDeSolicitud = "pendiente" | "atendida";

export type SolicitudDeAyuda = {
  id: string;
  created_at: string;
  user_id: string | null;
  sender_name: string | null;
  sender_email: string | null;
  role_label: string | null;
  page: string | null;
  app_version: string | null;
  lang: string | null;
  message: string;
  files: FicheroAdjunto[] | null;
  email_to: string | null;
  email_ok: boolean | null;
  email_error: string | null;
  status: EstadoDeSolicitud;
  attended_by: string | null;
  attended_at: string | null;
};

export type FiltroDeSolicitudes = {
  persona?: string;
  desde?: string;
  hasta?: string;
};

/** El nombre con el que se agrupa y se filtra: el guardado, y si falta, el correo o «—». */
export function quienEscribe(s: Pick<SolicitudDeAyuda, "sender_name" | "sender_email">): string {
  return (s.sender_name || "").trim() || (s.sender_email || "").trim() || "—";
}

/** Las personas que han escrito alguna, sin repetir y en orden. */
export function personasDeSolicitudes(filas: SolicitudDeAyuda[]): string[] {
  return [...new Set(filas.map(quienEscribe))].sort((a, b) => a.localeCompare(b));
}

/**
 * El filtro de la pantalla. Las fechas son días (`YYYY-MM-DD`) y se comparan contra el día local de la
 * solicitud, no contra el instante en UTC: quien filtra «hasta el 17» espera ver lo del 17 entero.
 */
export function diaLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function filtraSolicitudes(filas: SolicitudDeAyuda[], f: FiltroDeSolicitudes): SolicitudDeAyuda[] {
  return filas.filter((s) => {
    if (f.persona && quienEscribe(s) !== f.persona) return false;
    const dia = diaLocal(s.created_at);
    if (f.desde && (!dia || dia < f.desde)) return false;
    if (f.hasta && (!dia || dia > f.hasta)) return false;
    return true;
  });
}

/** Qué pasó con el correo de esa solicitud, dicho en una línea. */
export function resumenDelEnvio(s: Pick<SolicitudDeAyuda, "email_ok" | "email_error" | "email_to">, t: (en: string, es: string) => string): string {
  if (s.email_ok === true) return t(`Emailed to ${s.email_to ?? "support"}`, `Correo enviado a ${s.email_to ?? "soporte"}`);
  if (s.email_ok === false) return t(`Email failed: ${s.email_error || "unknown"}`, `El correo falló: ${s.email_error || "sin detalle"}`);
  return t("Email result unknown", "Sin saber si el correo salió");
}

/**
 * Lo que se escribe al marcarla, en los dos sentidos. Al atender se guarda **quién y cuándo**, que es
 * lo que la 120 exige para ese estado; al devolverla a pendiente se limpian los dos, para que no quede
 * una firma de algo que ya no está atendido.
 */
export function parcheDeEstado(nuevo: EstadoDeSolicitud, adminId: string, ahora: Date) {
  return nuevo === "atendida"
    ? { status: "atendida" as const, attended_by: adminId, attended_at: ahora.toISOString() }
    : { status: "pendiente" as const, attended_by: null, attended_at: null };
}

/** Los adjuntos guardados de una fila, siempre una lista. */
export function adjuntosDe(s: Pick<SolicitudDeAyuda, "files">): FicheroAdjunto[] {
  return Array.isArray(s.files) ? s.files.filter((a) => !!a && typeof a.path === "string") : [];
}

// ---- Atenderla se le avisa a quien la escribió (D-NEXT) -----------------------------------------
//
// Hasta ahora atender una solicitud era un cambio que solo veía el admin: la persona que pidió ayuda
// no se enteraba de nada, y la única señal posible era que el problema dejara de pasar. El dueño:
// que se le avise.

/** Cuánto del mensaje viaja en el aviso: lo justo para reconocer cuál de las suyas es. */
export const ASOMO_DEL_MENSAJE = 60;

/** El principio del mensaje, en una línea. Los saltos y los espacios de más se comen. */
export function asomoDelMensaje(mensaje: string, limite = ASOMO_DEL_MENSAJE): string {
  const limpio = mensaje.replace(/\s+/g, " ").trim();
  return limpio.length <= limite ? limpio : `${limpio.slice(0, limite - 1).trimEnd()}…`;
}

/**
 * El aviso para el remitente de que su solicitud ya está atendida.
 *
 * Devuelve `null` cuando no hay a quién avisar, y son dos casos distintos que la pantalla cuenta
 * distinto:
 *   · **la cuenta se borró** — `user_id` quedó en null por el `on delete set null` de la 120, así que
 *     no existe destinatario: la solicitud se atiende igual y se dice que no había a quién avisar;
 *   · **quien atiende es quien escribió** — nadie se avisa a sí mismo, igual que `notificationsForStage`
 *     nunca avisa a quien hizo la acción.
 *
 * El texto va **en el idioma que tenía la persona al escribir**, que la 120 guarda en `lang`: este aviso
 * lo lee ella, no quien lo manda. `lang` es texto libre en la base, así que se mira el principio
 * («es», «es-MX») y sin idioma se queda en inglés, como el resto de los avisos de la campana.
 *
 * No lleva `delivery_id` ni `order_no` a propósito: no es una orden, y la campana ya sabe no navegar
 * cuando no hay orden (`NotificationBell`, `onPick`).
 */
export function avisoDeAtendida(s: SolicitudDeAyuda, adminId: string): NotifSeed | null {
  if (!s.user_id || s.user_id === adminId) return null;
  const asomo = asomoDelMensaje(s.message);
  const enEspanol = (s.lang ?? "").trim().toLowerCase().startsWith("es");
  return {
    user_id: s.user_id,
    delivery_id: null,
    order_no: null,
    kind: AYUDA_ATENDIDA_KIND,
    message: enEspanol
      ? `Tu solicitud de ayuda ya está atendida: «${asomo}»`
      : `Your help request has been handled: “${asomo}”`,
  };
}

/**
 * Las pendientes por un lado y las atendidas por otro: el archivo deja de estorbar la lista de trabajo.
 *
 * Pendiente es **todo lo que no está atendido**, no solo lo que dice `'pendiente'`. Si algún día hay un
 * tercer estado, aparecerá en la lista de trabajo —donde se ve— en vez de desaparecer dentro del
 * archivo, que es donde nadie mira.
 */
export function separaPorEstado(filas: SolicitudDeAyuda[]): { pendientes: SolicitudDeAyuda[]; atendidas: SolicitudDeAyuda[] } {
  return {
    pendientes: filas.filter((s) => s.status !== "atendida"),
    atendidas: filas.filter((s) => s.status === "atendida"),
  };
}
