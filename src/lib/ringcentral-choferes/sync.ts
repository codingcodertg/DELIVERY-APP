import type { SupabaseClient } from "@supabase/supabase-js";
import { RC_SERVER, ringcentralToken } from "@/lib/ringcentral";
import type { CredencialesRingCentral } from "@/lib/recruiting/agendas-ringcentral";
import {
  ERROR_DE_LISTADO,
  LIMITE_DE_RC,
  MAX_GRABACIONES,
  MAX_INTENTOS_GRABACION,
  MAX_PAGINAS,
  SIN_PERMISO,
  TAMANO_PAGINA,
  filaDeLlamadaDeChofer,
  rutaDeGrabacion,
  urlDeGrabacionSegura,
  ventanaDeLectura,
  type FilaDeLlamadaDeChofer,
  type RegistroDeLlamadaDeChofer,
} from "./choferes";

// ============================================================
// Sincronizador del RingCentral de los choferes (I/O). Lo llaman el cron rc-choferes y el botón «Sincronizar ahora»,
// con la llave de servicio y las credenciales de la agenda del dueño (las que ya leen las comunicaciones de candidatos).
//
// Por corrida, para cada extensión de chofer activa, en orden: lee su call log desde su cursor (menos 2 horas), como
// mucho 30 páginas de 100; guarda todas sus llamadas (upsert por extensión + id de llamada); y al final baja como mucho
// 6 grabaciones pendientes. El cursor de una extensión solo avanza si su listado terminó sin errores.
//
// Errores que se guardan por extensión en `rc_driver_sync_state.last_error_code`:
//   - 403 de RingCentral: «sin_permiso» (falta ReadCompanyCallLog). Es de la cuenta, no de una extensión: la corrida
//     para y se marca a todas las activas.
//   - 429: «limite». La corrida para sin error; lo demás se intenta en la siguiente.
//   - otro fallo de listado: «listado». Sigue con la siguiente extensión.
// Nunca se escribe el token, ni la respuesta de RingCentral, ni un número en los logs: solo códigos.
// ============================================================

const BUCKET = "rc-driver-recordings";
const TAMANO_LOTE = 200;

export interface ResultadoRcChoferes {
  ok: boolean;
  /** Solo si `ok` es false. Texto corto y genérico: nunca el detalle de RingCentral. */
  motivo?: "autenticacion" | "sin_permiso" | "limite" | "listado" | "base";
  extensiones: number;
  llamadas: number;
  grabaciones: number;
  pendientes: number;
}

/** RingCentral contestó 429: se para la corrida sin error. */
class LimiteDeRc extends Error {}
/** RingCentral contestó 403 al listar: la cuenta no da el permiso. */
class SinPermisoRc extends Error {}

type Db = SupabaseClient;

interface ExtensionActiva {
  rc_extension_id: string;
}

interface FilaPendiente {
  id: string;
  rc_call_id: string;
  rc_extension_id: string;
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

/** Recorre las páginas del call log de una extensión desde `desde`. `completo` es false si se llegó al tope. */
async function listarLlamadas(
  server: string,
  token: string,
  extensionId: string,
  desde: Date,
): Promise<{ registros: RegistroDeLlamadaDeChofer[]; completo: boolean }> {
  const registros: RegistroDeLlamadaDeChofer[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const q = `view=Detailed&dateFrom=${encodeURIComponent(desde.toISOString())}&perPage=${TAMANO_PAGINA}&page=${pagina}`;
    const data = await rcGet(server, token, `/restapi/v1.0/account/~/extension/${encodeURIComponent(extensionId)}/call-log?${q}`);
    const recs = (data.records ?? []) as RegistroDeLlamadaDeChofer[];
    registros.push(...recs);
    if (!data.navigation?.nextPage || recs.length < TAMANO_PAGINA) return { registros, completo: true };
  }
  return { registros, completo: false };
}

/** Guarda las llamadas de una extensión. Las grabaciones ya bajadas no se pisan: se conserva su ruta. */
async function guardarLlamadas(db: Db, extensionId: string, filas: FilaDeLlamadaDeChofer[]): Promise<number> {
  if (!filas.length) return 0;
  const yaBajadas = new Map<string, string>();
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const ids = filas.slice(i, i + TAMANO_LOTE).map((f) => f.rc_call_id);
    const { data, error } = await db.from("rc_driver_calls")
      .select("rc_call_id, recording_path").eq("rc_extension_id", extensionId).in("rc_call_id", ids).not("recording_path", "is", null);
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
    const { error } = await db.from("rc_driver_calls").upsert(payload.slice(i, i + TAMANO_LOTE), { onConflict: "rc_extension_id,rc_call_id" });
    if (error) throw error;
  }
  return filas.length;
}

/** Anota cuándo corrió una extensión y su último error. El cursor solo se mueve si se pasa `cursorAt`. */
async function anotarEstado(db: Db, extensionId: string, ahora: Date, errorCodigo: string | null, cursorAt?: Date): Promise<void> {
  const { error } = await db.from("rc_driver_sync_state").upsert({
    rc_extension_id: extensionId,
    ...(cursorAt ? { cursor_at: cursorAt.toISOString() } : {}),
    last_run_at: ahora.toISOString(),
    last_error_code: errorCodigo,
    updated_at: new Date().toISOString(),
  }, { onConflict: "rc_extension_id" });
  if (error) throw error;
}

