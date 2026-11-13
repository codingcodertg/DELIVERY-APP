import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { muestraDeDisco, ejecutaParte, MotivoPlano, type MuestraDeDisco, type Parte } from "./salud";

/**
 * Lecturas del servidor para «Salud del sistema» (D-1012). Todo corre en el servidor: las llaves (service role,
 * SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN) nunca llegan al navegador.
 *
 * Cada lectura es INDEPENDIENTE (13 nov): tiene su propio tiempo máximo y su propio error. Antes, una sola función
 * `monitor_salud` daba todas las tarjetas; cuando se pasó del tiempo del rol (8 s) se quedaron todas en blanco. Ahora
 * una lectura que falla deja sin datos solo a sus tarjetas, y el resto se pinta.
 *
 * Caché: si todo salió bien, 5 minutos (no añade carga a la base). Si algo falló, 60 segundos: se reintenta pronto.
 */

export const CACHE_MS = 5 * 60_000;
const CACHE_CON_FALLO_MS = 60_000;
/** La base corta a los 8 s (rol `authenticated`). Aquí se rinde antes, con un texto propio. */
const TIEMPO_BASE_MS = 7_000;
/** Metrics API de Supabase: medida en ~1,3 s. Su propio límite corto. */
const TIEMPO_METRICS_MS = 6_000;
const TIEMPO_OTRAS_MS = 8_000;
const PROYECTO_VERCEL = process.env.VERCEL_MONITOR_PROJECT_ID || "prj_pd2qIyik5TNEjdYmiAZdOQUtjDvP";
const EQUIPO_VERCEL = process.env.VERCEL_MONITOR_TEAM_ID || "team_rhI0n5XPR2bKAXJnGdBgOzGY";

export interface EscriturasDB {
  estadisticas_desde: string | null;
  wal_total: number;
  escrituras: { consulta: string; calls: number; wal_bytes: number; ms: number }[];
}
export interface ArchivosDB {
  buckets: { bucket: string; archivos: number; bytes: number; bytes_7d: number; bytes_30d: number }[];
}
export interface BaseDB {
  generado: string;
  db_bytes: number;
  tablas: { nombre: string; bytes: number }[];
  conexiones: number;
  conexiones_max: number;
  cache_aciertos: number | null;
  movidas: { tabla: string; cambios: number; muertas: number; last_autovacuum: string | null }[];
}
export interface RevisionDB {
  sin_rls: number;
  select_abiertas: number;
  definer_anon: number;
}

export interface DatosDeVercel {
  deploys24h: number;
  fallidos24h: number;
  deploys7d: number;
  fallidos7d: number;
  ultimo: string | null;
}

export interface Salud {
  leidoEn: number;
  escrituras: Parte<EscriturasDB>;
  archivos: Parte<ArchivosDB>;
  base: Parte<BaseDB>;
  revision: Parte<RevisionDB>;
  disco: { antes: MuestraDeDisco | null; ahora: MuestraDeDisco | null; configurado: boolean; error: string | null };
  compute: { nombre: string | null; configurado: boolean; error: string | null };
  vercel: { datos: DatosDeVercel | null; configurado: boolean; error: string | null };
}

let cache: { salud: Salud; expira: number } | null = null;
let muestraAnterior: MuestraDeDisco | null = null;

export function olvidaCacheDeSalud() { cache = null; }

function refDelProyecto(): string | null {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0] || null; } catch { return null; }
}

/** Llama una función de monitor de la base. Si falta la migración, lo dice en plano (no el mensaje de Postgres). */
async function llamaMonitor<T>(supabase: SupabaseClient, nombre: string, migracion: string): Promise<Parte<T>> {
  return ejecutaParte(async () => {
    const { data, error } = await supabase.rpc(nombre);
    if (error) {
      const msg = String((error as { message?: string }).message ?? "");
      const codigo = String((error as { code?: string }).code ?? "");
      if (codigo === "PGRST202" || /could not find the function|schema cache|function .* does not exist/i.test(msg)) {
        throw new MotivoPlano(`falta aplicar la migración ${migracion}`);
      }
      throw error;
    }
    return data as T;
  }, TIEMPO_BASE_MS);
}

