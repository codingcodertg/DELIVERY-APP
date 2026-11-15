/**
 * La revisión del buzón: lo que hace el cron cada 15 minutos y «Revisar ahora». SOLO SERVIDOR.
 *
 * Orden de una corrida:
 *   1. Lee la conexión (una fila) y descifra el refresh token; pide un access token nuevo y, si Microsoft rota el
 *      refresh token, guarda el nuevo cifrado.
 *   2. Lee como mucho 50 correos desde el cursor (menos un margen), del más viejo al más nuevo. Solo lectura.
 *   3. Para cada correo de Indeed ya visto en `outlook_processed`, no hace nada. Si es nuevo, lo RECLAMA con un insert
 *      (`failed` + «en proceso»): si otra corrida lo reclamó antes, el insert choca con la clave y se salta. Así cron y
 *      «Revisar ahora» no crean dos veces.
 *   4. Clasifica: solicitud → candidato (con dedupe), mensaje → nota en la ficha del candidato, otro → omitido.
 *   5. Anota el resultado, avanza el cursor y guarda la fecha de la revisión y el último error (sin tokens).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrar, claveDelEntorno, descifrar } from "./cifrado";
import { MARGEN_CURSOR_MS, MAX_MENSAJES_POR_CORRIDA, VENTANA_INICIAL_MS, variablesQueFaltan } from "./config";
import { crearCandidatoDesdeCorreo } from "./crear-candidato";
import { descargarAdjunto, listarAdjuntos, listarCorreosDesde, type MensajeGraph } from "./correo";
import { ErrorMicrosoft, refrescarAcceso } from "./microsoft";
import { anotarMensajeEnCandidato, buscarCandidatoParaMensaje, textoDeLaNota } from "./mensaje-a-candidato";
import {
  clasificaCorreoIndeed,
  direccionDe,
  esCorreoDeIndeed,
  leerCandidatoDeIndeed,
  leerMensajeDeIndeed,
  type CorreoDeIndeed,
} from "./indeed";
import { validaCv } from "./cv";

export type ResultadoFila = "created" | "duplicate" | "noted" | "skipped" | "failed";

export interface ResumenRevision {
  ok: boolean;
  /** Motivo si no se pudo revisar (clave corta, para el log y la tarjeta). */
  motivo?: string;
  revisados: number;
  creados: number;
  duplicados: number;
  notas: number;
  omitidos: number;
  fallidos: number;
}

const VACIO: ResumenRevision = { ok: false, revisados: 0, creados: 0, duplicados: 0, notas: 0, omitidos: 0, fallidos: 0 };

/**
 * El nuevo cursor. Si la corrida vio TODO lo que había hasta ahora (menos de 50 correos), el cursor puede ir hasta
 * ahora menos el margen. Si llenó el lote, el cursor va hasta el último correo leído: el resto sale en la siguiente.
 * Nunca retrocede.
 */
export function nuevoCursor(p: { cursorAnterior: Date; ultimoRecibido: string | null; ahora: Date; llenoElLote: boolean }): Date {
  let c = p.cursorAnterior;
  if (p.ultimoRecibido) {
    const u = new Date(p.ultimoRecibido);
    if (!Number.isNaN(u.getTime()) && u > c) c = u;
  }
  if (!p.llenoElLote) {
    const hasta = new Date(p.ahora.getTime() - MARGEN_CURSOR_MS);
    if (hasta > c) c = hasta;
  }
  return c;
}

/** Desde dónde leer: el cursor menos el margen, o la ventana inicial si nunca se ha revisado. */
export function desdeParaLeer(cursor: Date | null, ahora: Date): Date {
  const base = cursor ?? new Date(ahora.getTime() - VENTANA_INICIAL_MS);
  return new Date(base.getTime() - MARGEN_CURSOR_MS);
}

export interface DepsRevision {
  db: SupabaseClient;
  env: Record<string, string | undefined>;
  ahora: Date;
  fetchFn?: typeof fetch;
}

/** Un mensaje de error seguro para guardar: nunca un token (los errores de Microsoft solo traen el código). */
function mensajeSeguro(e: unknown): string {
  if (e instanceof ErrorMicrosoft) return `Microsoft (${e.paso}): ${e.codigo}`;
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 200);
}

