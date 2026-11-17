/**
 * Conexión IMAP con Gmail (contraseña de aplicación). SOLO SERVIDOR.
 *
 * Solo lectura: la bandeja se abre con EXAMINE (readOnly) y las descargas usan BODY.PEEK, así que no se marca ningún
 * correo como leído ni se mueve, borra o cambia nada. `logger: false`: la contraseña nunca llega a un log.
 * Los errores se reducen a un código seguro; el texto que manda el servidor no se guarda.
 */
import { ImapFlow } from "imapflow";

export const HOST_GMAIL = "imap.gmail.com";

/**
 * La búsqueda de Gmail (X-GM-RAW): correos de Indeed (directos o redirigidos) y los reenvíos en lote de careers@ con
 * adjuntos. Es un filtro de ahorro: la verificación de verdad la hace `verificacion.ts` sobre cada correo.
 */
export const BUSQUEDA_INDEED = "(from:indeed.com OR from:indeedemail.com OR from:indeedmail.com OR (from:rdztilegroup.net has:attachment))";

export type CodigoErrorGmail = "credenciales" | "conexion";

export function codigoDeErrorGmail(e: unknown): CodigoErrorGmail {
  return (e as { authenticationFailed?: boolean } | null)?.authenticationFailed ? "credenciales" : "conexion";
}

export interface SesionGmail {
  client: ImapFlow;
  uidvalidity: number;
  uidNext: number;
}

/** Abre la INBOX en solo lectura. Lanza un error con código (`credenciales` o `conexion`), nunca con la contraseña. */
export async function abreInbox(email: string, password: string): Promise<SesionGmail> {
  const client = new ImapFlow({
    host: HOST_GMAIL,
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    emitLogs: false,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  client.on("error", () => {
    // Los errores de socket se recogen por la promesa de cada llamada; este listener evita que tumben el proceso.
  });
  try {
    await client.connect();
    const buzon = await client.mailboxOpen("INBOX", { readOnly: true });
    return { client, uidvalidity: Number(buzon.uidValidity), uidNext: Number(buzon.uidNext) };
  } catch (e) {
    await client.logout().catch(() => undefined);
    throw new Error(`gmail:${codigoDeErrorGmail(e)}`);
  }
}

/** Los UID (de la INBOX) de todos los correos que cumplen la búsqueda, del más viejo al más nuevo. */
export async function uidsDeIndeed(client: ImapFlow): Promise<number[]> {
  const r = await client.search({ gmraw: BUSQUEDA_INDEED }, { uid: true });
  if (!Array.isArray(r)) return [];
  return r.map(Number).sort((a, b) => a - b);
}

/** El correo crudo de un UID, con BODY.PEEK (no lo marca como leído). Null si ya no existe. */
export async function descargaCorreo(client: ImapFlow, uid: number): Promise<{ fuente: Buffer; fecha: Date | null } | null> {
  const m = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
  if (!m || !m.source) return null;
  return { fuente: m.source, fecha: m.internalDate ? new Date(m.internalDate) : null };
}