/** Metrics API de Supabase (Prometheus): `https://<ref>.supabase.co/customer/v1/privileged/metrics`, Basic service_role. */
async function leeDisco(): Promise<Salud["disco"]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) return { antes: null, ahora: null, configurado: false, error: null };
  const p = await ejecutaParte(async () => {
    const r = await fetch(`${url.replace(/\/$/, "")}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${llave}`).toString("base64")}` }, cache: "no-store",
    });
    if (!r.ok) throw new MotivoPlano(`la Metrics API respondió ${r.status}`);
    return r.text();
  }, TIEMPO_METRICS_MS);
  if (p.error !== null) return { antes: muestraAnterior, ahora: null, configurado: true, error: p.error };
  const ahora = muestraDeDisco(p.datos ?? "", Date.now());
  const antes = muestraAnterior;
  if (ahora) muestraAnterior = ahora;
  return { antes, ahora, configurado: true, error: ahora ? null : "la Metrics API no trajo métricas de disco" };
}

/** Management API: `GET /v1/projects/{ref}/billing/addons` → el compute seleccionado. Requiere SUPABASE_ACCESS_TOKEN. */
async function leeCompute(): Promise<Salud["compute"]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = refDelProyecto();
  if (!token || !ref) return { nombre: null, configurado: false, error: null };
  const p = await ejecutaParte(async () => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/billing/addons`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (!r.ok) throw new MotivoPlano(`la Management API respondió ${r.status}`);
    return (await r.json()) as { selected_addons?: { type?: string; variant?: { id?: string; name?: string } }[] };
  }, TIEMPO_OTRAS_MS);
  if (p.error !== null || !p.datos) return { nombre: null, configurado: true, error: p.error ?? "sin respuesta" };
  const ci = (p.datos.selected_addons ?? []).find((a) => a.type === "compute_instance");
  return { nombre: ci?.variant?.name ?? ci?.variant?.id ?? "Sin compute adicional (el incluido en el plan)", configurado: true, error: null };
}

/** Vercel REST: `GET /v6/deployments` de producción de los últimos 7 días. Requiere VERCEL_TOKEN. */
async function leeVercel(): Promise<Salud["vercel"]> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { datos: null, configurado: false, error: null };
  const p = await ejecutaParte(async () => {
    const desde = Date.now() - 7 * 24 * 3600_000;
    const q = new URLSearchParams({ projectId: PROYECTO_VERCEL, teamId: EQUIPO_VERCEL, target: "production", since: String(desde), limit: "100" });
    const r = await fetch(`https://api.vercel.com/v6/deployments?${q}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!r.ok) throw new MotivoPlano(`Vercel respondió ${r.status}`);
    return (await r.json()) as { deployments?: { created?: number; createdAt?: number; state?: string; readyState?: string }[] };
  }, TIEMPO_OTRAS_MS);
  if (p.error !== null || !p.datos) return { datos: null, configurado: true, error: p.error ?? "sin respuesta" };
  const ds = (p.datos.deployments ?? []).map((d) => ({ t: d.createdAt ?? d.created ?? 0, estado: (d.readyState ?? d.state ?? "").toUpperCase() }));
  const hace24 = Date.now() - 24 * 3600_000;
  const falla = (e: string) => e === "ERROR" || e === "CANCELED";
  return {
    configurado: true, error: null,
    datos: {
      deploys24h: ds.filter((d) => d.t >= hace24).length,
      fallidos24h: ds.filter((d) => d.t >= hace24 && falla(d.estado)).length,
      deploys7d: ds.length,
      fallidos7d: ds.filter((d) => falla(d.estado)).length,
      ultimo: ds.length ? new Date(Math.max(...ds.map((d) => d.t))).toISOString() : null,
    },
  };
}

/** Lee todo (o lo devuelve de la caché). `supabase` es el cliente con la sesión del admin. Nunca lanza. */
export async function leerSalud(supabase: SupabaseClient, forzar = false): Promise<Salud> {
  if (!forzar && cache && Date.now() < cache.expira) return cache.salud;
  const [escrituras, archivos, base, revision, disco, compute, vercel] = await Promise.all([
    llamaMonitor<EscriturasDB>(supabase, "monitor_salud_escrituras", "307"),
    llamaMonitor<ArchivosDB>(supabase, "monitor_salud_archivos", "307"),
    llamaMonitor<BaseDB>(supabase, "monitor_salud_base", "307"),
    llamaMonitor<RevisionDB>(supabase, "monitor_salud_revision", "307"),
    leeDisco(), leeCompute(), leeVercel(),
  ]);
  const salud: Salud = { leidoEn: Date.now(), escrituras, archivos, base, revision, disco, compute, vercel };
  const todoBien = [escrituras, archivos, base, revision].every((p) => p.error === null) && !disco.error && !compute.error && !vercel.error;
  cache = { salud, expira: Date.now() + (todoBien ? CACHE_MS : CACHE_CON_FALLO_MS) };
  return salud;
}
