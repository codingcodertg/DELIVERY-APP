#!/usr/bin/env node
// Purga ATRASADA de capturas del Time Tracker (one-off): las que la purga de pg_cron no borró.
//
// Por qué existe: `timetracker.purge_old_screenshots` borraba `storage.objects` con SQL, y Supabase lo bloquea («Direct
// deletion from storage tables is not allowed»): cada noche falló y el bucket `timetracker-screenshots` acumuló archivos
// de más de 14 días. La ruta nueva (/api/cron/purga-capturas) borra solo lo del día a día, 500 filas por corrida. Esto
// barre lo que ya estaba atrasado, con la misma regla: archivo tomado antes del corte, borrado por la API de Storage en
// lotes, y la fila de `timetracker.screenshots` solo después de su archivo.
//
// Uso:
//   node --env-file=.env.local scripts/timetracker/purga-atrasada.mjs            → REPORTE: cuenta y tamaño, no borra nada
//   node --env-file=.env.local scripts/timetracker/purga-atrasada.mjs --escribe  → BORRA (archivos y filas vencidas)
//
// Sin `--escribe` no hay ninguna llamada de borrado. Idempotente: volver a correrlo solo encuentra lo que quedó.
// Los archivos sin fila (huérfanos) también se listan y se borran; las filas sin archivo se borran al final.
import { pathToFileURL } from "node:url";
import { cargaEntorno } from "../db/ledger.mjs";

export const BUCKET = "timetracker-screenshots";
export const RETENCION_DIAS = 14;
const DIA = 86_400_000;
const LOTE = 100;
const PAGINA = 1000;

/** Instante (ms) antes del cual una captura vence. Pura. */
export function corte(now, dias = RETENCION_DIAS) {
  return now - dias * DIA;
}

/** Parte `items` en lotes de `n`, en orden. Pura. */
export function enLotes(items, n) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** De los objetos del bucket ({path, created_at, size}), los que vencen: tomados ANTES del corte. Sin fecha, no vencen. Pura. */
export function rutasVencidas(objetos, corteMs) {
  return objetos.filter((o) => o.created_at && Date.parse(o.created_at) < corteMs);
}

/** Cuenta, bytes, más viejo y más nuevo de un conjunto de objetos. Pura. */
export function resumen(objetos) {
  let bytes = 0;
  let masViejo = null;
  let masNuevo = null;
  for (const o of objetos) {
    bytes += Number(o.size) || 0;
    const t = Date.parse(o.created_at);
    if (Number.isFinite(t)) {
      if (masViejo === null || t < masViejo) masViejo = t;
      if (masNuevo === null || t > masNuevo) masNuevo = t;
    }
  }
  return {
    n: objetos.length,
    bytes,
    masViejo: masViejo === null ? null : new Date(masViejo).toISOString(),
    masNuevo: masNuevo === null ? null : new Date(masNuevo).toISOString(),
  };
}

const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
const fmt = (n) => Number(n).toLocaleString("es-MX");

function storageHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}
function restHeaders(key, extra = {}) {
  return { ...storageHeaders(key), "Accept-Profile": "timetracker", "Content-Profile": "timetracker", ...extra };
}