export async function revisarBuzonIndeed(deps: DepsRevision): Promise<ResumenRevision> {
  const { db, env, ahora } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const rec = db.schema("recruiting");

  const faltan = variablesQueFaltan(env);
  if (faltan.length) return { ...VACIO, motivo: `faltan variables: ${faltan.join(", ")}` };

  const { data: conn, error: eConn } = await rec.from("outlook_connection").select("*").eq("id", 1).maybeSingle();
  if (eConn) return { ...VACIO, motivo: `no se pudo leer la conexión: ${eConn.message}` };
  if (!conn?.refresh_token_enc) return { ...VACIO, motivo: "no conectado" };

  const registrarError = async (texto: string, cursor?: string | null) => {
    await rec
      .from("outlook_connection")
      .update({ last_check_at: ahora.toISOString(), last_error: texto, ...(cursor ? { last_message_received_at: cursor } : {}) })
      .eq("id", 1);
  };

  const clave = claveDelEntorno(env);
  let refresh: string;
  try {
    refresh = descifrar(conn.refresh_token_enc as string, clave);
  } catch {
    await registrarError("No se pudo leer el token guardado: vuelve a conectar Outlook.");
    return { ...VACIO, motivo: "token ilegible" };
  }

  const tenant = env.MS_TENANT_ID as string;
  const credenciales = { tenant, clientId: env.MS_CLIENT_ID as string, clientSecret: env.MS_CLIENT_SECRET as string };
  let accessToken: string;
  try {
    const r = await refrescarAcceso({ ...credenciales, refreshToken: refresh }, fetchFn);
    accessToken = r.accessToken;
    if (r.refreshToken) {
      // Microsoft rotó el refresh token: el nuevo va cifrado, antes de seguir.
      const { error } = await rec.from("outlook_connection").update({ refresh_token_enc: cifrar(r.refreshToken, clave) }).eq("id", 1);
      if (error) throw new Error(`no se pudo guardar el token rotado: ${error.message}`);
    }
  } catch (e) {
    const texto =
      e instanceof ErrorMicrosoft && e.codigo === "invalid_grant"
        ? "La conexión con Outlook caducó o se revocó: vuelve a conectar Outlook."
        : `Microsoft no renovó el acceso (${mensajeSeguro(e)}). Se reintenta en la siguiente revisión.`;
    await registrarError(texto);
    return { ...VACIO, motivo: "no se renovó el acceso" };
  }

  const cursorAnterior = conn.last_message_received_at ? new Date(conn.last_message_received_at as string) : null;
  let mensajes: MensajeGraph[];
  try {
    mensajes = await listarCorreosDesde(accessToken, desdeParaLeer(cursorAnterior, ahora).toISOString(), fetchFn);
  } catch (e) {
    await registrarError(`No se pudo leer el buzón (${mensajeSeguro(e)}). Se reintenta en la siguiente revisión.`);
    return { ...VACIO, motivo: "no se pudo leer el buzón" };
  }

  // Ya vistos: se consulta por id en una sola llamada (son como mucho 50).
  const ids = mensajes.map((m) => m.id);
  const yaVistos = new Set<string>();
  if (ids.length) {
    const { data: vistos, error: eVistos } = await rec.from("outlook_processed").select("message_id").in("message_id", ids);
    if (eVistos) return { ...VACIO, motivo: `no se pudo leer lo ya procesado: ${eVistos.message}` };
    for (const v of vistos ?? []) yaVistos.add((v as { message_id: string }).message_id);
  }

  const res: ResumenRevision = { ok: true, revisados: 0, creados: 0, duplicados: 0, notas: 0, omitidos: 0, fallidos: 0 };
  const dominioBuzon = (conn.mailbox as string | null)?.split("@")[1]?.toLowerCase() ?? null;
  for (const m of mensajes) {
    if (!esCorreoDeIndeed(m.from) || yaVistos.has(m.id)) continue;
    res.revisados++;
    let fila: ResultadoFila | "ya-reclamado";
    try {
      fila = await procesaCorreo(db, m, dominioBuzon, accessToken, fetchFn);
    } catch (e) {
      // Un correo que no se pudo ni reclamar ni anotar no tumba la corrida: se cuenta y sigue con el siguiente.
      console.error(`[outlook] correo no procesado: ${mensajeSeguro(e)}`);
      fila = "failed";
    }
    if (fila === "ya-reclamado") res.revisados--;
    else if (fila === "created") res.creados++;
    else if (fila === "duplicate") res.duplicados++;
    else if (fila === "noted") res.notas++;
    else if (fila === "skipped") res.omitidos++;
    else res.fallidos++;
  }

  const cursor = nuevoCursor({
    cursorAnterior: cursorAnterior ?? desdeParaLeer(null, ahora),
    ultimoRecibido: mensajes.length ? mensajes[mensajes.length - 1].receivedDateTime : null,
    ahora,
    llenoElLote: mensajes.length >= MAX_MENSAJES_POR_CORRIDA,
  });
  await rec
    .from("outlook_connection")
    .update({
      last_check_at: ahora.toISOString(),
      last_error: res.fallidos ? `${res.fallidos} correo(s) no se pudieron procesar: revisa la lista.` : null,
      last_message_received_at: cursor.toISOString(),
    })
    .eq("id", 1);
  return res;
}

