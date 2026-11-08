/**
 * Operaciones de almacén (273): lo que la sección «Mantenimiento» lee y escribe, y el demo. Todo con la sesión de quien
 * mira: la RLS de la 273 decide qué filas vuelven; las escrituras van por RPC (security definer con las puertas).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  numeroDelCampo, puntosDeLaFila, type Equipo, type EquipoEditable, type Lista, type Pieza, type PuntoContestado, type Uso,
} from "./mantenimiento";

/** ¿Falta aplicar la 273? (tabla o función que la API no conoce). */
export function faltaLa273(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42883"
    || (/warehouse_equipment|warehouse_checklists|warehouse_parts|warehouse_ops_(save_equipment|file_checklist|request_part|save_part|start_usage|stop_usage|in_store)/.test(e.message ?? "")
        && /does not exist|schema cache|not find/i.test(e.message ?? ""));
}

export interface Mantenimiento {
  equipos: Equipo[];
  listas: Lista[];
  piezas: Pieza[];
  usos: Uso[];
}

const DIAS_DE_LISTAS = 60;

/** Lee todo lo de mantenimiento que quien mira puede ver: el equipo, las listas de los últimos 60 días, las refacciones y los usos abiertos / recientes. */
export async function leerMantenimiento(sb: SupabaseClient): Promise<Mantenimiento> {
  const desde = new Date(Date.now() - DIAS_DE_LISTAS * 86_400_000).toISOString().slice(0, 10);
  const [eq, li, pi, us] = await Promise.all([
    sb.from("warehouse_equipment").select("*").order("name"),
    sb.from("warehouse_checklists").select("*").gte("shift_date", desde).order("done_at", { ascending: false }),
    sb.from("warehouse_parts").select("*").order("name"),
    sb.from("warehouse_equipment_usage").select("*").order("started_at", { ascending: false }).limit(300),
  ]);
  const error = eq.error ?? li.error ?? pi.error ?? us.error;
  if (error) throw error;
  return {
    equipos: ((eq.data ?? []) as Record<string, unknown>[]).map(equipoDeLaFila),
    listas: ((li.data ?? []) as Record<string, unknown>[]).map(listaDeLaFila),
    piezas: ((pi.data ?? []) as Record<string, unknown>[]).map(piezaDeLaFila),
    usos: ((us.data ?? []) as Record<string, unknown>[]).map(usoDeLaFila),
  };
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []);

export function equipoDeLaFila(x: Record<string, unknown>): Equipo {
  return { ...(x as unknown as Equipo), hour_meter: num(x.hour_meter), year: num(x.year), photos: arr(x.photos) };
}
export function listaDeLaFila(x: Record<string, unknown>): Lista {
  return { ...(x as unknown as Lista), items: puntosDeLaFila(x.items), failed_items: arr(x.failed_items), photos: arr(x.photos), hour_meter: num(x.hour_meter) };
}
export function piezaDeLaFila(x: Record<string, unknown>): Pieza {
  return { ...(x as unknown as Pieza), qty_on_hand: num(x.qty_on_hand) ?? 0, min_qty: num(x.min_qty) ?? 0 };
}
export function usoDeLaFila(x: Record<string, unknown>): Uso {
  return { ...(x as unknown as Uso), hour_meter_start: num(x.hour_meter_start), hour_meter_end: num(x.hour_meter_end) };
}

/** Alta o edición de un equipo (gestor). Devuelve el id. */
export async function guardarEquipo(sb: SupabaseClient, e: EquipoEditable): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_save_equipment", {
    p_id: e.id ?? null, p_store: e.store, p_kind: e.kind, p_name: e.name.trim(), p_brand: e.brand, p_model: e.model, p_serial: e.serial,
    p_year: numeroDelCampo(e.year, 0), p_status: e.status, p_hour_meter: numeroDelCampo(e.hour_meter, 1), p_notes: e.notes, p_photos: e.photos, p_active: e.active,
  });
  if (error) throw error;
  return data as string;
}

/** La lista diaria (personal). Devuelve el id. */
export async function enviarLista(sb: SupabaseClient, x: { equipoId: string; dia: string; items: PuntoContestado[]; horometro: number | null; fotos: string[] }): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_file_checklist", {
    p_equipment: x.equipoId, p_shift_date: x.dia, p_items: x.items, p_hour_meter: x.horometro, p_photos: x.fotos,
  });
  if (error) throw error;
  return data as string;
}

/** El personal pide una refacción: nueva (sin id) o una existente pasa a «se necesita». */
export async function pedirPieza(sb: SupabaseClient, x: { id?: string | null; tienda: string; equipoId: string | null; nombre: string; clase: string; nota: string }): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_request_part", {
    p_id: x.id ?? null, p_store: x.tienda, p_equipment: x.equipoId, p_name: x.nombre.trim(), p_kind: x.clase, p_note: x.nota,
  });
  if (error) throw error;
  return data as string;
}

/** El gestor da de alta / edita / cambia de estado una refacción. */
export async function guardarPieza(sb: SupabaseClient, x: { id?: string | null; tienda: string; equipoId: string | null; nombre: string; clase: string; existencia: number | null; minimo: number | null; estado: string; notas: string }): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_save_part", {
    p_id: x.id ?? null, p_store: x.tienda, p_equipment: x.equipoId, p_name: x.nombre.trim(), p_kind: x.clase,
    p_qty_on_hand: x.existencia, p_min_qty: x.minimo, p_status: x.estado, p_notes: x.notas,
  });
  if (error) throw error;
  return data as string;
}

