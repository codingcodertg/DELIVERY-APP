/**
 * Operaciones de almacén (migración 273): MANTENIMIENTO. Fase 1 de los KPI de almacén (el dueño y Roberto, 2026-11-08).
 *
 *   - El inventario de equipo de cada tienda (`warehouse_equipment`): montacargas, patines, patines eléctricos, otro.
 *   - La lista diaria por equipo (`warehouse_checklists`): la plantilla por clase vive AQUÍ (PLANTILLAS); cada punto se
 *     marca ok / fail / na, y un fallo exige nota. Un fallo pone el equipo en «necesita reparación».
 *   - Refacciones y herramientas (`warehouse_parts`): el personal marca «se necesita»; el gerente la pasa a pedida /
 *     recibida / ok.
 *   - La bitácora de uso (`warehouse_equipment_usage`): «empiezo» / «termino»; un solo uso abierto por equipo.
 *
 * Quién hace qué (la MISMA regla que `public.warehouse_ops_in_store` y `public.warehouse_ops_can_manage` de la base;
 * la base manda, esto decide qué botones pintar):
 *   - `puedeOperar(q, tienda)`: tiene nivel en la app (cualquiera, también `scrap_only`) y la tienda es suya (o es
 *     admin). Ve todo lo de la tienda, llena la lista diaria, abre / cierra su uso, pide refacciones.
 *   - `puedeGestionar(q, tienda)`: gerente / supervisor `full` de la tienda, `store_admin` en las suyas, `admin`. Da de
 *     alta y edita el equipo, mueve las refacciones, cierra el uso de otro, ve el KPI.
 *
 * Sin React: lo usan la pantalla, las pruebas y podría usarlo una ruta del servidor.
 */
import { nivelDe } from "./nivel";
import { esSupervisor, type Quien } from "./visibilidad";
import { PREFIJO_DE_EQUIPO, esEquipoDelInventario, type Opcion } from "./pasos";

export type Lang = "en" | "es";

// ---------------------------------------------------------------------------
// Equipo
// ---------------------------------------------------------------------------
export const CLASES_DE_EQUIPO = ["forklift", "pallet_jack", "electric_jack", "other"] as const;
export type ClaseDeEquipo = (typeof CLASES_DE_EQUIPO)[number];
export function esClaseDeEquipo(x: unknown): x is ClaseDeEquipo {
  return typeof x === "string" && (CLASES_DE_EQUIPO as readonly string[]).includes(x);
}
export const INFO_DE_CLASE: Record<ClaseDeEquipo, { emoji: string; en: string; es: string }> = {
  forklift: { emoji: "🚜", en: "Forklift", es: "Montacargas" },
  pallet_jack: { emoji: "🛒", en: "Pallet jack", es: "Patín" },
  electric_jack: { emoji: "🔋", en: "Electric pallet jack", es: "Patín eléctrico" },
  other: { emoji: "🧰", en: "Other", es: "Otro" },
};

export const ESTADOS_DE_EQUIPO = ["in_service", "needs_repair", "out_of_service"] as const;
export type EstadoDeEquipo = (typeof ESTADOS_DE_EQUIPO)[number];
export function esEstadoDeEquipo(x: unknown): x is EstadoDeEquipo {
  return typeof x === "string" && (ESTADOS_DE_EQUIPO as readonly string[]).includes(x);
}
export const INFO_DE_ESTADO: Record<EstadoDeEquipo, { en: string; es: string; color: string }> = {
  in_service: { en: "In service", es: "En servicio", color: "var(--green)" },
  needs_repair: { en: "Needs repair", es: "Necesita reparación", color: "var(--amber)" },
  out_of_service: { en: "Out of service", es: "Fuera de servicio", color: "var(--red)" },
};