/** Lista TODO el bucket recursivamente (carpeta = `id` nulo). Devuelve {path, created_at, size}. */
async function listaTodo(url, key, prefix = "", out = []) {
  let offset = 0;
  for (;;) {
    const r = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: storageHeaders(key),
      body: JSON.stringify({ prefix, limit: PAGINA, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) throw new Error(`listar «${prefix}»: HTTP ${r.status}`);
    const items = await r.json();
    for (const it of items) {
      const ruta = prefix + it.name;
      if (it.id === null) await listaTodo(url, key, `${ruta}/`, out);
      else out.push({ path: ruta, created_at: it.created_at, size: Number(it.metadata?.size) || 0 });
    }
    if (items.length < PAGINA) break;
    offset += PAGINA;
  }
  return out;
}

/** Todas las filas de `timetracker.screenshots` (id, path, taken_at), paginadas. */
async function todasLasFilas(url, key) {
  const out = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(`${url}/rest/v1/screenshots?select=id,path,taken_at&order=id.asc&limit=${PAGINA}&offset=${offset}`, {
      headers: restHeaders(key),
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`leer filas: HTTP ${r.status}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < PAGINA) break;
    offset += PAGINA;
  }
  return out;
}

async function borraArchivos(url, key, paths) {
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: storageHeaders(key),
    body: JSON.stringify({ prefixes: paths }),
  });
  return r.ok;
}

async function borraFilas(url, key, ids) {
  const r = await fetch(`${url}/rest/v1/screenshots?id=in.(${ids.join(",")})`, {
    method: "DELETE",
    headers: restHeaders(key, { Prefer: "return=minimal" }),
  });
  return r.ok;
}

async function main() {
  cargaEntorno();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (usa --env-file=.env.local).");
    process.exit(1);
  }
  const escribe = process.argv.includes("--escribe");
  const corteMs = corte(Date.now());
  const corteIso = new Date(corteMs).toISOString();

  console.log(`Modo: ${escribe ? "ESCRIBE (borra archivos y filas vencidas)" : "REPORTE (no borra nada)"}`);
  console.log(`Corte: ${RETENCION_DIAS} días → capturas tomadas antes de ${corteIso} vencen.`);

  const archivos = await listaTodo(url, key);
  const filas = await todasLasFilas(url, key);
  const total = resumen(archivos);
  const vencArchivos = rutasVencidas(archivos, corteMs);
  const vArch = resumen(vencArchivos);
  const rutasConFila = new Set(filas.map((f) => f.path).filter(Boolean));
  const huerfanos = vencArchivos.filter((o) => !rutasConFila.has(o.path));
  const filasVencidas = filas.filter((f) => f.taken_at && Date.parse(f.taken_at) < corteMs);
  const filasSinArchivo = filasVencidas.filter((f) => !f.path);

  console.log("");
  console.log(`Bucket ${BUCKET}: ${fmt(total.n)} archivos, ${gb(total.bytes)}.`);
  console.log(`Archivos vencidos: ${fmt(vArch.n)} (${gb(vArch.bytes)}), de ${vArch.masViejo ?? "-"} a ${vArch.masNuevo ?? "-"}.`);
  console.log(`  con fila en timetracker.screenshots: ${fmt(vArch.n - huerfanos.length)}; huérfanos (sin fila): ${fmt(huerfanos.length)} (${gb(resumen(huerfanos).bytes)}).`);
  console.log(`Filas vencidas: ${fmt(filasVencidas.length)} (con archivo: ${fmt(filasVencidas.length - filasSinArchivo.length)}; sin archivo: ${fmt(filasSinArchivo.length)}).`);

  if (!escribe) {
    console.log("");
    console.log(`REPORTE: con --escribe borraría ${fmt(vArch.n)} archivos (${gb(vArch.bytes)}) y ${fmt(filasVencidas.length)} filas. No se borró nada.`);
    return;
  }

  // ESCRIBE: archivo primero (API de Storage), fila después, en lotes. Se para al primer fallo: lo que quede se
  // reintenta con otra corrida, y nunca queda una fila sin su archivo.
  let archivosBorrados = 0;
  let filasBorradas = 0;
  const idsBorrados = new Set();
  const rutaAFila = new Map(filasVencidas.filter((f) => f.path).map((f) => [f.path, f.id]));
  const rutasEnBucket = new Set(archivos.map((o) => o.path));
  for (const lote of enLotes(vencArchivos.map((o) => o.path), LOTE)) {
    if (!(await borraArchivos(url, key, lote))) {
      console.error(`Fallo al borrar un lote de ${lote.length} archivos; se para. Vuelve a correr para reintentar.`);
      process.exit(2);
    }
    archivosBorrados += lote.length;
    const ids = lote.map((p) => rutaAFila.get(p)).filter(Boolean);
    for (const lf of enLotes(ids, LOTE)) {
      if (await borraFilas(url, key, lf)) {
        filasBorradas += lf.length;
        lf.forEach((id) => idsBorrados.add(id));
      }
    }
    if (archivosBorrados % 1000 < LOTE) console.log(`  ... ${fmt(archivosBorrados)} archivos borrados`);
  }
  // Filas vencidas no cubiertas arriba: sin ruta, o con una ruta que NO está ya en el bucket. Una fila cuya ruta sigue
  // existiendo (archivo reciente, o de otro empleado) NO se borra aquí: manda el archivo, no la fecha de la fila.
  const restantes = filasVencidas
    .filter((f) => !f.path || !rutasEnBucket.has(f.path))
    .map((f) => f.id)
    .filter((id) => !idsBorrados.has(id));
  for (const lf of enLotes(restantes, LOTE)) {
    if (await borraFilas(url, key, lf)) filasBorradas += lf.length;
  }
  console.log("");
  console.log(`Hecho: ${fmt(archivosBorrados)} archivos borrados (${gb(vArch.bytes)} de vencidos), ${fmt(filasBorradas)} filas borradas.`);
}

// Solo corre al ejecutarse como script; importarlo (en las pruebas) no hace nada.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