/** Baja una grabación al bucket privado. Devuelve «ok», «fallo» (cuenta como intento) o «limite» (para la corrida). */
async function bajarUna(db: Db, token: string, server: string, p: FilaPendiente): Promise<"ok" | "fallo" | "limite"> {
  try {
    let url = urlDeGrabacionSegura(p.recording_uri, server);
    if (!url) return "fallo";
    let res: Response | null = null;
    // El token viaja solo a ringcentral.com: cada salto de redirección se vuelve a comprobar, y no se sigue a otro sitio.
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
    const ruta = rutaDeGrabacion(p.rc_extension_id, p.rc_call_id, tipo);
    const up = await db.storage.from(BUCKET).upload(ruta, bytes, { contentType: tipo.split(";")[0].trim(), upsert: true });
    if (up.error) return "fallo";
    const { error } = await db.from("rc_driver_calls")
      .update({ recording_path: ruta, recording_pending: false, recording_uri: null }).eq("id", p.id);
    return error ? "fallo" : "ok";
  } catch {
    return "fallo";
  }
}

/** Baja hasta 6 grabaciones pendientes, las más recientes primero, saltando las que ya fallaron demasiadas veces. */
async function bajarGrabaciones(db: Db, token: string, server: string): Promise<number> {
  const { data, error } = await db.from("rc_driver_calls")
    .select("id, rc_call_id, rc_extension_id, recording_uri, recording_intentos")
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
      await db.from("rc_driver_calls").update({ recording_intentos: p.recording_intentos + 1 }).eq("id", p.id);
    }
  }
  return bajadas;
}

/** Una corrida completa. Nunca lanza: devuelve `ok: false` con un motivo genérico. */
export async function sincronizarRcChoferes(opciones: {
  db: Db;
  credenciales: CredencialesRingCentral;
  ahora: Date;
  server?: string;
}): Promise<ResultadoRcChoferes> {
  const { db, credenciales, ahora } = opciones;
  const server = opciones.server ?? RC_SERVER;
  const resultado: ResultadoRcChoferes = { ok: true, extensiones: 0, llamadas: 0, grabaciones: 0, pendientes: 0 };
  const fallo = (motivo: NonNullable<ResultadoRcChoferes["motivo"]>): ResultadoRcChoferes => ({ ...resultado, ok: false, motivo });

  let token: string;
  try {
    token = await ringcentralToken(credenciales);
  } catch {
    return fallo("autenticacion");
  }

  try {
    const { data: activas, error: eActivas } = await db.from("rc_driver_extensions")
      .select("rc_extension_id").eq("active", true).order("rc_extension_id");
    if (eActivas) throw eActivas;
    const extensiones = (activas ?? []) as ExtensionActiva[];
    resultado.extensiones = extensiones.length;

    if (extensiones.length) {
      const ids = extensiones.map((e) => e.rc_extension_id);
      const { data: estados, error: eEstados } = await db.from("rc_driver_sync_state")
        .select("rc_extension_id, cursor_at").in("rc_extension_id", ids);
      if (eEstados) throw eEstados;
      const cursores = new Map((estados ?? []).map((s) => [s.rc_extension_id as string, s.cursor_at as string | null]));

      for (const e of extensiones) {
        try {
          const desde = ventanaDeLectura(cursores.get(e.rc_extension_id), ahora);
          const { registros, completo } = await listarLlamadas(server, token, e.rc_extension_id, desde);
          const filas = registros
            .map((r) => filaDeLlamadaDeChofer(r, e.rc_extension_id))
            .filter((f): f is FilaDeLlamadaDeChofer => !!f);
          resultado.llamadas += await guardarLlamadas(db, e.rc_extension_id, filas);
          if (completo) {
            await anotarEstado(db, e.rc_extension_id, ahora, null, ahora);
          } else {
            await anotarEstado(db, e.rc_extension_id, ahora, ERROR_DE_LISTADO);
            resultado.motivo = resultado.motivo ?? "listado";
          }
        } catch (err) {
          if (err instanceof SinPermisoRc) {
            // El permiso es de la cuenta: se marca a todas y la corrida para.
            for (const otra of extensiones) await anotarEstado(db, otra.rc_extension_id, ahora, SIN_PERMISO);
            return { ...resultado, ok: false, motivo: "sin_permiso" };
          }
          if (err instanceof LimiteDeRc) {
            await anotarEstado(db, e.rc_extension_id, ahora, LIMITE_DE_RC);
            return { ...resultado, ok: false, motivo: "limite" };
          }
          console.error("[rc-choferes] listado:", err instanceof Error ? err.message : "error");
          await anotarEstado(db, e.rc_extension_id, ahora, ERROR_DE_LISTADO);
          resultado.motivo = resultado.motivo ?? "listado";
        }
      }
    }

    resultado.grabaciones = await bajarGrabaciones(db, token, server);

    const { count } = await db.from("rc_driver_calls").select("id", { count: "exact", head: true }).eq("recording_pending", true);
    resultado.pendientes = count ?? 0;

    if (resultado.motivo) return { ...resultado, ok: false };
    return resultado;
  } catch (err) {
    console.error("[rc-choferes] base:", err instanceof Error ? err.message : "error");
    return fallo("base");
  }
}
