import type { SupabaseClient } from "@supabase/supabase-js";
import type { CamionDeUnDia, CamionHabitual } from "./camion-del-dia";

// ============================================================
// Lo que la ruta `/api/tracksolid/assignments` lee de la base para saber qué camión lleva cada chofer un día
// (D-NEXT). Solo servidor, con la llave de servicio: ni `tracksolid_devices` (257) ni `truck_day_assignments`
// (261) tienen políticas.
// ============================================================

export type EnlaceConNombre = CamionHabitual & { device_name: string | null };

/** Postgres «la tabla no existe» y PostgREST «no la conozco»: la base todavía no tiene la 261. */
const SIN_TABLA = new Set(["42P01", "PGRST205", "PGRST204"]);

export type LecturaDelDia = {
  habituales: EnlaceConNombre[];
  delDia: CamionDeUnDia[];
  /** `false`: la base aún no tiene la 261. Los camiones habituales siguen valiendo; lo de cada día no se ofrece. */
  hayTablaDelDia: boolean;
};

/** Los enlaces habituales y las excepciones de ese día. Un fallo de lectura que NO sea «falta la tabla» se lanza. */
export async function leeCamionesDelDia(db: SupabaseClient, fecha: string): Promise<LecturaDelDia> {
  const [enlaces, dia] = await Promise.all([
    db.from("tracksolid_devices").select("imei, driver_id, device_name"),
    db.from("truck_day_assignments").select("driver_id, imei").eq("day", fecha),
  ]);
  if (enlaces.error) throw new Error("tracksolid_devices");
  const habituales = (enlaces.data ?? []) as EnlaceConNombre[];
  if (dia.error) {
    if (SIN_TABLA.has(String(dia.error.code ?? ""))) return { habituales, delDia: [], hayTablaDelDia: false };
    throw new Error("truck_day_assignments");
  }
  return { habituales, delDia: (dia.data ?? []) as CamionDeUnDia[], hayTablaDelDia: true };
}

/** Los choferes (perfiles con rol de chofer), por id. */
export async function leeChoferes(db: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await db.from("profiles").select("id, full_name").eq("role", "driver");
  if (error) throw new Error("profiles");
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
}

/** Quién tiene el turno abierto ahora. Si no se puede leer, nadie: sin turno no se enseña el camión de nadie. */
export async function leeChoferesEnTurno(db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db.from("driver_shifts").select("driver_id").is("ended_at", null);
  if (error) return new Set();
  return new Set(((data ?? []) as { driver_id: string }[]).map((s) => s.driver_id));
}
