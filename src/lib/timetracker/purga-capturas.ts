import { timetrackerRestHeaders, type FetchLike } from "./live-session-cron";

/**
 * Purga automática de las capturas de pantalla del Time Tracker (la promesa de «> 14 days» de la pantalla del gerente).
 *
 * Por qué existe: la purga vieja era `timetracker.purge_old_screenshots` (migración 060), programada en pg_cron. Borraba
 * `storage.objects` con SQL directo, y Supabase lo bloquea («Direct deletion from storage tables is not allowed»): cada
 * noche fallaba y en 2,2 GB de capturas no se borró nada. Aquí los archivos se borran por la API de Storage (la única vía
 * permitida), en lotes, y la fila de `timetracker.screenshots` solo sale DESPUÉS de que su archivo se haya borrado.
 *
 * Reglas de seguridad (revisión del 12 nov):
 * - La antigüedad la manda el `created_at` del OBJETO en Storage, no la fecha de la fila (`taken_at`): los empleados
 *   pueden escribir filas, así que una fila con fecha vieja no basta para borrar un archivo reciente.
 * - Una fila solo puede borrar su propio archivo: la ruta debe ser `<employee_uid de la fila>/<session>/<archivo>`.
 *   Sin `..`, sin barra inicial, sin barras invertidas, y exactamente tres partes. Lo que no cuadra se CUENTA como
 *   rechazado y no se borra nada.
 * - Los archivos se listan por sesión (`<uid>/<session>/`) y el borrado solo va sobre nombres que la listación de la
 *   propia carpeta devuelve: nunca sobre rutas que vienen de la fila sin confirmar.
 *
 * Idempotente y acotada: como mucho `LIMITE_CAPTURAS_POR_CORRIDA` filas y `MAX_SESIONES_POR_CORRIDA` listados por
 * corrida, para no pasar del límite de tiempo de la ruta. El archivo huérfano (sin fila) no lo ve esta purga: lo
 * barre `scripts/timetracker/purga-atrasada.mjs` desde el listado completo del bucket.
 *
 * `fetchImpl` se inyecta para probarlo con datos sintéticos, sin red (igual que `live-session-cron.ts`).
 */

/** Días que se guardan las capturas. Igual que el texto de la pantalla; cambiarlo exige cambiar ese texto y DECISIONS. */
export const RETENCION_CAPTURAS_DIAS = 14;
/** Tope de filas por corrida del cron. */
export const LIMITE_CAPTURAS_POR_CORRIDA = 500;
/** Tope de listados de carpeta (una por sesión) por corrida. */
export const MAX_SESIONES_POR_CORRIDA = 100;
export const BUCKET_CAPTURAS = "timetracker-screenshots";
/** Nombres por llamada a la API de Storage (y ids por llamada a PostgREST): lotes que no alargan la URL ni el cuerpo. */
const LOTE = 100;
const PAGINA = 1000;

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
 * ¿Es esta ruta una captura legítima de ESTE empleado? Forma `<employee_uid>/<session>/<archivo>`, sin `..`, sin barra
 * inicial ni invertida, sin partes vacías. Pura.
 */
export function rutaDeCapturaValida(path: string | null | undefined, employeeUid: string | null | undefined): boolean {
  if (!path || !employeeUid) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("..")) return false;
  const partes = path.split("/");
  if (partes.length !== 3 || partes.some((p) => p === "")) return false;
  return partes[0] === employeeUid;
}

/** Carpeta de sesión (`<uid>/<session>/`) de una ruta ya validada. Pura. */
export function carpetaDeRuta(path: string): string {
  const [uid, sesion] = path.split("/");
  return `${uid}/${sesion}/`;
}

export type ResultadoPurga = {
  ok: boolean;
  retencionDias: number;
  /** Fecha de corte (ISO): los archivos con `created_at` anterior vencen. */
  corte: string;
  /** Filas vencidas leídas en esta corrida (como mucho el límite). */
  encontradas: number;
  /** Filas sin ruta, o cuyo archivo ya no está en Storage: solo se borra la fila. */
  sinArchivo: number;
  /** Filas cuya ruta no es de su empleado (o es sospechosa): no se toca nada. */
  rechazadas: number;
  /** Filas cuyo archivo es reciente en Storage aunque la fila sea vieja: no se toca nada. */
  recientes: number;
  /** Archivos borrados de Storage. */
  archivosBorrados: number;
  /** Filas borradas. */
  filasBorradas: number;
  /** Filas cuyo borrado (de archivo o de fila) falló o no se pudo listar; siguen para la próxima corrida. */
  fallidas: number;
};

