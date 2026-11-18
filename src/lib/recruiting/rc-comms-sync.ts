import type { SupabaseClient } from "@supabase/supabase-js";
import { RC_SERVER, ringcentralToken } from "@/lib/ringcentral";
import type { CredencialesRingCentral } from "./agendas-ringcentral";
import {
  filaDeLlamada,
  filaDeTexto,
  indiceDeCandidatos,
  type CandidatoParaIndice,
  type FilaDeComunicacion,
  type IndiceDeCandidatos,
  type RegistroDeLlamada,
  type RegistroDeTexto,
} from "./rc-comms";

// ============================================================
// Sincronizador de las comunicaciones de RingCentral (I/O). Lo llama el cron rc-comms con la llave de servicio y las
// credenciales de la agenda del dueno. Idempotente: el solape de dos horas y el upsert por (kind, rc_id) hacen que
// repetir una lectura no duplique nada.
//
// Por corrida: lista llamadas y SMS desde el cursor (menos 2 h), como mucho 10 paginas por tipo; guarda solo lo de
// candidatos; baja como mucho 6 grabaciones pendientes. Un 429 de RingCentral corta la corrida sin error; el cursor
// avanza solo si el listado de ese tipo termino sin errores ni cortes.
// ============================================================

const BUCKET = "rc-recordings";
const MAX_PAGINAS = 10;
const TAMANO_PAGINA = 100;
const MAX_GRABACIONES = 6;
const DIAS_PRIMERA_VEZ = 30;
const MARGEN_MS = 2 * 60 * 60 * 1000;
const TAMANO_LOTE = 200;

export interface ResultadoRcComms {
  ok: boolean;
  /** Solo si `ok` es false: qué parte falló. Texto corto y genérico, nunca el detalle de RingCentral. */
  motivo?: "autenticacion" | "limite" | "listado" | "base";
  llamadas: number;
  textos: number;
  grabaciones: number;
  pendientes: number;
}

/** RingCentral contestó 429: se para la corrida sin error. */
class LimiteDeRc extends Error {}

type Db = SupabaseClient;

