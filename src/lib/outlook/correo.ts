/**
 * Lectura del buzón con Microsoft Graph (solo lectura: nunca marca, mueve ni borra correo; Mail.Read no lo permite).
 * SOLO SERVIDOR. Los errores llevan el código de HTTP, no el cuerpo de la respuesta.
 */
import { MAX_CV_BYTES, MAX_MENSAJES_POR_CORRIDA } from "./config";
import { ErrorMicrosoft, GRAPH } from "./microsoft";

type FetchFn = typeof fetch;

export interface MensajeGraph {
  id: string;
  internetMessageId: string | null;
  subject: string;
  from: string;
  /** Solo la dirección del From, tal cual la da Graph (sin el nombre): es la que se verifica. */
  fromAddress: string;
  replyTo: string[];
  receivedDateTime: string;
  bodyText: string;
  hasAttachments: boolean;
  /** Cabeceras del correo tal como llegaron (Authentication-Results, para verificar que es de Indeed). */
  cabeceras: Array<{ name: string; value: string }>;
}

export interface PaginaCorreos {
  mensajes: MensajeGraph[];
  /** Total de correos en la bandeja desde la fecha (solo si se pidió `contar`). */
  total: number | null;
}

export interface AdjuntoGraph {
  id: string;
  name: string;
  contentType: string | null;
  size: number;
}

/**
 * Los correos recibidos desde `desdeIso` (incluido), del más viejo al más nuevo, como mucho `MAX_MENSAJES_POR_CORRIDA`.
 * El orden ascendente deja que la corrida avance el cursor sin saltarse ninguno.
 */
export async function listarCorreosDesde(accessToken: string, desdeIso: string, fetchFn: FetchFn = fetch): Promise<MensajeGraph[]> {
  const pagina = await listarPaginaDeBandeja(accessToken, { desdeIso, saltar: 0, tope: MAX_MENSAJES_POR_CORRIDA }, fetchFn);
  return pagina.mensajes;
}

/**
 * Una página de la BANDEJA DE ENTRADA (no «todos los correos»: así la carpeta de no deseados queda fuera), desde la
 * fecha, del más viejo al más nuevo. `contar` pide el total (para el progreso del procesamiento de correos antiguos).
 * Se codifica a mano (%20, no «+»): OData no siempre acepta «+» como espacio dentro de $filter.
 */
export async function listarPaginaDeBandeja(
  accessToken: string,
  p: { desdeIso: string; saltar: number; tope: number; contar?: boolean },
  fetchFn: FetchFn = fetch,
): Promise<PaginaCorreos> {
  const q: Array<[string, string]> = [
    ["$filter", `receivedDateTime ge ${p.desdeIso}`],
    ["$select", "id,internetMessageId,subject,from,replyTo,receivedDateTime,body,hasAttachments,internetMessageHeaders"],
    ["$top", String(p.tope)],
    ["$orderby", "receivedDateTime asc"],
  ];
  if (p.saltar > 0) q.push(["$skip", String(p.saltar)]);
  if (p.contar) q.push(["$count", "true"]);
  const qs = q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}`, prefer: 'outlook.body-content-type="text"' };
  if (p.contar) headers.ConsistencyLevel = "eventual";
  const res = await fetchFn(`${GRAPH}/me/mailFolders/inbox/messages?${qs}`, { headers, cache: "no-store" });
  if (!res.ok) throw new ErrorMicrosoft("correo", `HTTP ${res.status}`);
  const j = (await res.json()) as { value?: Array<Record<string, unknown>>; "@odata.count"?: number };
  return { mensajes: (j.value ?? []).map(aMensaje), total: typeof j["@odata.count"] === "number" ? j["@odata.count"] : null };
}

function aMensaje(m: Record<string, unknown>): MensajeGraph {
  const from = (m.from as { emailAddress?: { address?: string; name?: string } } | null)?.emailAddress;
  const replyTo = ((m.replyTo as Array<{ emailAddress?: { address?: string } }> | null) ?? [])
    .map((r) => r.emailAddress?.address ?? "")
    .filter((a) => a.length > 0);
  const body = m.body as { contentType?: string; content?: string } | null;
  return {
    id: String(m.id),
    internetMessageId: (m.internetMessageId as string | null) ?? null,
    subject: String(m.subject ?? ""),
    fromAddress: (from?.address ?? "").trim().toLowerCase(),
    from: from?.address ? (from.name ? `${from.name} <${from.address}>` : from.address) : "",
    replyTo,
    receivedDateTime: String(m.receivedDateTime),
    bodyText: body?.content ?? "",
    hasAttachments: Boolean(m.hasAttachments),
    cabeceras: ((m.internetMessageHeaders as Array<{ name?: string; value?: string }> | null) ?? [])
      .map((h) => ({ name: String(h.name ?? ""), value: String(h.value ?? "") }))
      .filter((h) => h.name.length > 0),
  };
}

export async function listarAdjuntos(accessToken: string, messageId: string, fetchFn: FetchFn = fetch): Promise<AdjuntoGraph[]> {
  const res = await fetchFn(
    `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size`,
    { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  );
  if (!res.ok) throw new ErrorMicrosoft("correo", `HTTP ${res.status}`);
  const j = (await res.json()) as { value?: Array<{ id: string; name?: string; contentType?: string; size?: number; "@odata.type"?: string }> };
  return (j.value ?? [])
    .filter((a) => !a["@odata.type"] || a["@odata.type"].endsWith("fileAttachment"))
    .map((a) => ({ id: a.id, name: a.name ?? "", contentType: a.contentType ?? null, size: a.size ?? 0 }));
}

/** Los bytes de un adjunto de archivo. Devuelve null si no es un archivo o pasa del tamaño máximo (nunca lo baja entero). */
export async function descargarAdjunto(
  accessToken: string,
  messageId: string,
  adjunto: AdjuntoGraph,
  fetchFn: FetchFn = fetch,
): Promise<Buffer | null> {
  if (adjunto.size > MAX_CV_BYTES) return null;
  const res = await fetchFn(
    `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(adjunto.id)}`,
    { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  );
  if (!res.ok) throw new ErrorMicrosoft("correo", `HTTP ${res.status}`);
  const j = (await res.json()) as { contentBytes?: string };
  if (!j.contentBytes) return null;
  const buf = Buffer.from(j.contentBytes, "base64");
  return buf.length > 0 && buf.length <= MAX_CV_BYTES ? buf : null;
}
