import type { SupabaseClient } from "@supabase/supabase-js";
import { RC_SERVER, ringcentralToken } from "@/lib/ringcentral";
import type { CredencialesRingCentral } from "@/lib/recruiting/agendas-ringcentral";
import { urlDeGrabacionSegura } from "@/lib/ringcentral-choferes/choferes";
import {
  clavesDeLeads,
  filaDeLlamadaDeLead,
  tocaBarrer,
  type FilaDeLlamadaDeLead,
  type RegistroDeLlamadaDeLead,
} from "./llamadas-rc";

// ============================================================
// Sincronizador de las llamadas de RingCentral con los leads (I/O). Lo llama el cron rc-comms (el mismo cron de cada
// 10 minutos, con las mismas credenciales de la agenda del dueño): este decide si toca barrer (cada 2 horas) y, si toca,
// lee el call log de la CUENTA, guarda solo las llamadas de teléfonos de leads, y baja hasta 6 grabaciones pendientes.
//
// Por barrido (D-1130): el call log es del grupo «heavy» de RingCentral, 10 peticiones por minuto. Antes se pedían hasta
// 30 páginas de 100 de un tirón y, al primer 429, se tiraba TODO lo leído: con un mes de llamadas de la empresa (miles) el
// primer barrido no terminaba nunca. Ahora: páginas de 1000, como mucho `MAX_PAGINAS` peticiones por barrido, y el mes se
// recorre por VENTANAS de una semana, de la más vieja a la más nueva; cada ventana que termina se guarda y mueve el cursor,
// así que un 429 (o quedarse sin presupuesto) solo corta ahí y la siguiente corrida sigue donde se quedó. Mientras falte
// ponerse al día, se barre en cada corrida del cron (10 min) y no cada 2 horas.
// Un 403 de RingCentral («sin_permiso») es de la cuenta: falta ReadCompanyCallLog.
// Nunca se escribe el token, ni la respuesta de RingCentral, ni un número en los logs: solo códigos.
// ============================================================

const BUCKET = "rc-lead-recordings";
/** Peticiones de listado por barrido: por debajo de las 10 por minuto del grupo «heavy», con sitio para las grabaciones. */
export const MAX_PAGINAS = 6;
export const TAMANO_PAGINA = 1000;
/** El tramo que se pide de una vez. Una semana de la empresa son ~1,500 llamadas: 2 páginas. */
export const VENTANA_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_GRABACIONES = 6;
const MAX_INTENTOS_GRABACION = 5;
const DIAS_PRIMERA_VEZ = 30;
const MARGEN_MS = 2 * 60 * 60 * 1000;
const TAMANO_LOTE = 200;
const PAGINA_LEADS = 1000;

export interface ResultadoLlamadasDeLeads {
  ok: boolean;
  motivo?: "sin_permiso" | "limite" | "listado" | "base";
  llamadas: number;
  grabaciones: number;
  pendientes: number;
}

/** RingCentral contestó 429: se para el barrido sin error. */
class LimiteDeRc extends Error {}
/** RingCentral contestó 403 al listar: la cuenta no da el permiso. */
class SinPermisoRc extends Error {}

type Db = SupabaseClient;

interface FilaPendiente {
  id: string;
  rc_call_id: string;
  recording_uri: string;
  recording_intentos: number;
}