/** Procesa un correo: lo reclama, lo clasifica, actúa y anota el resultado. Nunca lanza: un error queda en la fila. */
async function procesaCorreo(
  db: SupabaseClient,
  m: MensajeGraph,
  dominioBuzon: string | null,
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<ResultadoFila | "ya-reclamado"> {
  const rec = db.schema("recruiting");
  const correo: CorreoDeIndeed = {
    subject: m.subject,
    from: m.from,
    replyTo: m.replyTo,
    cuerpo: m.bodyText,
    recibido: m.receivedDateTime,
    dominioBuzon,
  };
  const { error: eClaim } = await rec.from("outlook_processed").insert({
    message_id: m.id,
    received_at: m.receivedDateTime,
    subject: m.subject.slice(0, 300),
    from_address: direccionDe(m.from).slice(0, 200),
    result: "failed",
    error: "en proceso",
  });
  if (eClaim) {
    if (eClaim.code === "23505") return "ya-reclamado"; // otra corrida ya lo tiene
    throw new Error(`no se pudo reclamar el correo: ${eClaim.message}`);
  }

  let resultado: ResultadoFila = "failed";
  let candidateId: string | null = null;
  let error: string | null = null;
  try {
    const tipo = clasificaCorreoIndeed(correo);
    if (tipo === "message") {
      const r = leerMensajeDeIndeed(correo);
      if (!r.ok) {
        resultado = "skipped";
        error = r.motivo;
      } else {
        const busqueda = await buscarCandidatoParaMensaje(db, r.mensaje.candidateName, r.mensaje.puesto);
        if (busqueda.tipo === "unico") {
          await anotarMensajeEnCandidato(db, busqueda.id, textoDeLaNota(r.mensaje, m.receivedDateTime));
          resultado = "noted";
          candidateId = busqueda.id;
        } else {
          resultado = "skipped";
          error = busqueda.tipo === "ambiguo" ? `message, no matching candidate (ambiguous: ${busqueda.cuantos} matches)` : "message, no matching candidate";
        }
      }
    } else if (tipo === "application") {
      const r = leerCandidatoDeIndeed(correo);
      if (!r.ok) {
        resultado = "skipped";
        error = r.motivo;
      } else {
        let cv: { nombreFichero: string; bytes: Buffer } | null = null;
        let avisoAdjunto: string | null = null;
        if (m.hasAttachments) {
          const adjuntos = await listarAdjuntos(accessToken, m.id, fetchFn);
          const pick = adjuntos.find((a) => /\.(pdf|docx?)$/i.test(a.name));
          if (pick) {
            const bytes = await descargarAdjunto(accessToken, m.id, pick, fetchFn);
            if (bytes) {
              const v = validaCv(pick.name, bytes);
              if (v.ok) cv = { nombreFichero: pick.name, bytes };
              else avisoAdjunto = `CV no guardado: ${v.motivo}`;
            }
          }
        }
        const alta = await crearCandidatoDesdeCorreo(db, r.candidato, cv);
        resultado = alta.resultado;
        candidateId = alta.candidateId;
        error = alta.avisoCv ?? avisoAdjunto;
      }
    } else {
      resultado = "skipped";
      error = "no es una solicitud ni un mensaje de candidato";
    }
  } catch (e) {
    resultado = "failed";
    error = mensajeSeguro(e);
  }

  await rec.from("outlook_processed").update({ result: resultado, candidate_id: candidateId, error }).eq("message_id", m.id);
  return resultado;
}

/** Lo que enseña la tarjeta: la conexión sin secretos, el conteo de la semana y los últimos 20 correos. */
export async function estadoOutlook(db: SupabaseClient, env: Record<string, string | undefined>, ahora: Date) {
  const rec = db.schema("recruiting");
  const faltan = variablesQueFaltan(env);
  const { data: conn } = await rec
    .from("outlook_connection")
    .select("mailbox, connected_at, last_check_at, last_error")
    .eq("id", 1)
    .maybeSingle();
  const hace7 = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: creados7 }, { data: ultimos }] = await Promise.all([
    rec.from("outlook_processed").select("message_id", { count: "exact", head: true }).eq("result", "created").gte("processed_at", hace7),
    rec.from("outlook_processed").select("message_id, received_at, subject, from_address, result, error, candidate_id, processed_at").order("processed_at", { ascending: false }).limit(20),
  ]);
  return {
    configurada: faltan.length === 0,
    faltan,
    // El buzón se guarda junto con el token en el alta: si hay buzón, hay conexión. El token nunca se lee aquí.
    conectada: Boolean(conn?.mailbox),
    buzon: (conn?.mailbox as string | null) ?? null,
    conectadaEl: (conn?.connected_at as string | null) ?? null,
    ultimaRevision: (conn?.last_check_at as string | null) ?? null,
    ultimoError: (conn?.last_error as string | null) ?? null,
    creadosUltimos7Dias: creados7 ?? 0,
    ultimos: ultimos ?? [],
  };
}