export async function empezarUso(sb: SupabaseClient, equipoId: string, horometro: number | null): Promise<string> {
  const { data, error } = await sb.rpc("warehouse_ops_start_usage", { p_equipment: equipoId, p_hour_meter: horometro });
  if (error) throw error;
  return data as string;
}

export async function terminarUso(sb: SupabaseClient, usoId: string, horometro: number | null, notas: string): Promise<void> {
  const { error } = await sb.rpc("warehouse_ops_stop_usage", { p_usage: usoId, p_hour_meter: horometro, p_notes: notas });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Demo (NEXT_PUBLIC_LOCAL_MODE): nada sale de la pantalla.
// ---------------------------------------------------------------------------
const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const dia = (n: number) => dias(n).slice(0, 10);
export const DEMO_MANTENIMIENTO: Mantenimiento = {
  equipos: [
    { id: "e1", store: "McAllen", kind: "forklift", name: "Forklift #1", brand: "Toyota", model: "8FGU25", serial: "TY-88213", year: 2019, status: "in_service", hour_meter: 4312.5, notes: null, photos: [], active: true, created_by: "demo-admin", created_at: dias(40), updated_by: "demo-admin", updated_at: dias(2) },
    { id: "e2", store: "McAllen", kind: "forklift", name: "Forklift #2", brand: "Hyster", model: "H50FT", serial: "HY-10422", year: 2016, status: "needs_repair", hour_meter: 7810, notes: "Hydraulic leak under the mast", photos: [], active: true, created_by: "demo-admin", created_at: dias(40), updated_by: "p1", updated_at: dias(1) },
    { id: "e3", store: "McAllen", kind: "pallet_jack", name: "Pallet jack A", brand: null, model: null, serial: null, year: null, status: "in_service", hour_meter: null, notes: null, photos: [], active: true, created_by: "demo-admin", created_at: dias(40), updated_by: null, updated_at: dias(40) },
    { id: "e4", store: "Edinburg", kind: "electric_jack", name: "Electric jack 1", brand: "Crown", model: "PE 4500", serial: "CR-5501", year: 2021, status: "out_of_service", hour_meter: 1200, notes: "Battery does not hold charge", photos: [], active: true, created_by: "demo-admin", created_at: dias(30), updated_by: null, updated_at: dias(3) },
  ],
  listas: [
    { id: "l1", equipment_id: "e1", store: "McAllen", done_by: "p1", done_by_name: "Ana García", done_at: dias(0.2), shift_date: dia(0), items: [{ id: "tires", result: "ok" }, { id: "forks_chains", result: "ok" }, { id: "mast_hydraulics", result: "ok" }, { id: "brakes", result: "ok" }, { id: "horn_lights_alarm", result: "ok" }, { id: "seat_belt", result: "ok" }, { id: "battery_fuel", result: "ok" }, { id: "fluids", result: "ok" }, { id: "overhead_guard", result: "ok" }, { id: "fire_extinguisher", result: "na" }, { id: "damage_cleanliness", result: "ok" }], result: "ok", failed_items: [], hour_meter: 4312.5, photos: [] },
    { id: "l2", equipment_id: "e2", store: "McAllen", done_by: "p1", done_by_name: "Ana García", done_at: dias(1), shift_date: dia(1), items: [{ id: "tires", result: "ok" }, { id: "forks_chains", result: "ok" }, { id: "mast_hydraulics", result: "fail", note: "Oil under the mast" }, { id: "brakes", result: "ok" }, { id: "horn_lights_alarm", result: "ok" }, { id: "seat_belt", result: "ok" }, { id: "battery_fuel", result: "ok" }, { id: "fluids", result: "fail", note: "Hydraulic fluid low" }, { id: "overhead_guard", result: "ok" }, { id: "fire_extinguisher", result: "ok" }, { id: "damage_cleanliness", result: "ok" }], result: "fail", failed_items: ["mast_hydraulics", "fluids"], hour_meter: 7810, photos: [] },
    { id: "l3", equipment_id: "e1", store: "McAllen", done_by: "p2", done_by_name: "Luis Treviño", done_at: dias(1), shift_date: dia(1), items: [], result: "ok", failed_items: [], hour_meter: 4306, photos: [] },
  ],
  piezas: [
    { id: "pz1", store: "McAllen", equipment_id: "e2", name: "Hydraulic hose (mast)", kind: "part", qty_on_hand: 0, min_qty: 1, status: "needed", requested_by: "p1", requested_by_name: "Ana García", requested_at: dias(1), notes: "Leak found on daily check", created_at: dias(1), updated_by: "p1", updated_at: dias(1) },
    { id: "pz2", store: "McAllen", equipment_id: null, name: "Propane tank 33 lb", kind: "consumable", qty_on_hand: 2, min_qty: 3, status: "ordered", requested_by: "p2", requested_by_name: "Luis Treviño", requested_at: dias(4), notes: null, created_at: dias(10), updated_by: "demo-admin", updated_at: dias(3) },
    { id: "pz3", store: "McAllen", equipment_id: null, name: "Torque wrench", kind: "tool", qty_on_hand: 1, min_qty: 1, status: "ok", requested_by: null, requested_by_name: null, requested_at: null, notes: null, created_at: dias(20), updated_by: null, updated_at: dias(20) },
  ],
  usos: [
    { id: "u1", equipment_id: "e1", user_id: "p1", user_name: "Ana García", started_at: dias(0.05), ended_at: null, hour_meter_start: 4312.5, hour_meter_end: null, notes: null },
    { id: "u2", equipment_id: "e1", user_id: "p2", user_name: "Luis Treviño", started_at: dias(1.2), ended_at: dias(1.0), hour_meter_start: 4301, hour_meter_end: 4306, notes: null },
  ],
};
