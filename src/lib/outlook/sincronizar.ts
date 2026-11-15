/**
 * La revisión del buzón: lo que hace el cron cada 15 minutos, «Revisar ahora» y «Procesar correos anteriores». SOLO SERVIDOR.
 *
 * Orden de una corrida:
 *   1. Lee la conexión y descifra el refresh token; pide un access token nuevo (si Microsoft rota el refresh token, el
 *      nuevo se guarda cifrado).
 *   2. Lee como mucho 50 correos de la BANDEJA desde el cursor (menos un margen), del más viejo al más nuevo. Solo lectura.
 *   3. Para cada correo de Indeed ya visto en `outlook_processed`, no hace nada. Si es nuevo, lo RECLAMA con un insert
 *      (`failed` + «en proceso»): si otra corrida lo reclamó antes, el insert choca con la clave y se salta.
 *   4. Verifica que viene de Indeed (Authentication-Results). Sin verificar → omitido, «not verified as Indeed».
 *   5. Clasifica: solicitud → candidato (con dedupe); mensaje → candidato + teléfono + llamada en el calendario + nota.
 *   6. Anota el resultado, avanza el cursor (solo hacia adelante) y guarda la fecha de la revisión y el último error.
 *
 * «Procesar correos anteriores» usa los mismos pasos, por lotes de 50 y en DOS FASES: primero todas las solicitudes del
 * rango y luego todos los mensajes, para que un mensaje nunca llegue antes que su solicitud.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cifrar, claveDelEntorno, descifrar } from "./cifrado";
import { MARGEN_CURSOR_MS, MAX_MENSAJES_POR_CORRIDA, VENTANA_INICIAL_MS, variablesQueFaltan } from "./config";
import { crearCandidatoDesdeCorreo } from "./crear-candidato";
import { descargarAdjunto, listarAdjuntos, listarCorreosDesde, listarPaginaDeBandeja, type MensajeGraph } from "./correo";
import { ErrorMicrosoft, refrescarAcceso } from "./microsoft";
import { procesarMensaje } from "./mensaje-a-candidato";
import {
  clasificaCorreoIndeed,
  direccionDe,
  esCorreoDeIndeed,
  esDireccionIndeed,
  leerCandidatoDeIndeed,
  leerMensajeDeIndeed,
  type CorreoDeIndeed,
  type TipoCorreoIndeed,
} from "./indeed";
import { validaCv } from "./cv";
import { verificadoComoIndeed } from "./verificacion";

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
 * ahora menos el margen. Si llenó el lote, el cursor va hasta el último correo leído. Nunca retrocede.
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

/** El cursor solo avanza: el máximo entre el actual y el correo más reciente que se procesó. */
export function avanzaCursor(actual: string | null, recibidos: readonly string[]): string | null {
  let mejor = actual ? Date.parse(actual) : Number.NEGATIVE_INFINITY;
  for (const r of recibidos) {
    const t = Date.parse(r);
    if (!Number.isNaN(t) && t > mejor) mejor = t;
  }
  return Number.isFinite(mejor) ? new Date(mejor).toISOString() : null;
}

export type FaseBackfill = "solicitud" | "mensaje";

/** Orden fijo del procesamiento de correos antiguos: primero las solicitudes, luego los mensajes. */
export const FASES_BACKFILL: readonly FaseBackfill[] = ["solicitud", "mensaje"];

/** ¿Este tipo de correo se procesa en esta fase? «other» (alertas de Indeed) se registra en la fase de solicitudes. */
export function enFase(tipo: TipoCorreoIndeed, fase: FaseBackfill): boolean {
  return fase === "solicitud" ? tipo !== "message" : tipo === "message";
}

