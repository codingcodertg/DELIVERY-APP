import type { SupabaseClient } from "@supabase/supabase-js";
import type { CamionDeTracksolid } from "./camiones";
import type { PosicionDeCamion } from "./posiciones";

// ============================================================
// Los enlaces rastreador → chofer / tienda base (`tracksolid_devices`, 257) — D-NEXT. Solo servidor.
//
// La tabla no tiene políticas: se lee y se escribe con la llave de servicio, detrás del permiso que
// comprueba cada ruta. El enlace guarda el `id` del chofer, no su nombre: si le cambian el nombre, el
// camión lo sigue. Un chofer borrado deja el enlace sin chofer (ON DELETE SET NULL), no lo rompe.
//
// Fase 2 (no construida): esta misma tabla es por donde el webhook de TrackSolid sabría de qué chofer es
// el punto que llega (el push trae solo el IMEI).
// ============================================================

export type EnlaceDeCamion = { imei: string; driver_id: string | null; home_store: string | null };

export const IMEI_VALIDO = /^\d{10,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que llega del formulario de Ajustes, validado. `error` en inglés: se le enseña tal cual al admin. */
export function enlaceValido(cuerpo: unknown): { ok: true; enlace: EnlaceDeCamion; nombre: string | null } | { ok: false; error: string } {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const imei = typeof c.imei === "string" ? c.imei.trim() : "";
  if (!IMEI_VALIDO.test(imei)) return { ok: false, error: "Invalid tracker IMEI." };
  const chofer = c.driver_id == null || c.driver_id === "" ? null : c.driver_id;
  if (chofer !== null && (typeof chofer !== "string" || !UUID.test(chofer))) return { ok: false, error: "Invalid driver." };
  const tienda = c.home_store == null || c.home_store === "" ? null : c.home_store;
  if (tienda !== null && (typeof tienda !== "string" || tienda.length > 120)) return { ok: false, error: "Invalid store." };
  const nombre = typeof c.device_name === "string" && c.device_name.trim() ? c.device_name.trim().slice(0, 120) : null;
  return { ok: true, enlace: { imei, driver_id: chofer as string | null, home_store: tienda ? (tienda as string).trim() : null }, nombre };
}

/** Las posiciones con su enlace resuelto. Un enlace que no se pudo leer no esconde el camión: sale sin chofer. */
export function conEnlaces(posiciones: PosicionDeCamion[], enlaces: EnlaceDeCamion[], nombreDeChofer: Map<string, string>): CamionDeTracksolid[] {
  const porImei = new Map(enlaces.map((e) => [e.imei, e]));
  return posiciones.map((p) => {
    const e = porImei.get(p.imei);
    const chofer = e?.driver_id ? nombreDeChofer.get(e.driver_id) ?? null : null;
    return { ...p, choferId: chofer ? e!.driver_id : null, chofer, tienda: e?.home_store ?? null };
  });
}

/** Lee los enlaces y los nombres de sus choferes. Si falla, sin enlaces (los camiones se ven igual). */
export async function leeEnlaces(db: SupabaseClient): Promise<{ enlaces: EnlaceDeCamion[]; nombres: Map<string, string> }> {
  const { data, error } = await db.from("tracksolid_devices").select("imei, driver_id, home_store");
  if (error || !data) return { enlaces: [], nombres: new Map() };
  const enlaces = data as EnlaceDeCamion[];
  const ids = [...new Set(enlaces.flatMap((e) => (e.driver_id ? [e.driver_id] : [])))];
  if (!ids.length) return { enlaces, nombres: new Map() };
  const { data: gente } = await db.from("profiles").select("id, full_name").in("id", ids);
  return { enlaces, nombres: new Map(((gente ?? []) as { id: string; full_name: string }[]).map((g) => [g.id, g.full_name])) };
}
