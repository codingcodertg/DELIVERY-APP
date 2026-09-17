import type { FicheroAdjunto } from "./help-attachments";

/**
 * El historial de solicitudes de ayuda (D-NEXT).
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
  soloPendientes?: boolean;
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
    if (f.soloPendientes && s.status !== "pendiente") return false;
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
