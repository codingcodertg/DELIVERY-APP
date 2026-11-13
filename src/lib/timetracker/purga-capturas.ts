import { timetrackerRestHeaders, type FetchLike } from "./live-session-cron";

/**
 * Purga automática de las capturas de pantalla del Time Tracker (la promesa de «> 14 days» de la pantalla del gerente).
 *
 * Por qué existe: la purga vieja era `timetracker.purge_old_screenshots` (migración 060), programada en pg_cron. Borraba
 * `storage.objects` con SQL directo, y Supabase lo bloquea («Direct deletion from storage tables is not allowed»): cada
 * noche fallaba y en 2,2 GB de capturas no se borró nada. Aquí los archivos se borran por la API de Storage (la única vía
 * permitida), y la fila de `timetracker.screenshots` sale después, por su ruta.
 *
 * Reglas (revisión de seguridad del 12 nov):
 * - Las LAS CANDIDATAS salen de `storage.objects` (bucket `timetracker-screenshots`, `created_at` anterior al corte),
 *   por la función `timetracker.capturas_vencidas` (migración 304, solo service_role). Las filas NO deciden nada: un
 *   empleado puede escribirlas, y una fila falsa no puede borrar ni bloquear la purga.
 * - La forma de la ruta se filtra EN LA BASE (`<uid>/<session>/<archivo>`, sin `..`, barras invertidas ni barra inicial),
 *   antes del LIMIT: una ruta rara no ocupa sitio en el lote ni puede dejar a las demás sin purgar. Aquí se vuelve a
 *   comprobar en memoria (`candidatasDeStorage`) como defensa.
 * - Idempotente: lo que se borró ya no sale como candidato. Acotada a `LIMITE_CAPTURAS_POR_CORRIDA` archivos por corrida.
 * - Después de borrar un archivo, se borran las filas cuya `path` es ese archivo. Una fila nunca borra un archivo.
 *
 * `fetchImpl` se inyecta para probarlo con datos sintéticos, sin red (igual que `live-session-cron.ts`).
 */

/** Días que se guardan las capturas. Igual que el texto de la pantalla; cambiarlo exige cambiar ese texto y DECISIONS. */
export const RETENCION_CAPTURAS_DIAS = 14;
/** Tope de archivos por corrida del cron. */
export const LIMITE_CAPTURAS_POR_CORRIDA = 500;
export const BUCKET_CAPTURAS = "timetracker-screenshots";
/** Función SQL (migración 304) que lista las candidatas desde storage.objects. */
export const FUNCION_CANDIDATAS = "capturas_vencidas";
/** Nombres por llamada a la API de Storage y por llamada a PostgREST: lotes que no alargan la URL ni el cuerpo. */
const LOTE = 100;

/** Instante (ms) antes del cual una captura ya vence. Pura. */
export function corteCapturas(now: number, dias: number = RETENCION_CAPTURAS_DIAS): number {
  return now - dias * 86_400_000;
}

/** Parte `items` en lotes de `n`, en orden. Pura. */
export function enLotes<T>(items: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * ¿Es esta ruta una captura de ESTE empleado? Forma `<employee_uid>/<session>/<archivo>`, sin `..`, sin barra inicial ni
 * invertida, sin partes vacías. Pura. (La misma forma que filtra la función SQL de la migración 304.)
 */
export function rutaDeCapturaValida(path: string | null | undefined, employeeUid: string | null | undefined): boolean {
  if (!path || !employeeUid) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("..") || path.includes('"')) return false;
  const partes = path.split("/");
  if (partes.length !== 3 || partes.some((p) => p === "")) return false;
  return partes[0] === employeeUid;
}

/**
 * Candidatas a borrar, a partir de los objetos que devuelve la base: solo rutas con forma de captura, anteriores al
 * corte según el `created_at` DEL OBJETO, ordenadas de más viejo a más nuevo y acotadas al límite. Pura.
 */
export function candidatasDeStorage(
  objetos: ReadonlyArray<{ name: string; created_at: string | null }>,
  corteMs: number,
  limite: number,
): { path: string; created_at: string }[] {
  const out: { path: string; created_at: string }[] = [];
  for (const o of objetos) {
    if (!o.created_at) continue;
    const t = Date.parse(o.created_at);
    if (!Number.isFinite(t) || t >= corteMs) continue;
    if (!rutaDeCapturaValida(o.name, o.name.split("/")[0])) continue;
    out.push({ path: o.name, created_at: o.created_at });
  }
  out.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return out.slice(0, limite);
}

export type ResultadoPurga = {
  ok: boolean;
  retencionDias: number;
  /** Fecha de corte (ISO): los archivos con `created_at` anterior vencen. */
  corte: string;
  /** Candidatas que devolvió la base (con forma de captura y vencidas), como mucho el límite. */
  encontradas: number;
  /** Objetos que la base devolvió y que no tienen forma de captura: no se tocan. */
  rechazadas: number;
  /** Archivos borrados de Storage. */
  archivosBorrados: number;
  /** Filas de `timetracker.screenshots` borradas con su archivo. */
  filasBorradas: number;
  /** Archivos o filas cuyo borrado falló; siguen para la próxima corrida. */
  fallidas: number;
};

export async function purgaCapturas(opts: {
  url: string;
  key: string;
  now?: number;
  limite?: number;
  fetchImpl?: FetchLike;
}): Promise<ResultadoPurga> {
  const { url, key } = opts;
  const now = opts.now ?? Date.now();
  const limite = opts.limite ?? LIMITE_CAPTURAS_POR_CORRIDA;
  const f: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const H = timetrackerRestHeaders(key);
  const corteMs = corteCapturas(now);
  const corte = new Date(corteMs).toISOString();
  const res: ResultadoPurga = {
    ok: false, retencionDias: RETENCION_CAPTURAS_DIAS, corte, encontradas: 0,
    rechazadas: 0, archivosBorrados: 0, filasBorradas: 0, fallidas: 0,
  };
  const storageH = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  // 1) Candidatas desde storage.objects (función de la migración 304; el perfil timetracker la encuentra).
  const r = await f(`${url}/rest/v1/rpc/${FUNCION_CANDIDATAS}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ corte, limite }),
    cache: "no-store",
  });
  if (!r.ok) return res;
  const raw = await r.json();
  const objetos = (Array.isArray(raw) ? raw : []).filter(
    (x): x is { name: string; created_at: string | null } => !!x && typeof x.name === "string",
  );
  const cands = candidatasDeStorage(objetos, corteMs, limite);
  res.encontradas = cands.length;
  res.rechazadas = objetos.length - cands.length;

  // 2) Por lotes: el archivo por la API de Storage; sus filas solo si el archivo salió bien.
  for (const lote of enLotes(cands.map((c) => c.path), LOTE)) {
    const s = await f(`${url}/storage/v1/object/${BUCKET_CAPTURAS}`, {
      method: "DELETE",
      headers: storageH,
      body: JSON.stringify({ prefixes: lote }),
    });
    if (!s.ok) { res.fallidas += lote.length; continue; }
    res.archivosBorrados += lote.length;

    const enLista = lote.map((p) => `"${p}"`).join(",");
    const d = await f(`${url}/rest/v1/screenshots?path=in.(${encodeURIComponent(enLista)})`, {
      method: "DELETE",
      headers: { ...H, Prefer: "return=representation" },
    });
    if (!d.ok) { res.fallidas += lote.length; continue; }
    const borradas = await d.json();
    res.filasBorradas += Array.isArray(borradas) ? borradas.length : 0;
  }

  res.ok = res.fallidas === 0;
  return res;
}