/** Quita los correos que ya están en `yaVistos` (la segunda pasada sobre el mismo rango no crea nada). */
export function seleccionaNuevos<T extends { id: string }>(lista: readonly T[], yaVistos: ReadonlySet<string>): T[] {
  return lista.filter((x) => !yaVistos.has(x.id));
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

type Acceso =
  | { ok: true; accessToken: string; mailbox: string | null; cursor: string | null; clave: Buffer; registrarError: (t: string) => Promise<void> }
  | { ok: false; motivo: string };

/** Conexión + access token nuevo. Si Microsoft rota el refresh token, lo guarda cifrado antes de seguir. */
async function accesoDeConexion(deps: DepsRevision): Promise<Acceso> {
  const { db, env, ahora } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const rec = db.schema("recruiting");

  const faltan = variablesQueFaltan(env);
  if (faltan.length) return { ok: false, motivo: `faltan variables: ${faltan.join(", ")}` };

  const { data: conn, error: eConn } = await rec.from("outlook_connection").select("*").eq("id", 1).maybeSingle();
  if (eConn) return { ok: false, motivo: `no se pudo leer la conexión: ${eConn.message}` };
  if (!conn?.refresh_token_enc) return { ok: false, motivo: "no conectado" };

  const registrarError = async (texto: string) => {
    await rec.from("outlook_connection").update({ last_check_at: ahora.toISOString(), last_error: texto }).eq("id", 1);
  };

  const clave = claveDelEntorno(env);
  let refresh: string;
  try {
    refresh = descifrar(conn.refresh_token_enc as string, clave);
  } catch {
    await registrarError("No se pudo leer el token guardado: vuelve a conectar Outlook.");
    return { ok: false, motivo: "token ilegible" };
  }

  const credenciales = { tenant: env.MS_TENANT_ID as string, clientId: env.MS_CLIENT_ID as string, clientSecret: env.MS_CLIENT_SECRET as string };
  let accessToken: string;
  try {
    const r = await refrescarAcceso({ ...credenciales, refreshToken: refresh }, fetchFn);
    accessToken = r.accessToken;
    if (r.refreshToken) {
      const { error } = await rec.from("outlook_connection").update({ refresh_token_enc: cifrar(r.refreshToken, clave) }).eq("id", 1);
      if (error) throw new Error(`no se pudo guardar el token rotado: ${error.message}`);
    }
  } catch (e) {
    const texto =
      e instanceof ErrorMicrosoft && e.codigo === "invalid_grant"
        ? "La conexión con Outlook caducó o se revocó: vuelve a conectar Outlook."
        : `Microsoft no renovó el acceso (${mensajeSeguro(e)}). Se reintenta en la siguiente revisión.`;
    await registrarError(texto);
    return { ok: false, motivo: "no se renovó el acceso" };
  }
  return {
    ok: true,
    accessToken,
    mailbox: (conn.mailbox as string | null) ?? null,
    cursor: (conn.last_message_received_at as string | null) ?? null,
    clave,
    registrarError,
  };
}

/** La revisión normal (cron y «Revisar ahora»): desde el cursor, como mucho 50 correos. */
export async function revisarBuzonIndeed(deps: DepsRevision): Promise<ResumenRevision> {
  const { db, ahora } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const rec = db.schema("recruiting");

  const acc = await accesoDeConexion(deps);
  if (!acc.ok) return { ...VACIO, motivo: acc.motivo };

  const cursorAnterior = acc.cursor ? new Date(acc.cursor) : null;
  let mensajes: MensajeGraph[];
  try {
    mensajes = await listarCorreosDesde(acc.accessToken, desdeParaLeer(cursorAnterior, ahora).toISOString(), fetchFn);
  } catch (e) {
    await acc.registrarError(`No se pudo leer el buzón (${mensajeSeguro(e)}). Se reintenta en la siguiente revisión.`);
    return { ...VACIO, motivo: "no se pudo leer el buzón" };
  }

  const yaVistos = await yaProcesados(db, mensajes.map((m) => m.id));
  const res: ResumenRevision = { ok: true, revisados: 0, creados: 0, duplicados: 0, notas: 0, omitidos: 0, fallidos: 0 };
  const dominioBuzon = acc.mailbox?.split("@")[1]?.toLowerCase() ?? null;
  for (const m of seleccionaNuevos(mensajes, yaProcesadosSet(yaVistos))) {
    if (!esCorreoDeIndeed(m.from)) continue;
    res.revisados++;
    const fila = await procesaSeguro(db, m, { dominioBuzon, accessToken: acc.accessToken, fetchFn, ahora, fase: null });
    contaFila(res, fila);
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

export interface ParamsBackfill {
  db: SupabaseClient;
  env: Record<string, string | undefined>;
  ahora: Date;
  /** Desde qué fecha (ISO). El cliente valida que no pase de 180 días. */
  desdeIso: string;
  fase: FaseBackfill;
  /** Cuántos correos de la bandeja saltar (paginación por tamaño de lote). */
  saltar: number;
  fetchFn?: typeof fetch;
}

export interface ResumenBackfill extends ResumenRevision {
  fase: FaseBackfill;
  saltar: number;
  /** Total de correos de la bandeja en el rango (solo en la primera página de la fase). */
  total: number | null;
  /** Dónde sigue; null = terminó todo. */
  siguiente: { fase: FaseBackfill; saltar: number } | null;
}

/** Un lote de 50 correos de la bandeja para una fase. Idempotente: lo ya reclamado se salta. */
export async function procesarLoteAntiguo(p: ParamsBackfill): Promise<ResumenBackfill> {
  const { db, ahora } = p;
  const fetchFn = p.fetchFn ?? fetch;
  const vacio: ResumenBackfill = { ...VACIO, fase: p.fase, saltar: p.saltar, total: null, siguiente: null };

  const acc = await accesoDeConexion({ db, env: p.env, ahora, fetchFn });
  if (!acc.ok) return { ...vacio, motivo: acc.motivo };

  const primera = p.saltar === 0;
  let pagina;
  try {
    pagina = await listarPaginaDeBandeja(acc.accessToken, { desdeIso: p.desdeIso, saltar: p.saltar, tope: MAX_MENSAJES_POR_CORRIDA, contar: primera }, fetchFn);
  } catch (e) {
    return { ...vacio, motivo: `no se pudo leer el buzón (${mensajeSeguro(e)})` };
  }

  const yaVistos = await yaProcesados(db, pagina.mensajes.map((m) => m.id));
  const res: ResumenBackfill = { ...VACIO, ok: true, fase: p.fase, saltar: p.saltar, total: pagina.total, siguiente: null };
  const dominioBuzon = acc.mailbox?.split("@")[1]?.toLowerCase() ?? null;
  for (const m of seleccionaNuevos(pagina.mensajes, yaVistosSet(yaVistos))) {
    if (!esCorreoDeIndeed(m.from)) continue;
    if (!enFase(clasificaCorreoIndeed(aCorreo(m)), p.fase)) continue;
    res.revisados++;
    const fila = await procesaSeguro(db, m, { dominioBuzon, accessToken: acc.accessToken, fetchFn, ahora, fase: p.fase });
    contaFila(res, fila);
  }

  // El cursor solo avanza: si el rango es antiguo, no toca nada; si llega hasta hoy, deja el cursor en lo último visto.
  const avance = avanzaCursor(acc.cursor, pagina.mensajes.map((m) => m.receivedDateTime));
  if (avance && avance !== acc.cursor) {
    await db.schema("recruiting").from("outlook_connection").update({ last_message_received_at: avance }).eq("id", 1);
  }

  const llena = pagina.mensajes.length >= MAX_MENSAJES_POR_CORRIDA;
  if (llena) res.siguiente = { fase: p.fase, saltar: p.saltar + pagina.mensajes.length };
  else if (p.fase === "solicitud") res.siguiente = { fase: "mensaje", saltar: 0 };
  return res;
}

function aCorreo(m: MensajeGraph): CorreoDeIndeed {
  return { subject: m.subject, from: m.from, replyTo: m.replyTo, cuerpo: m.bodyText, recibido: m.receivedDateTime };
}

async function yaProcesados(db: SupabaseClient, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data, error } = await db.schema("recruiting").from("outlook_processed").select("message_id").in("message_id", ids);
  if (error) throw new Error(`no se pudo leer lo ya procesado: ${error.message}`);
  return (data ?? []).map((v) => (v as { message_id: string }).message_id);
}

const yaProcesadosSet = (ids: string[]) => new Set(ids);
const yaVistosSet = (ids: string[]) => new Set(ids);

function contaFila(res: ResumenRevision, fila: ResultadoFila | "ya-reclamado"): void {
  if (fila === "ya-reclamado") res.revisados--;
  else if (fila === "created") res.creados++;
  else if (fila === "duplicate") res.duplicados++;
  else if (fila === "noted") res.notas++;
  else if (fila === "skipped") res.omitidos++;
  else res.fallidos++;
}

/** Procesa un correo sin dejar que un error tumbe la corrida: se cuenta como fallido y sigue con el siguiente. */
async function procesaSeguro(
  db: SupabaseClient,
  m: MensajeGraph,
  o: { dominioBuzon: string | null; accessToken: string; fetchFn: typeof fetch; ahora: Date; fase: FaseBackfill | null },
): Promise<ResultadoFila | "ya-reclamado"> {
  try {
    return await procesaCorreo(db, m, o);
  } catch (e) {
    console.error(`[outlook] correo no procesado: ${mensajeSeguro(e)}`);
    return "failed";
  }
}

/** Procesa un correo: lo reclama, verifica, clasifica, actúa y anota el resultado. */
async function procesaCorreo(
  db: SupabaseClient,
  m: MensajeGraph,
  o: { dominioBuzon: string | null; accessToken: string; fetchFn: typeof fetch; ahora: Date },
): Promise<ResultadoFila | "ya-reclamado"> {
  const rec = db.schema("recruiting");
  const correo: CorreoDeIndeed = { ...aCorreo(m), dominioBuzon: o.dominioBuzon };
  const { error: eClaim } = await rec.from("outlook_processed").insert({
    message_id: m.id,
    received_at: m.receivedDateTime,
    subject: m.subject.slice(0, 300),
    from_address: direccionDe(m.from).slice(0, 200),
    result: "failed",
    error: "en proceso",
  });
  if (eClaim) {
    if (eClaim.code === "23505") return "ya-reclamado";
    throw new Error(`no se pudo reclamar el correo: ${eClaim.message}`);
  }

  let resultado: ResultadoFila = "failed";
  let candidateId: string | null = null;
  let error: string | null = null;
  let scheduledAt: string | null = null;
  let detail: string | null = null;
  try {
    const verif = verificadoComoIndeed(m.cabeceras, m.fromAddress);
    if (!verif.ok) {
      resultado = "skipped";
      error = `not verified as Indeed (${verif.motivo})`;
    } else {
      const tipo = clasificaCorreoIndeed(correo);
      if (tipo === "message") {
        const r = leerMensajeDeIndeed(correo);
        if (!r.ok) {
          resultado = "skipped";
          error = r.motivo;
        } else {
          const relay = m.replyTo.map((x) => x.toLowerCase()).find((x) => esDireccionIndeed(x)) ?? null;
          const out = await procesarMensaje(db, { mensaje: r.mensaje, recibido: m.receivedDateTime, ahora: o.ahora.toISOString(), replyToRelay: relay });
          resultado = out.resultado === "skipped" ? "skipped" : out.resultado;
          candidateId = out.candidateId;
          error = out.error;
          scheduledAt = out.scheduledAt;
          detail = out.detail;
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
            const adjuntos = await listarAdjuntos(o.accessToken, m.id, o.fetchFn);
            const pick = adjuntos.find((a) => /\.(pdf|docx?)$/i.test(a.name));
            if (pick) {
              const bytes = await descargarAdjunto(o.accessToken, m.id, pick, o.fetchFn);
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
    }
  } catch (e) {
    resultado = "failed";
    error = mensajeSeguro(e);
  }

  await rec
    .from("outlook_processed")
    .update({ result: resultado, candidate_id: candidateId, error, scheduled_at: scheduledAt, detail })
    .eq("message_id", m.id);
  return resultado;
}

/** Lo que enseña la tarjeta: la conexión sin secretos, el conteo de la semana y los últimos 20 correos con su candidato. */
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
    rec
      .from("outlook_processed")
      .select("message_id, received_at, subject, from_address, result, error, candidate_id, scheduled_at, detail, processed_at")
      .order("processed_at", { ascending: false })
      .limit(20),
  ]);
  const filas = (ultimos ?? []) as Array<Record<string, unknown>>;
  const ids = [...new Set(filas.map((f) => f.candidate_id as string | null).filter((x): x is string => !!x))];
  const nombres = new Map<string, string>();
  if (ids.length) {
    const { data: cs } = await rec.from("candidates").select("id, name").in("id", ids);
    for (const c of (cs ?? []) as Array<{ id: string; name: string }>) nombres.set(c.id, c.name);
  }
  return {
    configurada: faltan.length === 0,
    faltan,
    conectada: Boolean(conn?.mailbox),
    buzon: (conn?.mailbox as string | null) ?? null,
    conectadaEl: (conn?.connected_at as string | null) ?? null,
    ultimaRevision: (conn?.last_check_at as string | null) ?? null,
    ultimoError: (conn?.last_error as string | null) ?? null,
    creadosUltimos7Dias: creados7 ?? 0,
    ultimos: filas.map((f) => ({ ...f, candidato: f.candidate_id ? (nombres.get(f.candidate_id as string) ?? null) : null })),
  };
}