type FilaCaptura = { id: string; path: string | null; employee_uid: string | null };
type Objeto = { name: string; created_at: string | null };

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
    sinArchivo: 0, rechazadas: 0, recientes: 0, archivosBorrados: 0, filasBorradas: 0, fallidas: 0,
  };
  const storageH = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  // 1) Candidatas: filas viejas por `taken_at`. Solo sirven para encontrar candidatas; NO deciden el borrado del archivo.
  const r = await f(
    `${url}/rest/v1/screenshots?select=id,path,employee_uid&taken_at=lt.${encodeURIComponent(corte)}&order=taken_at.asc&limit=${limite}`,
    { headers: H, cache: "no-store" },
  );
  if (!r.ok) return res;
  const raw = await r.json();
  const filas = (Array.isArray(raw) ? raw : []).filter(
    (x): x is FilaCaptura => !!x && typeof (x as FilaCaptura).id === "string",
  );
  res.encontradas = filas.length;

  const borrarFilas = async (ids: string[]) => {
    for (const lote of enLotes(ids, LOTE)) {
      const d = await f(`${url}/rest/v1/screenshots?id=in.(${lote.join(",")})`, {
        method: "DELETE",
        headers: { ...H, Prefer: "return=minimal" },
      });
      if (d.ok) res.filasBorradas += lote.length; else res.fallidas += lote.length;
    }
  };

  // 2) Clasificar: sin ruta, ruta ajena/sospechosa, o ruta propia agrupada por carpeta de sesión.
  const sinRuta: string[] = [];
  const porCarpeta = new Map<string, FilaCaptura[]>();
  for (const x of filas) {
    if (!x.path) { sinRuta.push(x.id); continue; }
    if (!rutaDeCapturaValida(x.path, x.employee_uid)) { res.rechazadas++; continue; }
    const c = carpetaDeRuta(x.path);
    if (!porCarpeta.has(c)) {
      if (porCarpeta.size >= MAX_SESIONES_POR_CORRIDA) continue; // sin tiempo para listar más: la próxima corrida
      porCarpeta.set(c, []);
    }
    porCarpeta.get(c)!.push(x);
  }
  res.sinArchivo = sinRuta.length;
  await borrarFilas(sinRuta);

  // 3) Por cada sesión: listar SU carpeta en Storage (con paginación) y decidir con el created_at del objeto.
  const sinArchivoEnStorage: string[] = [];
  for (const [carpeta, filasDeCarpeta] of porCarpeta) {
    const objetos: Objeto[] = [];
    let listado = true;
    for (let offset = 0; ; offset += PAGINA) {
      const l = await f(`${url}/storage/v1/object/list/${BUCKET_CAPTURAS}`, {
        method: "POST",
        headers: storageH,
        body: JSON.stringify({ prefix: carpeta, limit: PAGINA, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!l.ok) { listado = false; break; }
      const items = (await l.json()) as Array<{ name: string; id: string | null; created_at: string | null }>;
      for (const it of items) if (it.id !== null) objetos.push({ name: it.name, created_at: it.created_at });
      if (items.length < PAGINA) break;
    }
    if (!listado) { res.fallidas += filasDeCarpeta.length; continue; }

    const porNombre = new Map(objetos.map((o) => [`${carpeta}${o.name}`, o]));
    const aBorrar: FilaCaptura[] = [];
    for (const x of filasDeCarpeta) {
      const o = porNombre.get(x.path!);
      if (!o) { sinArchivoEnStorage.push(x.id); continue; }            // no hay archivo: solo la fila
      const creado = o.created_at ? Date.parse(o.created_at) : NaN;
      if (!Number.isFinite(creado)) { res.rechazadas++; continue; }   // sin fecha fiable: no se toca
      if (creado >= corteMs) { res.recientes++; continue; }           // archivo reciente: no se toca
      aBorrar.push(x);
    }
    res.sinArchivo += sinArchivoEnStorage.length;
    await borrarFilas(sinArchivoEnStorage.splice(0));

    // 4) Archivo primero (API de Storage); la fila solo si su lote de archivos salió bien.
    for (const lote of enLotes(aBorrar, LOTE)) {
      const s = await f(`${url}/storage/v1/object/${BUCKET_CAPTURAS}`, {
        method: "DELETE",
        headers: storageH,
        body: JSON.stringify({ prefixes: lote.map((x) => x.path) }),
      });
      if (!s.ok) { res.fallidas += lote.length; continue; }
      res.archivosBorrados += lote.length;
      await borrarFilas(lote.map((x) => x.id));
    }
  }

  res.ok = res.fallidas === 0;
  return res;
}