async function rcGet(server: string, token: string, ruta: string): Promise<{ records?: unknown[]; navigation?: { nextPage?: unknown } }> {
  const res = await fetch(`${server}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) throw new LimiteDeRc("429");
  if (!res.ok) throw new Error(`RingCentral ${res.status}`);
  return res.json();
}

/** Recorre las paginas de un listado desde `desde`. `completo` es false si se llego al tope de paginas. */
async function listar<T>(server: string, token: string, ruta: string, extra: string, desde: Date): Promise<{ registros: T[]; completo: boolean }> {
  const registros: T[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const q = `dateFrom=${encodeURIComponent(desde.toISOString())}&perPage=${TAMANO_PAGINA}&page=${pagina}${extra}`;
    const data = await rcGet(server, token, `${ruta}?${q}`);
    const recs = (data.records ?? []) as T[];
    registros.push(...recs);
    if (!data.navigation?.nextPage || recs.length < TAMANO_PAGINA) return { registros, completo: true };
  }
  return { registros, completo: false };
}

/** Todos los candidatos con telefono, de a mil (PostgREST corta en 1000 por consulta). */
async function cargarIndice(db: Db): Promise<IndiceDeCandidatos> {
  const todos: CandidatoParaIndice[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.schema("recruiting").from("candidates")
      .select("id, phone, created_at").order("id").range(desde, desde + 999);
    if (error) throw error;
    const lote = (data ?? []) as CandidatoParaIndice[];
    todos.push(...lote);
    if (lote.length < 1000) break;
  }
  return indiceDeCandidatos(todos);
}

/** Guarda las filas de un tipo. Las grabaciones ya bajadas no se pisan: cada fila lleva `recording_path` explicito. */
async function guardar(db: Db, kind: "call" | "sms", filas: FilaDeComunicacion[]): Promise<number> {
  if (!filas.length) return 0;
  const yaBajadas = new Map<string, string>();
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const ids = filas.slice(i, i + TAMANO_LOTE).map((f) => f.rc_id);
    const { data, error } = await db.schema("recruiting").from("rc_comms")
      .select("rc_id, recording_path").eq("kind", kind).in("rc_id", ids).not("recording_path", "is", null);
    if (error) throw error;
    for (const r of data ?? []) yaBajadas.set(r.rc_id as string, r.recording_path as string);
  }
  const payload = filas.map((f) => {
    const ruta = yaBajadas.get(f.rc_id) ?? null;
    return {
      ...f,
      recording_path: ruta,
      recording_uri: ruta ? null : f.recording_uri,
      recording_pending: ruta ? false : f.recording_pending,
    };
  });
  for (let i = 0; i < payload.length; i += TAMANO_LOTE) {
    const { error } = await db.schema("recruiting").from("rc_comms")
      .upsert(payload.slice(i, i + TAMANO_LOTE), { onConflict: "kind,rc_id" });
    if (error) throw error;
  }
  return filas.length;
}

function extensionDe(tipo: string): string {
  const t = tipo.split(";")[0].trim().toLowerCase();
  if (t === "audio/wav" || t === "audio/x-wav" || t === "audio/wave") return "wav";
  if (t === "audio/mp4" || t === "audio/x-m4a" || t === "audio/m4a") return "m4a";
  if (t === "audio/mpeg" || t === "audio/mp3") return "mp3";
  return "bin";
}

/** Baja hasta 6 grabaciones pendientes, las mas recientes primero (asi una grabacion que nunca baja no tapa a las
 *  nuevas). Un fallo deja la fila pendiente para la siguiente corrida; un 429 corta el bucle. */
async function bajarGrabaciones(db: Db, token: string, server: string): Promise<number> {
  const { data, error } = await db.schema("recruiting").from("rc_comms")
    .select("id, rc_id, candidate_id, recording_uri").eq("recording_pending", true)
    .not("recording_uri", "is", null).order("at", { ascending: false }).limit(MAX_GRABACIONES);
  if (error) throw error;
  const origen = new URL(server).origin;
  let bajadas = 0;
  for (const p of data ?? []) {
    try {
      const url = new URL(p.recording_uri as string, server);
      // El token de RingCentral solo viaja a su propio servidor.
      if (url.origin !== origen) continue;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 429) break;
      if (!res.ok) continue;
      const tipo = res.headers.get("content-type") ?? "application/octet-stream";
      const bytes = Buffer.from(await res.arrayBuffer());
      const ruta = `${p.candidate_id}/${p.rc_id}.${extensionDe(tipo)}`;
      const up = await db.storage.from(BUCKET).upload(ruta, bytes, { contentType: tipo.split(";")[0].trim(), upsert: true });
      if (up.error) continue;
      const { error: eUp } = await db.schema("recruiting").from("rc_comms")
        .update({ recording_path: ruta, recording_pending: false, recording_uri: null }).eq("id", p.id);
      if (eUp) continue;
      bajadas++;
    } catch {
      // Se queda pendiente para la siguiente corrida.
    }
  }
  return bajadas;
}

/** Una corrida completa. Nunca lanza: devuelve `ok: false` con un motivo generico. */
export async function sincronizarRcComms(opciones: {
  db: Db;
  credenciales: CredencialesRingCentral;
  ahora: Date;
  server?: string;
}): Promise<ResultadoRcComms> {
  const { db, credenciales, ahora } = opciones;
  const server = opciones.server ?? RC_SERVER;
  const resultado: ResultadoRcComms = { ok: true, llamadas: 0, textos: 0, grabaciones: 0, pendientes: 0 };
  const fallo = (motivo: NonNullable<ResultadoRcComms["motivo"]>): ResultadoRcComms => ({ ...resultado, ok: false, motivo });

  let token: string;
  try {
    token = await ringcentralToken(credenciales);
  } catch {
    return fallo("autenticacion");
  }

  try {
    const { data: estado, error: eEstado } = await db.schema("recruiting").from("rc_sync_state")
      .select("calls_from, sms_from").eq("id", 1).maybeSingle();
    if (eEstado) throw eEstado;
    const indice = await cargarIndice(db);

    const desdeDe = (cursor: string | null) =>
      cursor ? new Date(Date.parse(cursor) - MARGEN_MS) : new Date(ahora.getTime() - DIAS_PRIMERA_VEZ * 24 * 60 * 60 * 1000);

    let errorListado: "limite" | "listado" | null = null;
    let llamadasCompletas = false;
    let textosCompletos = false;

    try {
      const { registros, completo } = await listar<RegistroDeLlamada>(
        server, token, "/restapi/v1.0/account/~/extension/~/call-log",
        "&view=Detailed&withRecording=true", desdeDe(estado?.calls_from ?? null));
      llamadasCompletas = completo;
      const filas = registros.map((r) => filaDeLlamada(r, indice)).filter((f): f is FilaDeComunicacion => !!f);
      resultado.llamadas = await guardar(db, "call", filas);
    } catch (e) {
      errorListado = e instanceof LimiteDeRc ? "limite" : "listado";
      if (errorListado === "listado") console.error("[rc-comms] llamadas:", e instanceof Error ? e.message : e);
    }

    try {
      const { registros, completo } = await listar<RegistroDeTexto>(
        server, token, "/restapi/v1.0/account/~/extension/~/message-store",
        "&messageType=SMS", desdeDe(estado?.sms_from ?? null));
      textosCompletos = completo;
      const filas = registros.map((r) => filaDeTexto(r, indice)).filter((f): f is FilaDeComunicacion => !!f);
      resultado.textos = await guardar(db, "sms", filas);
    } catch (e) {
      errorListado = errorListado ?? (e instanceof LimiteDeRc ? "limite" : "listado");
      if (!(e instanceof LimiteDeRc)) console.error("[rc-comms] textos:", e instanceof Error ? e.message : e);
    }

    // El cursor solo avanza por el tipo que termino completo: si algo falló, la siguiente corrida vuelve a mirar.
    const { error: eCursor } = await db.schema("recruiting").from("rc_sync_state").upsert({
      id: 1,
      calls_from: llamadasCompletas ? ahora.toISOString() : (estado?.calls_from ?? null),
      sms_from: textosCompletos ? ahora.toISOString() : (estado?.sms_from ?? null),
      updated_at: new Date().toISOString(),
    });
    if (eCursor) throw eCursor;

    resultado.grabaciones = await bajarGrabaciones(db, token, server);

    const { count } = await db.schema("recruiting").from("rc_comms")
      .select("id", { count: "exact", head: true }).eq("recording_pending", true);
    resultado.pendientes = count ?? 0;

    if (errorListado) return { ...resultado, ok: false, motivo: errorListado };
    return resultado;
  } catch (e) {
    console.error("[rc-comms] base:", e instanceof Error ? e.message : e);
    return fallo("base");
  }
}
