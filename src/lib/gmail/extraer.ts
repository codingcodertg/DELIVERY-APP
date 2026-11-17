/**
 * Del correo crudo de Gmail (RFC 822) a los correos de Indeed que el pipeline puede procesar. SOLO SERVIDOR.
 *
 * Un mensaje exterior puede dar CERO, UNO o VARIOS correos de Indeed:
 *   - Redirigido: el propio mensaje es el de Indeed → un correo.
 *   - Reenviado en lote desde careers@: cada adjunto .eml cuyo From es de Indeed → un correo por adjunto.
 * Los que no pasan la verificación salen como `ok: false` con el motivo (para el contador de omitidos y el log).
 * Nunca se loguean cuerpos ni cabeceras completas: solo motivos.
 */
import { simpleParser, type AddressObject, type Attachment, type ParsedMail } from "mailparser";
import { MAX_CV_BYTES } from "@/lib/outlook/config";
import { esDireccionIndeed } from "@/lib/outlook/indeed";
import { validaCv } from "@/lib/outlook/cv";
import type { MensajeIndeed } from "@/lib/outlook/sincronizar";
import type { CabeceraDeCorreo } from "@/lib/outlook/verificacion";
import { claveDelCorreo } from "./clave";
import { CORREO_DE_COMPANIA, direccionDeFrom, esCorreoDeIndeedReenviado, esReenvioEnLoteDeCompania } from "./verificacion";

export type ResultadoExtraccion = { ok: true; mensaje: MensajeIndeed; via: "redirigido" | "reenvio-en-lote" } | { ok: false; motivo: string };

/** Las cabeceras tal como llegaron, de arriba abajo (mailparser las da en orden, con el nombre en minúsculas). */
export function cabecerasDe(p: ParsedMail): CabeceraDeCorreo[] {
  return (p.headerLines ?? []).map((h) => {
    const linea = h.line.replace(/\r?\n[ \t]+/g, " ");
    return { name: h.key.toLowerCase(), value: linea.slice(linea.indexOf(":") + 1).trim() };
  });
}

const esEml = (a: Attachment) => a.contentType === "message/rfc822" || /\.eml$/i.test(a.filename ?? "");

function primeraDireccion(a: AddressObject | AddressObject[] | undefined): string {
  const obj = Array.isArray(a) ? a[0] : a;
  return (obj?.value?.[0]?.address ?? "").trim().toLowerCase();
}

/** El CV: el primer PDF/DOC/DOCX del correo, validado como en Outlook. */
function cvDelCorreo(adjuntos: readonly Attachment[]): { cv: { nombreFichero: string; bytes: Buffer } | null; avisoAdjunto: string | null } {
  const pick = adjuntos.find((a) => /\.(pdf|docx?)$/i.test(a.filename ?? "") && !esEml(a));
  if (!pick) return { cv: null, avisoAdjunto: null };
  const bytes = pick.content;
  if (!bytes || bytes.length === 0) return { cv: null, avisoAdjunto: null };
  if (bytes.length > MAX_CV_BYTES) return { cv: null, avisoAdjunto: "CV no guardado: el CV pasa de 10 MB" };
  const nombre = pick.filename ?? "cv";
  const v = validaCv(nombre, bytes);
  if (v.ok) return { cv: { nombreFichero: nombre, bytes }, avisoAdjunto: null };
  return { cv: null, avisoAdjunto: `CV no guardado: ${v.motivo}` };
}

function aMensaje(
  p: ParsedMail,
  cabeceras: CabeceraDeCorreo[],
  clave: string,
  fechaRespaldo: Date | null,
  verificacion: { ok: true; motivo: string },
  adjuntos: readonly Attachment[],
): MensajeIndeed {
  const fecha = p.date ?? fechaRespaldo ?? new Date(0);
  const fromAddress = primeraDireccion(p.from);
  const replyTo = (Array.isArray(p.replyTo) ? p.replyTo : p.replyTo ? [p.replyTo] : [])
    .flatMap((a) => a.value ?? [])
    .map((v) => (v.address ?? "").trim().toLowerCase())
    .filter((a) => a.length > 0);
  return {
    clave,
    receivedDateTime: fecha.toISOString(),
    subject: p.subject ?? "",
    from: p.from?.text ?? fromAddress,
    fromAddress,
    replyTo,
    // El HTML conserva los enlaces de la solicitud (href); si no hay, el texto.
    bodyText: typeof p.html === "string" && p.html.length > 0 ? p.html : (p.text ?? ""),
    cabeceras,
    verificacion,
    cvDelCorreo: async () => cvDelCorreo(adjuntos),
  };
}

/**
 * Los correos de Indeed que contiene un mensaje crudo de la INBOX. `uidvalidity` y `uid` sirven de clave si el correo
 * no trae Message-ID; `fechaRespaldo` es la fecha IMAP por si falta la cabecera Date.
 */
export async function correosDeIndeedEnMensaje(
  fuente: Buffer,
  p: { uidvalidity: number; uid: number; fechaRespaldo: Date | null },
): Promise<ResultadoExtraccion[]> {
  const outer = await simpleParser(fuente);
  const cab = cabecerasDe(outer);
  const fromExterior = direccionDeFrom(cab);

  // (b) Reenvío en lote de la empresa: un correo por cada adjunto .eml de Indeed.
  if (fromExterior === CORREO_DE_COMPANIA) {
    const emls = outer.attachments.filter(esEml);
    if (emls.length === 0) return [];
    const exterior = esReenvioEnLoteDeCompania(cab);
    if (!exterior.ok) return [{ ok: false, motivo: exterior.motivo }];
    const salida: ResultadoExtraccion[] = [];
    for (let i = 0; i < emls.length; i++) {
      const inner = await simpleParser(emls[i].content);
      const cabInterior = cabecerasDe(inner);
      const fromInterior = direccionDeFrom(cabInterior);
      if (!fromInterior || !esDireccionIndeed(fromInterior)) {
        salida.push({ ok: false, motivo: "adjunto .eml que no es de Indeed" });
        continue;
      }
      const clave = claveDelCorreo({ messageId: inner.messageId, uidvalidity: p.uidvalidity, uid: p.uid, parte: i });
      salida.push({
        ok: true,
        via: "reenvio-en-lote",
        mensaje: aMensaje(inner, cabInterior, clave, p.fechaRespaldo, { ok: true, motivo: exterior.motivo }, inner.attachments),
      });
    }
    return salida;
  }

  // (a) Redirigido: el propio mensaje es de Indeed. Si no lo es, no es asunto nuestro (la búsqueda ya filtró).
  if (!fromExterior || !esDireccionIndeed(fromExterior)) return [];
  const v = esCorreoDeIndeedReenviado(cab);
  if (!v.ok) return [{ ok: false, motivo: v.motivo }];
  const clave = claveDelCorreo({ messageId: outer.messageId, uidvalidity: p.uidvalidity, uid: p.uid });
  return [{ ok: true, via: "redirigido", mensaje: aMensaje(outer, cab, clave, p.fechaRespaldo, { ok: true, motivo: v.motivo }, outer.attachments) }];
}
