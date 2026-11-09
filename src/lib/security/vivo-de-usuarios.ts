import { versionDeApp } from "./version-de-app";
import { appForPath } from "@/lib/app-for-path";

/** Lo que el administrador de permisos sabe «en vivo» de cada persona (D-944/945): dentro ahora, desde qué cliente y
 *  —si la 278 ya guarda la ruta— en qué módulo exacto. */
export interface VivoDeUsuario { online: boolean; app: string; mins: number | null; mod: string | null }

const ACTIVO_MS = 60 * 60 * 1000;
/** Los módulos que el «en vivo» sabe nombrar. `appForPath` también da clockin/security/hub: el primero cuenta como
 *  Time Tracker, los otros no son un módulo y se quedan sin módulo (cae al cliente en la vista). */
const MODULOS = new Set(["deliveries", "estimator", "leads", "customers", "promos", "warehouse_ops", "recruiting", "timetracker", "surveys", "erp"]);

/** La etiqueta del cliente (no la versión): «App RTG Hub» / «Time Tracker» / «Navegador». */
function etiquetaCliente(ua: string | null | undefined, kind: string | null | undefined): string {
  const v = versionDeApp(ua ?? null);
  if (v.app === "desktop") return "App RTG Hub";
  if (v.app === "android") return "Time Tracker";
  return kind === "phone" ? "Phone browser" : "Browser";
}

export interface UsoCrudoVivo { user_id: string; device_id: string; last_seen_at: string; last_route?: string | null }
export interface DispCrudoVivo { id: string; user_agent: string | null; kind: string | null }

/** Arma el mapa usuario → «en vivo» a partir de las filas crudas (device_users + devices). Puro y con pruebas. */
export function construyeVivo(usos: readonly UsoCrudoVivo[], devices: readonly DispCrudoVivo[], ahora = Date.now()): Record<string, VivoDeUsuario> {
  const porId = new Map(devices.map((d) => [d.id, d]));
  const ultimoPorUsuario = new Map<string, UsoCrudoVivo>();
  for (const u of usos) {
    const prev = ultimoPorUsuario.get(u.user_id);
    if (!prev || Date.parse(u.last_seen_at) > Date.parse(prev.last_seen_at)) ultimoPorUsuario.set(u.user_id, u);
  }
  const m: Record<string, VivoDeUsuario> = {};
  for (const [userId, u] of ultimoPorUsuario) {
    const mins = Math.round((ahora - Date.parse(u.last_seen_at)) / 60000);
    const online = mins * 60000 < ACTIVO_MS;
    const dev = porId.get(u.device_id);
    const crudo = online && u.last_route ? appForPath(u.last_route) : null;
    const mod = crudo === "clockin" ? "timetracker" : (crudo && MODULOS.has(crudo) ? crudo : null);
    m[userId] = { online, app: etiquetaCliente(dev?.user_agent, dev?.kind), mins, mod };
  }
  return m;
}