async function rcGet(server: string, token: string, ruta: string): Promise<{ records?: unknown[]; navigation?: { nextPage?: unknown } }> {
  const res = await fetch(`${server}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) throw new LimiteDeRc("429");
  if (res.status === 403) throw new SinPermisoRc("403");
  if (!res.ok) throw new Error(`RingCentral ${res.status}`);
  return res.json();
}

/**
 * Las páginas del call log de la cuenta entre `desde` y `hasta`, gastando como mucho `presupuesto` peticiones.
 * `completo` es false si se acabó el presupuesto antes de la última página; `paginas`, las peticiones hechas.
 */
async function listarLlamadas(
  server: string, token: string, desde: Date, hasta: Date, presupuesto: number,
): Promise<{ registros: RegistroDeLlamadaDeLead[]; completo: boolean; paginas: number }> {
  const registros: RegistroDeLlamadaDeLead[] = [];
  let paginas = 0;
  for (let pagina = 1; paginas < presupuesto; pagina++) {
    const q = `view=Detailed&dateFrom=${encodeURIComponent(desde.toISOString())}&dateTo=${encodeURIComponent(hasta.toISOString())}&perPage=${TAMANO_PAGINA}&page=${pagina}`;
    const data = await rcGet(server, token, `/restapi/v1.0/account/~/call-log?${q}`);
    paginas++;
    const recs = (data.records ?? []) as RegistroDeLlamadaDeLead[];
    registros.push(...recs);
    if (!data.navigation?.nextPage || recs.length < TAMANO_PAGINA) return { registros, completo: true, paginas };
  }
  return { registros, completo: false, paginas };
}

/** Todos los teléfonos de los leads, de a mil (PostgREST corta en 1000 por consulta), como claves de 10 dígitos. */
async function cargarClaves(db: Db): Promise<Set<string>> {
  const todos: Awaited<ReturnType<typeof filasDeLeads>> = [];
  for (let desde = 0; ; desde += PAGINA_LEADS) {
    const lote = await filasDeLeads(db, desde);
    todos.push(...lote);
    if (lote.length < PAGINA_LEADS) break;
  }
  return clavesDeLeads(todos);
}

async function filasDeLeads(db: Db, desde: number) {
  const { data, error } = await db.from("leads")
    .select("owner_phone, owner_phone_manual, tenant_phone, tenant_phone_manual")
    .order("id").range(desde, desde + PAGINA_LEADS - 1);
  if (error) throw error;
  return (data ?? []) as { owner_phone: string | null; owner_phone_manual: string | null; tenant_phone: string | null; tenant_phone_manual: string | null }[];
}

/** Guarda las llamadas. Las grabaciones ya bajadas no se pisan: cada fila lleva su `recording_path` explícito. */
async function guardarLlamadas(db: Db, filas: FilaDeLlamadaDeLead[]): Promise<number> {
  if (!filas.length) return 0;
  const yaBajadas = new Map<string, string>();
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const ids = filas.slice(i, i + TAMANO_LOTE).map((f) => f.rc_call_id);
    const { data, error } = await db.from("rc_lead_calls")
      .select("rc_call_id, recording_path").in("rc_call_id", ids).not("recording_path", "is", null);
    if (error) throw error;
    for (const r of data ?? []) yaBajadas.set(r.rc_call_id as string, r.recording_path as string);
  }
  const payload = filas.map((f) => {
    const ruta = yaBajadas.get(f.rc_call_id) ?? null;
    return {
      ...f,
      recording_path: ruta,
      recording_uri: ruta ? null : f.recording_uri,
      recording_pending: ruta ? false : f.recording_pending,
    };
  });
  for (let i = 0; i < payload.length; i += TAMANO_LOTE) {
    const { error } = await db.from("rc_lead_calls").upsert(payload.slice(i, i + TAMANO_LOTE), { onConflict: "rc_call_id" });
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

/** Baja una grabación al bucket privado. «ok», «fallo» (cuenta como intento) o «limite» (para el barrido). */
async function bajarUna(db: Db, token: string, server: string, p: FilaPendiente): Promise<"ok" | "fallo" | "limite"> {
  try {
    let url = urlDeGrabacionSegura(p.recording_uri, server);
    if (!url) return "fallo";
    let res: Response | null = null;
    // El token viaja solo a ringcentral.com: cada salto de redirección se vuelve a comprobar.
    for (let salto = 0; salto < 4; salto++) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" });
      if (res.status < 300 || res.status >= 400) break;
      const destino = res.headers.get("location");
      url = destino ? urlDeGrabacionSegura(destino, url.toString()) : null;
      if (!url) return "fallo";
    }
    if (!res) return "fallo";
    if (res.status === 429) return "limite";
    if (!res.ok) return "fallo";
    const tipo = res.headers.get("content-type") ?? "application/octet-stream";
    const bytes = Buffer.from(await res.arrayBuffer());
    const ruta = `${p.rc_call_id}.${extensionDe(tipo)}`;
    const up = await db.storage.from(BUCKET).upload(ruta, bytes, { contentType: tipo.split(";")[0].trim(), upsert: true });
    if (up.error) return "fallo";
    const { error } = await db.from("rc_lead_calls")
      .update({ recording_path: ruta, recording_pending: false, recording_uri: null }).eq("id", p.id);
    return error ? "fallo" : "ok";
  } catch {
    return "fallo";
  }
}

/** Baja hasta 6 grabaciones pendientes, las más recientes primero, saltando las que ya fallaron demasiadas veces. */
async function bajarGrabaciones(db: Db, token: string, server: string): Promise<number> {
  const { data, error } = await db.from("rc_lead_calls")
    .select("id, rc_call_id, recording_uri, recording_intentos")
    .eq("recording_pending", true)
    .not("recording_uri", "is", null)
    .lt("recording_intentos", MAX_INTENTOS_GRABACION)
    .order("started_at", { ascending: false })
    .limit(MAX_GRABACIONES);
  if (error) throw error;
  let bajadas = 0;
  for (const p of (data ?? []) as FilaPendiente[]) {
    const r = await bajarUna(db, token, server, p);
    if (r === "limite") break;
    if (r === "ok") {
      bajadas++;
    } else {
      await db.from("rc_lead_calls").update({ recording_intentos: p.recording_intentos + 1 }).eq("id", p.id);
    }
  }
  return bajadas;
}

/**
 * Un barrido completo. Devuelve null si todavía no toca (menos de 2 horas desde el último intento). Nunca lanza:
 * devuelve `ok: false` con un motivo genérico.
 */
export async function sincronizarLlamadasDeLeads(opciones: {
  db: Db;
  credenciales: CredencialesRingCentral;
  ahora: Date;
  server?: string;
}): Promise<ResultadoLlamadasDeLeads | null> {
  const { db, credenciales, ahora } = opciones;
  const server = opciones.server ?? RC_SERVER;
  const resultado: ResultadoLlamadasDeLeads = { ok: true, llamadas: 0, grabaciones: 0, pendientes: 0 };
  const fallo = (motivo: NonNullable<ResultadoLlamadasDeLeads["motivo"]>): ResultadoLlamadasDeLeads => ({ ...resultado, ok: false, motivo });

  const { data: estado, error: eEstado } = await db.from("rc_lead_sync_state")
    .select("cursor_at, last_run_at, last_error_code").eq("id", 1).maybeSingle();
  if (eEstado) return fallo("base");
  // Si el último barrido se cortó (límite o presupuesto), falta ponerse al día: se sigue en esta corrida, sin esperar 2 h.
  const faltaPonerseAlDia = estado?.last_error_code === "limite" || estado?.last_error_code === "listado";
  if (!faltaPonerseAlDia && !tocaBarrer(estado?.last_run_at ?? null, ahora)) {
    // D-1131: aunque no toque barrer, las grabaciones en cola se siguen bajando en cada corrida (6 cada 10 minutos, no
    // 6 cada 2 horas). Sin cola no se pide ni el token: la corrida sale como antes, con null.
    const { count, error: eCola } = await db.from("rc_lead_calls").select("id", { count: "exact", head: true })
      .eq("recording_pending", true).not("recording_uri", "is", null).lt("recording_intentos", MAX_INTENTOS_GRABACION);
    if (eCola || !count) return null;
    try {
      const tokenDeCola = await ringcentralToken(credenciales);
      resultado.grabaciones = await bajarGrabaciones(db, tokenDeCola, server);
      resultado.pendientes = Math.max(0, count - resultado.grabaciones);
    } catch {
      return fallo("base");
    }
    return resultado;
  }

  let token: string;
  try {
    token = await ringcentralToken(credenciales);
  } catch {
    return fallo("base");
  }

  let motivo: ResultadoLlamadasDeLeads["motivo"];
  // Hasta dónde quedó TODO leído y guardado. Avanza ventana a ventana; lo que se corte, lo retoma la siguiente corrida.
  let cursorNuevo: string | null = (estado?.cursor_at as string | null | undefined) ?? null;
  try {
    const cursor = estado?.cursor_at ? Date.parse(estado.cursor_at as string) : NaN;
    let desde = Number.isFinite(cursor) ? new Date(cursor - MARGEN_MS) : new Date(ahora.getTime() - DIAS_PRIMERA_VEZ * 24 * 60 * 60 * 1000);
    const claves = await cargarClaves(db);
    let presupuesto = MAX_PAGINAS;
    while (desde.getTime() < ahora.getTime()) {
      if (presupuesto <= 0) { motivo = "listado"; break; }
      const hasta = new Date(Math.min(desde.getTime() + VENTANA_MS, ahora.getTime()));
      const { registros, completo, paginas } = await listarLlamadas(server, token, desde, hasta, presupuesto);
      presupuesto -= paginas;
      const filas = registros
        .map((r) => filaDeLlamadaDeLead(r, claves))
        .filter((f): f is FilaDeLlamadaDeLead => !!f);
      resultado.llamadas += await guardarLlamadas(db, filas);
      if (!completo) { motivo = "listado"; break; }
      cursorNuevo = hasta.toISOString();
      desde = hasta;
    }
  } catch (err) {
    if (err instanceof SinPermisoRc) motivo = "sin_permiso";
    else if (err instanceof LimiteDeRc) motivo = "limite";
    else {
      console.error("[leads-llamadas] listado:", err instanceof Error ? err.message : "error");
      motivo = "listado";
    }
  }

  const { error: eEstadoGuardado } = await db.from("rc_lead_sync_state").upsert({
    id: 1,
    cursor_at: cursorNuevo,
    last_run_at: ahora.toISOString(),
    last_error_code: motivo ?? null,
    updated_at: new Date().toISOString(),
  });
  if (eEstadoGuardado) return fallo("base");

  try {
    resultado.grabaciones = await bajarGrabaciones(db, token, server);
    const { count } = await db.from("rc_lead_calls").select("id", { count: "exact", head: true }).eq("recording_pending", true);
    resultado.pendientes = count ?? 0;
  } catch (err) {
    console.error("[leads-llamadas] grabaciones:", err instanceof Error ? err.message : "error");
    return fallo("base");
  }

  if (motivo) return { ...resultado, ok: false, motivo };
  return resultado;
}
