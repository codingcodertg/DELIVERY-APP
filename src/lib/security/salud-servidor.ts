import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { muestraDeDisco, type MuestraDeDisco } from "./salud";

/**
 * Lecturas del servidor para «Salud del sistema» (D-1012). Todo corre en el servidor: las llaves (service role,
 * SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN) nunca llegan al navegador. Se guarda 5 minutos en memoria para no añadir carga
 * a la base (la pantalla misma no debe gastar el Disk IO que vigila).
 */

export const CACHE_MS = 5 * 60_000;
const PROYECTO_VERCEL = process.env.VERCEL_MONITOR_PROJECT_ID || "prj_pd2qIyik5TNEjdYmiAZdOQUtjDvP";
const EQUIPO_VERCEL = process.env.VERCEL_MONITOR_TEAM_ID || "team_rhI0n5XPR2bKAXJnGdBgOzGY";

export interface DatosDeBase {
  generado: string;
  db_bytes: number;
  tablas: { nombre: string; bytes: number }[];
  buckets: { bucket: string; archivos: number; bytes: number; bytes_7d: number; bytes_30d: number }[];
  estadisticas_desde: string | null;
  escrituras: { consulta: string; calls: number; wal_bytes: number; ms: number }[];
  wal_total: number;
  conexiones: number;
  conexiones_max: number;
  cache_aciertos: number | null;
  movidas: { tabla: string; cambios: number; muertas: number; last_autovacuum: string | null }[];
  revision: { sin_rls: number; select_abiertas: number; definer_anon: number };
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
  base: DatosDeBase | null;
  baseError: string | null;
  disco: { antes: MuestraDeDisco | null; ahora: MuestraDeDisco | null; configurado: boolean; error: string | null };
  compute: { nombre: string | null; configurado: boolean; error: string | null };
  vercel: { datos: DatosDeVercel | null; configurado: boolean; error: string | null };
}

let cache: Salud | null = null;
let muestraAnterior: MuestraDeDisco | null = null;

export function olvidaCacheDeSalud() { cache = null; }

function refDelProyecto(): string | null {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0] || null; } catch { return null; }
}

async function conTiempo<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error("tiempo agotado")), ms))]);
}

/** Metrics API de Supabase (Prometheus): `https://<ref>.supabase.co/customer/v1/privileged/metrics`, Basic service_role. */
async function leeDisco(): Promise<Salud["disco"]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) return { antes: null, ahora: null, configurado: false, error: null };
  try {
    const r = await conTiempo(fetch(`${url.replace(/\/$/, "")}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${llave}`).toString("base64")}` }, cache: "no-store",
    }));
    if (!r.ok) return { antes: muestraAnterior, ahora: null, configurado: true, error: `Metrics API respondió ${r.status}` };
    const ahora = muestraDeDisco(await r.text(), Date.now());
    const antes = muestraAnterior;
    if (ahora) muestraAnterior = ahora;
    return { antes, ahora, configurado: true, error: ahora ? null : "La Metrics API no trajo métricas de disco" };
  } catch (e) {
    return { antes: muestraAnterior, ahora: null, configurado: true, error: (e as Error).message };
  }
}

/** Management API: `GET /v1/projects/{ref}/billing/addons` → el compute seleccionado. Requiere SUPABASE_ACCESS_TOKEN. */
async function leeCompute(): Promise<Salud["compute"]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = refDelProyecto();
  if (!token || !ref) return { nombre: null, configurado: false, error: null };
  try {
    const r = await conTiempo(fetch(`https://api.supabase.com/v1/projects/${ref}/billing/addons`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    }));
    if (!r.ok) return { nombre: null, configurado: true, error: `Management API respondió ${r.status}` };
    const j = (await r.json()) as { selected_addons?: { type?: string; variant?: { id?: string; name?: string } }[] };
    const ci = (j.selected_addons ?? []).find((a) => a.type === "compute_instance");
    return { nombre: ci?.variant?.name ?? ci?.variant?.id ?? "Sin compute adicional (el incluido en el plan)", configurado: true, error: null };
  } catch (e) {
    return { nombre: null, configurado: true, error: (e as Error).message };
  }
}

/** Vercel REST: `GET /v6/deployments` de producción de los últimos 7 días. Requiere VERCEL_TOKEN. */
async function leeVercel(): Promise<Salud["vercel"]> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { datos: null, configurado: false, error: null };
  try {
    const desde = Date.now() - 7 * 24 * 3600_000;
    const q = new URLSearchParams({ projectId: PROYECTO_VERCEL, teamId: EQUIPO_VERCEL, target: "production", since: String(desde), limit: "100" });
    const r = await conTiempo(fetch(`https://api.vercel.com/v6/deployments?${q}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }));
    if (!r.ok) return { datos: null, configurado: true, error: `Vercel respondió ${r.status}` };
    const j = (await r.json()) as { deployments?: { created?: number; createdAt?: number; state?: string; readyState?: string }[] };
    const ds = (j.deployments ?? []).map((d) => ({ t: d.createdAt ?? d.created ?? 0, estado: (d.readyState ?? d.state ?? "").toUpperCase() }));
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
  } catch (e) {
    return { datos: null, configurado: true, error: (e as Error).message };
  }
}

/** Lee todo (o lo devuelve de la caché de 5 min). `supabase` es el cliente con la sesión del admin. */
export async function leerSalud(supabase: SupabaseClient, forzar = false): Promise<Salud> {
  if (!forzar && cache && Date.now() - cache.leidoEn < CACHE_MS) return cache;
  const [rpc, disco, compute, vercel] = await Promise.all([
    supabase.rpc("monitor_salud").then((r) => r, (e: Error) => ({ data: null, error: { message: e.message } })),
    leeDisco(), leeCompute(), leeVercel(),
  ]);
  const faltaLa300 = rpc.error && /monitor_salud|function .* does not exist|PGRST202/i.test(rpc.error.message ?? "");
  cache = {
    leidoEn: Date.now(),
    base: (rpc.data as DatosDeBase | null) ?? null,
    baseError: rpc.error ? (faltaLa300 ? "Falta aplicar la migración 300 para leer las estadísticas de la base." : rpc.error.message ?? "error") : null,
    disco, compute, vercel,
  };
  return cache;
}