export interface Equipo {
  id: string;
  store: string;
  kind: ClaseDeEquipo;
  name: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  year: number | null;
  status: EstadoDeEquipo;
  hour_meter: number | null;
  notes: string | null;
  photos: string[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

/** Lo que se manda a `warehouse_ops_save_equipment` (sin id = alta). */
export interface EquipoEditable {
  id?: string | null;
  store: string;
  kind: ClaseDeEquipo;
  name: string;
  brand: string;
  model: string;
  serial: string;
  year: string;
  status: EstadoDeEquipo;
  hour_meter: string;
  notes: string;
  photos: string[];
  active: boolean;
}

export function equipoEnBlanco(tienda: string): EquipoEditable {
  return { store: tienda, kind: "forklift", name: "", brand: "", model: "", serial: "", year: "", status: "in_service", hour_meter: "", notes: "", photos: [], active: true };
}

export function equipoParaEditar(e: Equipo): EquipoEditable {
  return {
    id: e.id, store: e.store, kind: e.kind, name: e.name, brand: e.brand ?? "", model: e.model ?? "", serial: e.serial ?? "",
    year: e.year == null ? "" : String(e.year), status: e.status, hour_meter: e.hour_meter == null ? "" : String(e.hour_meter),
    notes: e.notes ?? "", photos: [...e.photos], active: e.active,
  };
}

/** Un número escrito a mano: vacío = null; NaN si no es un número ≥ 0. */
export function numeroDelCampo(s: string, decimales = 1): number | null {
  const t = s.trim();
  if (t === "") return null;
  const re = decimales > 0 ? new RegExp(`^\\d+(\\.\\d{1,${decimales}})?$`) : /^\d+$/;
  return re.test(t) ? Number(t) : NaN;
}

/** ¿Se puede guardar el equipo? Devuelve el motivo si no. */
export function validarEquipo(e: EquipoEditable): { ok: true } | { ok: false; motivo: "nombre" | "tienda" | "anio" | "horometro" } {
  if (!e.store.trim()) return { ok: false, motivo: "tienda" };
  if (e.name.trim().length < 2) return { ok: false, motivo: "nombre" };
  const anio = numeroDelCampo(e.year, 0);
  if (anio !== null && (Number.isNaN(anio) || anio < 1950 || anio > 2100)) return { ok: false, motivo: "anio" };
  const h = numeroDelCampo(e.hour_meter, 1);
  if (h !== null && Number.isNaN(h)) return { ok: false, motivo: "horometro" };
  return { ok: true };
}

export function motivoDeEquipo(m: "nombre" | "tienda" | "anio" | "horometro", lang: Lang): string {
  switch (m) {
    case "tienda": return lang === "es" ? "Elige la tienda." : "Pick the store.";
    case "nombre": return lang === "es" ? "Ponle un nombre al equipo (p. ej. «Montacargas #1»)." : "Give the equipment a name (e.g. “Forklift #1”).";
    case "anio": return lang === "es" ? "El año no es válido." : "The year is not valid.";
    case "horometro": return lang === "es" ? "El horómetro debe ser un número (hasta 1 decimal)." : "The hour meter must be a number (up to 1 decimal).";
  }
}

/** El orden de la lista: primero lo que necesita atención, luego por nombre. Lo dado de baja al final. */
export function ordenarEquipo<T extends Pick<Equipo, "status" | "name" | "active">>(equipos: readonly T[]): T[] {
  const peso: Record<EstadoDeEquipo, number> = { needs_repair: 0, out_of_service: 1, in_service: 2 };
  return [...equipos].sort((a, b) => (Number(!a.active) - Number(!b.active)) || (peso[a.status] - peso[b.status]) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// La lista diaria
// ---------------------------------------------------------------------------
export const RESULTADOS = ["ok", "fail", "na"] as const;
export type Resultado = (typeof RESULTADOS)[number];
export function esResultado(x: unknown): x is Resultado {
  return typeof x === "string" && (RESULTADOS as readonly string[]).includes(x);
}
export const INFO_DE_RESULTADO: Record<Resultado, { en: string; es: string }> = {
  ok: { en: "OK", es: "Bien" },
  fail: { en: "Fail", es: "Falla" },
  na: { en: "N/A", es: "N/A" },
};

export interface PuntoDePlantilla { id: string; en: string; es: string }

const p = (id: string, en: string, es: string): PuntoDePlantilla => ({ id, en, es });
const MONTACARGAS: PuntoDePlantilla[] = [
  p("tires", "Tires", "Llantas"),
  p("forks_chains", "Forks / chains", "Horquillas / cadenas"),
  p("mast_hydraulics", "Mast / hydraulics (leaks)", "Mástil / hidráulico (fugas)"),
  p("brakes", "Brakes", "Frenos"),
  p("horn_lights_alarm", "Horn / lights / backup alarm", "Claxon / luces / alarma de reversa"),
  p("seat_belt", "Seat belt", "Cinturón de seguridad"),
  p("battery_fuel", "Battery / fuel / propane", "Batería / combustible / propano"),
  p("fluids", "Fluid levels", "Niveles de fluidos"),
  p("overhead_guard", "Overhead guard", "Protector superior"),
  p("fire_extinguisher", "Fire extinguisher", "Extintor"),
  p("damage_cleanliness", "Damage / cleanliness", "Daños / limpieza"),
];
const PATIN: PuntoDePlantilla[] = [
  p("wheels", "Wheels", "Ruedas"),
  p("forks", "Forks", "Horquillas"),
  p("pump_leaks", "Hydraulic pump / leaks", "Bomba hidráulica / fugas"),
  p("handle_controls", "Handle / controls", "Mango / controles"),
];
const PATIN_ELECTRICO: PuntoDePlantilla[] = [
  ...PATIN,
  p("battery_charge", "Battery / charge", "Batería / carga"),
  p("horn_alarm", "Horn / alarm", "Claxon / alarma"),
  p("brakes", "Brakes", "Frenos"),
];
const OTRO: PuntoDePlantilla[] = [
  p("general_condition", "General condition", "Estado general"),
  p("safety_devices", "Safety devices", "Dispositivos de seguridad"),
  p("damage_cleanliness", "Damage / cleanliness", "Daños / limpieza"),
];

/** La plantilla de la lista diaria por clase de equipo. Los ids se guardan en `items[].id` y en `failed_items`. */
export const PLANTILLAS: Record<ClaseDeEquipo, readonly PuntoDePlantilla[]> = {
  forklift: MONTACARGAS,
  pallet_jack: PATIN,
  electric_jack: PATIN_ELECTRICO,
  other: OTRO,
};

export function plantillaDe(kind: ClaseDeEquipo): readonly PuntoDePlantilla[] {
  return PLANTILLAS[kind];
}

export function nombreDePunto(kind: ClaseDeEquipo, id: string, lang: Lang): string {
  const x = PLANTILLAS[kind].find((q) => q.id === id);
  return x ? x[lang] : id;
}

/** Un punto contestado: lo que va en `items` (jsonb). */
export interface PuntoContestado { id: string; result: Resultado; note?: string }

export type Contestaciones = Record<string, { result?: Resultado; note?: string }>;

/** ¿Está completa la lista? Todos los puntos contestados y cada fallo con nota. Devuelve los ids que faltan. */
export function huecosDeLaLista(kind: ClaseDeEquipo, c: Contestaciones): { sinContestar: string[]; sinNota: string[] } {
  const sinContestar: string[] = [];
  const sinNota: string[] = [];
  for (const q of PLANTILLAS[kind]) {
    const r = c[q.id];
    if (!r || !esResultado(r.result)) sinContestar.push(q.id);
    else if (r.result === "fail" && !(r.note ?? "").trim()) sinNota.push(q.id);
  }
  return { sinContestar, sinNota };
}

export function listaCompleta(kind: ClaseDeEquipo, c: Contestaciones): boolean {
  const h = huecosDeLaLista(kind, c);
  return h.sinContestar.length === 0 && h.sinNota.length === 0;
}

/** Lo que viaja a `warehouse_ops_file_checklist` como `p_items`: en el orden de la plantilla, notas recortadas. */
export function puntosParaEnviar(kind: ClaseDeEquipo, c: Contestaciones): PuntoContestado[] {
  return PLANTILLAS[kind].map((q) => {
    const r = c[q.id];
    const result: Resultado = r && esResultado(r.result) ? r.result : "na";
    const note = (r?.note ?? "").trim();
    return note ? { id: q.id, result, note } : { id: q.id, result };
  });
}

export function puntosFallidos(items: readonly PuntoContestado[]): string[] {
  return items.filter((x) => x.result === "fail").map((x) => x.id);
}

export function resultadoDeLaLista(items: readonly PuntoContestado[]): "ok" | "fail" {
  return puntosFallidos(items).length > 0 ? "fail" : "ok";
}

/** Cómo queda el equipo tras una lista (la misma regla que la RPC): un fallo lo pone en «necesita reparación» si estaba en servicio. */
export function estadoTrasLaLista(estado: EstadoDeEquipo, resultado: "ok" | "fail"): EstadoDeEquipo {
  return resultado === "fail" && estado === "in_service" ? "needs_repair" : estado;
}

export interface Lista {
  id: string;
  equipment_id: string;
  store: string;
  done_by: string;
  done_by_name: string | null;
  done_at: string;
  shift_date: string;
  items: PuntoContestado[];
  result: "ok" | "fail";
  failed_items: string[];
  hour_meter: number | null;
  photos: string[];
}

/** Los `items` tal como vienen de la base (jsonb), filtrados a lo que entendemos. */
export function puntosDeLaFila(v: unknown): PuntoContestado[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || !esResultado(o.result)) return [];
    return [typeof o.note === "string" && o.note ? { id: o.id, result: o.result, note: o.note } : { id: o.id, result: o.result }];
  });
}

/** ¿Ya hay una lista de este equipo para este día? (para decir «hecha hoy» en la tarjeta). */
export function listaDelDia(listas: readonly Pick<Lista, "equipment_id" | "shift_date">[], equipoId: string, dia: string): boolean {
  return listas.some((l) => l.equipment_id === equipoId && l.shift_date === dia);
}

// ---------------------------------------------------------------------------
// Refacciones y herramientas
// ---------------------------------------------------------------------------
export const CLASES_DE_PIEZA = ["part", "tool", "consumable"] as const;
export type ClaseDePieza = (typeof CLASES_DE_PIEZA)[number];
export function esClaseDePieza(x: unknown): x is ClaseDePieza {
  return typeof x === "string" && (CLASES_DE_PIEZA as readonly string[]).includes(x);
}
export const INFO_DE_CLASE_DE_PIEZA: Record<ClaseDePieza, { en: string; es: string }> = {
  part: { en: "Spare part", es: "Refacción" },
  tool: { en: "Tool", es: "Herramienta" },
  consumable: { en: "Consumable", es: "Consumible" },
};

export const ESTADOS_DE_PIEZA = ["ok", "needed", "ordered", "received"] as const;
export type EstadoDePieza = (typeof ESTADOS_DE_PIEZA)[number];
export function esEstadoDePieza(x: unknown): x is EstadoDePieza {
  return typeof x === "string" && (ESTADOS_DE_PIEZA as readonly string[]).includes(x);
}
export const INFO_DE_ESTADO_DE_PIEZA: Record<EstadoDePieza, { en: string; es: string; color: string }> = {
  ok: { en: "OK", es: "Bien", color: "var(--green)" },
  needed: { en: "Needed", es: "Se necesita", color: "var(--red)" },
  ordered: { en: "Ordered", es: "Pedida", color: "var(--amber)" },
  received: { en: "Received", es: "Recibida", color: "var(--blue)" },
};

export interface Pieza {
  id: string;
  store: string;
  equipment_id: string | null;
  name: string;
  kind: ClaseDePieza;
  qty_on_hand: number;
  min_qty: number;
  status: EstadoDePieza;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: string | null;
  notes: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

/**
 * A qué estados puede pasar una refacción quien mira. El personal solo la marca «se necesita». El gestor la mueve por
 * el camino needed → ordered → received → ok, y puede volver a «se necesita» desde cualquiera (p. ej. llegó mal).
 * La misma regla que `warehouse_ops_request_part` (personal) y `warehouse_ops_save_part` (gestor) de la 273.
 */
export function transicionesDePieza(actual: EstadoDePieza, gestiona: boolean): EstadoDePieza[] {
  if (!gestiona) return actual === "needed" ? [] : ["needed"];
  switch (actual) {
    case "ok": return ["needed"];
    case "needed": return ["ordered", "ok"];
    case "ordered": return ["received", "needed"];
    case "received": return ["ok", "needed"];
  }
}

/** ¿Está por debajo del mínimo? (para la insignia de la lista). */
export function bajoMinimo(x: Pick<Pieza, "qty_on_hand" | "min_qty">): boolean {
  return x.min_qty > 0 && x.qty_on_hand < x.min_qty;
}

/** El filtro de la lista de refacciones: todas, o un estado; «atención» = needed + ordered + bajo mínimo. */
export type FiltroDePieza = "todas" | "atencion" | EstadoDePieza;
export function filtrarPiezas<T extends Pick<Pieza, "status" | "qty_on_hand" | "min_qty">>(piezas: readonly T[], f: FiltroDePieza): T[] {
  if (f === "todas") return [...piezas];
  if (f === "atencion") return piezas.filter((x) => x.status === "needed" || x.status === "ordered" || bajoMinimo(x));
  return piezas.filter((x) => x.status === f);
}

/** El orden: lo que se necesita primero, luego pedidas, recibidas, ok; dentro, por nombre. */
export function ordenarPiezas<T extends Pick<Pieza, "status" | "name">>(piezas: readonly T[]): T[] {
  const peso: Record<EstadoDePieza, number> = { needed: 0, ordered: 1, received: 2, ok: 3 };
  return [...piezas].sort((a, b) => (peso[a.status] - peso[b.status]) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// La bitácora de uso
// ---------------------------------------------------------------------------
export interface Uso {
  id: string;
  equipment_id: string;
  user_id: string;
  user_name: string | null;
  started_at: string;
  ended_at: string | null;
  hour_meter_start: number | null;
  hour_meter_end: number | null;
  notes: string | null;
}

/** El uso abierto de un equipo (si alguien lo tiene ahora). */
export function usoAbierto(usos: readonly Uso[], equipoId: string): Uso | null {
  return usos.find((u) => u.equipment_id === equipoId && u.ended_at === null) ?? null;
}

/** ¿Puede este usuario empezar a usar el equipo? (nadie lo tiene, está en servicio o con reparación pendiente, y activo). */
export function puedeEmpezarUso(e: Pick<Equipo, "status" | "active">, abierto: Uso | null): boolean {
  return e.active && e.status !== "out_of_service" && abierto === null;
}

/** ¿Puede cerrar este uso? El que lo abrió, o un gestor de la tienda. */
export function puedeCerrarUso(u: Uso, yo: string, gestiona: boolean): boolean {
  return u.ended_at === null && (u.user_id === yo || gestiona);
}

/** Duración legible de un uso (minutos / horas). */
export function duracionDeUso(u: Pick<Uso, "started_at" | "ended_at">, lang: Lang, ahora: Date = new Date()): string {
  const a = new Date(u.started_at).getTime();
  const b = u.ended_at ? new Date(u.ended_at).getTime() : ahora.getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return "";
  const min = Math.max(0, Math.round((b - a) / 60_000));
  if (min < 60) return lang === "es" ? `${min} min` : `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------------------------------------------------------------------------
// Permisos (la misma regla que la base)
// ---------------------------------------------------------------------------
function esDeSuTienda(q: Quien, tienda: string): boolean {
  return q.store === tienda || (q.visible_stores ?? []).includes(tienda);
}

/** Tiene nivel en la app y la tienda es suya (o es admin): ve, llena la lista, usa el equipo, pide refacciones. */
export function puedeOperar(q: Quien, tienda: string): boolean {
  const n = nivelDe(q);
  if (n === null) return false;
  if (n === "admin") return true;
  return esDeSuTienda(q, tienda);
}

/** Gestiona el equipo y las refacciones de la tienda: la misma regla que `public.warehouse_ops_can_manage`. */
export function puedeGestionar(q: Quien, tienda: string): boolean {
  const n = nivelDe(q);
  if (n === "admin") return true;
  if (n === "store_admin") return esDeSuTienda(q, tienda);
  return n === "full" && (q.role === "manager" || esSupervisor(q)) && esDeSuTienda(q, tienda);
}

/** ¿Se le ofrece la sección «Mantenimiento»? A cualquiera con nivel en la app. */
export function veMantenimiento(q: Quien): boolean {
  return nivelDe(q) !== null;
}

/** ¿Gestiona al menos una de estas tiendas? (para enseñar el KPI y los botones de alta). */
export function gestionaAlguna(q: Quien, tiendas: readonly string[]): boolean {
  return tiendas.some((s) => puedeGestionar(q, s));
}

// ---------------------------------------------------------------------------
// El reporte de mantenimiento (kind = 'maintenance') elige el equipo de la tienda cuando lo hay
// ---------------------------------------------------------------------------
export { PREFIJO_DE_EQUIPO, esEquipoDelInventario };

/** Las opciones del paso «¿Qué equipo?» con el inventario de la tienda (activo); «Otro» siempre al final. */
export function opcionesDeEquipo(equipos: readonly Pick<Equipo, "id" | "name" | "store" | "active">[], tienda: string): Opcion[] | null {
  const mios = equipos.filter((e) => e.store === tienda && e.active).sort((a, b) => a.name.localeCompare(b.name));
  if (mios.length === 0) return null;
  return [...mios.map((e) => ({ v: PREFIJO_DE_EQUIPO + e.id, en: e.name, es: e.name })), { v: "other", en: "Other", es: "Otro" }];
}

export function idDeEquipoElegido(v: unknown): string | null {
  return esEquipoDelInventario(v) ? v.slice(PREFIJO_DE_EQUIPO.length) : null;
}

/** La clave dentro de `answers` con el nombre del equipo elegido (para que las listas lo enseñen sin consultar). */
export const CLAVE_NOMBRE_DE_EQUIPO = "equipment_name";

/**
 * El texto del equipo de un reporte de mantenimiento: el nombre guardado si vino del inventario; si no, la etiqueta de
 * la opción fija (la da quien llama con `etiquetaFija`).
 */
export function etiquetaDeEquipoDelReporte(answers: Record<string, unknown>, etiquetaFija: string): string {
  if (esEquipoDelInventario(answers.equipment)) {
    const n = answers[CLAVE_NOMBRE_DE_EQUIPO];
    return typeof n === "string" && n ? n : "—";
  }
  return etiquetaFija;
}
