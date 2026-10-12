import { claveDeVehiculo, etiquetaDeVehiculo, type EstadoDeLectura, type Inspeccion, type InspeccionNueva, type Reparaciones } from "@/lib/inspeccion/reglas";

/**
 * Dónde viven las inspecciones pre-viaje (D-NEXT). Todo lo que lee o escribe una pasa por aquí; la pantalla no sabe
 * dónde están.
 *
 *   · **En la base**: `public.vehicle_inspections` (migración 165). El chofer inserta y lee las suyas; logística y el
 *     admin leen todas y marcan un defecto «corregido» con la función `marca_defecto_corregido` (la tabla no tiene
 *     UPDATE para nadie). Los vehículos salen de `vehiculos_para_inspeccion()`, que lee `clockin.vehicles` para
 *     cualquiera con el módulo de Entregas: un chofer sin ficha de fichaje no los ve por la RLS de Clock-in.
 *   · **Sin la 165** (se aplica después de fusionar): la lectura dice `sin_tabla`, la pantalla avisa «aún no se puede
 *     guardar» y el chofer puede ver la lista. No se guarda nada en otro sitio.
 *   · **En el demo** (y en el modo práctica): en este navegador (`localStorage`), con la misma forma de fila. El demo
 *     siembra dos inspecciones de otros choferes para que la lista de logística tenga algo que enseñar.
 */

export const TABLA_DE_INSPECCIONES = "vehicle_inspections";
export const FUNCION_DE_VEHICULOS = "vehiculos_para_inspeccion";
export const FUNCION_DE_CORREGIDO = "marca_defecto_corregido";

export interface ErrorDeLaBase { code?: string | null; message?: string | null }
type Respuesta<T> = PromiseLike<{ data: T | null; error: ErrorDeLaBase | null }>;

interface Consulta<T> extends Respuesta<T> {
  eq(col: string, v: string): Consulta<T>;
  order(col: string, opts: { ascending: boolean }): Consulta<T>;
}

/** Lo mínimo del cliente de Supabase que usa esto. */
export interface ClienteDeInspecciones {
  from(tabla: string): {
    select(columnas: string): Consulta<Inspeccion[]>;
    insert(fila: InspeccionNueva): { select(columnas: string): { single(): Respuesta<Inspeccion> } };
  };
  rpc(fn: string, args?: Record<string, unknown>): Respuesta<unknown>;
}

/** ¿La tabla no existe (la 165 sin aplicar)? PostgREST `PGRST205`; Postgres `42P01`. */
export function faltaLaTabla(e: ErrorDeLaBase | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  return String(e.message ?? "").includes(TABLA_DE_INSPECCIONES) && /could not find the table|does not exist/i.test(String(e.message ?? ""));
}

/** ¿La función no existe? PostgREST `PGRST202`; Postgres `42883`. */
export const faltaLaFuncion = (e: ErrorDeLaBase | null | undefined): boolean => !!e && (e.code === "PGRST202" || e.code === "42883");

export type Lectura = { estado: Exclude<EstadoDeLectura, "cargando">; filas: Inspeccion[]; detalle?: string };

const deLaBase = (f: Inspeccion): Inspeccion => ({
  ...f,
  inspection_date: String(f.inspection_date).slice(0, 10),
  odometer: f.odometer == null ? null : Number(f.odometer),
  answers: f.answers ?? {},
  repairs: f.repairs ?? {},
});

/** Las inspecciones de un día; con `choferId`, solo las de ese chofer (la RLS ya se lo limita, esto lo hace explícito). */
export async function leeInspecciones(cliente: ClienteDeInspecciones, fecha: string, choferId: string | null): Promise<Lectura> {
  try {
    let q = cliente.from(TABLA_DE_INSPECCIONES).select("*").eq("inspection_date", fecha);
    if (choferId) q = q.eq("driver_id", choferId);
    const { data, error } = await q.order("created_at", { ascending: true });
    if (error) return { estado: faltaLaTabla(error) ? "sin_tabla" : "error", filas: [], detalle: error.message ?? undefined };
    return { estado: "listo", filas: (data ?? []).map(deLaBase) };
  } catch (e) {
    return { estado: "error", filas: [], detalle: e instanceof Error ? e.message : String(e) };
  }
}

export type Guardado =
  | { ok: true; fila: Inspeccion }
  /** `repetida`: ya hay una de este chofer, hoy, con este vehículo (índice único). */
  | { ok: false; motivo: "sin_tabla" | "repetida" | "error"; detalle?: string };

export async function guardaInspeccion(cliente: ClienteDeInspecciones, fila: InspeccionNueva): Promise<Guardado> {
  try {
    const { data, error } = await cliente.from(TABLA_DE_INSPECCIONES).insert(fila).select("*").single();
    if (error) {
      if (error.code === "23505") return { ok: false, motivo: "repetida" };
      return { ok: false, motivo: faltaLaTabla(error) ? "sin_tabla" : "error", detalle: error.message ?? undefined };
    }
    if (!data) return { ok: false, motivo: "error", detalle: "sin fila" };
    return { ok: true, fila: deLaBase(data) };
  } catch (e) {
    return { ok: false, motivo: "error", detalle: e instanceof Error ? e.message : String(e) };
  }
}

export type Correccion = { ok: true; repairs: Reparaciones } | { ok: false; detalle: string };

/** Marca (o desmarca) un defecto como corregido. Quién y cuándo los pone la base. */
export async function marcaCorregido(cliente: ClienteDeInspecciones, id: string, punto: string, corregido: boolean, nota: string): Promise<Correccion> {
  try {
    const { data, error } = await cliente.rpc(FUNCION_DE_CORREGIDO, { p_inspeccion: id, p_punto: punto, p_corregido: corregido, p_nota: nota.trim() || null });
    if (error) return { ok: false, detalle: error.message ?? String(error.code ?? "error") };
    return { ok: true, repairs: (data ?? {}) as Reparaciones };
  } catch (e) {
    return { ok: false, detalle: e instanceof Error ? e.message : String(e) };
  }
}

export interface Vehiculo {
  id: string;
  name: string;
  plate: string | null;
  /** El que tiene asignado quien pregunta (`clockin.employee_settings.vehicle_id`). */
  assigned: boolean;
}

export type Vehiculos = { estado: "listo" | "sin_funcion" | "error"; vehiculos: Vehiculo[] };

export async function leeVehiculos(cliente: ClienteDeInspecciones): Promise<Vehiculos> {
  try {
    const { data, error } = await cliente.rpc(FUNCION_DE_VEHICULOS);
    if (error) return { estado: faltaLaFuncion(error) ? "sin_funcion" : "error", vehiculos: [] };
    return { estado: "listo", vehiculos: ((data ?? []) as Vehiculo[]).map((v) => ({ ...v, assigned: !!v.assigned })) };
  } catch {
    return { estado: "error", vehiculos: [] };
  }
}

/**
 * El vehículo que sale elegido al abrir: el asignado; si no hay, el primero (la misma regla de «Voy a salir», D-489).
 * Sin ninguno en la lista, nada: el chofer escribe el suyo.
 */
export function vehiculoPorDefecto(vehiculos: readonly Vehiculo[]): { id: string; etiqueta: string } | null {
  const v = vehiculos.find((x) => x.assigned) ?? vehiculos[0];
  return v ? { id: v.id, etiqueta: etiquetaDeVehiculo(v) } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// En este navegador: el demo (sin base) y el modo práctica
// ---------------------------------------------------------------------------------------------------------------

export const LLAVE_DEL_DEMO = "rtg_inspecciones_demo";
export const LLAVE_DE_PRACTICA = "rtg_inspecciones_practica";

interface AlmacenDelNavegador { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Los camiones del demo. Diego (el chofer del demo, `u-drv`) tiene asignado el 3. */
export function vehiculosDelDemo(quien: string | null | undefined): Vehiculo[] {
  return [
    { id: "veh-demo-3", name: "Camión 3", plate: "TX 4KD-221", assigned: quien === "u-drv" },
    { id: "veh-demo-5", name: "Camión 5 (liftgate)", plate: "TX 7PL-904", assigned: quien === "u-drv2" },
    { id: "veh-demo-7", name: "Isuzu 12 pallets", plate: null, assigned: false },
  ];
}

/** Una «foto» del demo: un dibujo pequeño, para que se vea dónde va la foto sin cargar una imagen grande. */
const FOTO_DEL_DEMO = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220"><rect width="320" height="220" fill="#3b3f47"/>' +
  '<circle cx="160" cy="110" r="78" fill="#1c1e22"/><circle cx="160" cy="110" r="34" fill="#9aa3ad"/>' +
  '<path d="M214 70 l22 -10 l-6 24 z" fill="#e9a13b"/><text x="12" y="208" fill="#fff" font-size="15" font-family="sans-serif">demo</text></svg>',
);

/** Dos inspecciones de otros choferes para el día pedido: una bien y otra con una llanta baja (no segura). */
export function semillasDelDemo(fecha: string): Inspeccion[] {
  return [
    {
      id: `demo-${fecha}-1`, driver_id: "u-drv2", driver_name: "Carlos R.", inspection_date: fecha,
      vehicle_id: "veh-demo-5", vehicle_label: "Camión 5 (liftgate) · TX 7PL-904", odometer: 84213,
      answers: { bocina: { estado: "defecto", nota: "Suena muy bajito", fotos: [FOTO_DEL_DEMO] } },
      safe: true, notes: null, certified: true, checklist_version: "demo", repairs: {}, created_at: `${fecha}T12:41:00.000Z`,
    },
    {
      id: `demo-${fecha}-2`, driver_id: "u-drv3", driver_name: "Miguel A.", inspection_date: fecha,
      vehicle_id: "veh-demo-7", vehicle_label: "Isuzu 12 pallets", odometer: 131870,
      answers: {
        inflado: { estado: "defecto", nota: "Trasera izquierda de afuera baja, se ve aplastada", fotos: [FOTO_DEL_DEMO] },
        correas: { estado: "defecto", nota: "Una matraca no cierra", fotos: [FOTO_DEL_DEMO] },
      },
      safe: false, notes: "Le avisé a Laura por radio", certified: true, checklist_version: "demo", repairs: {}, created_at: `${fecha}T13:05:00.000Z`,
    },
  ];
}

function leeTodo(almacen: AlmacenDelNavegador | null | undefined, llave: string): Inspeccion[] {
  try {
    const crudo = almacen?.getItem(llave);
    const v = crudo ? (JSON.parse(crudo) as unknown) : [];
    return Array.isArray(v) ? (v as Inspeccion[]) : [];
  } catch {
    return [];
  }
}

function guardaTodo(almacen: AlmacenDelNavegador | null | undefined, llave: string, filas: Inspeccion[]): boolean {
  try {
    almacen?.setItem(llave, JSON.stringify(filas));
    return !!almacen;
  } catch {
    return false; // sin sitio (las fotos pesan): se dice como error, no se finge guardado
  }
}

/**
 * Las inspecciones de este navegador para un día. Con `semillas` (el demo), las dos de ejemplo de ese día se añaden si
 * no están, y a partir de ahí se guardan como cualquier otra (marcar «corregido» en una se queda).
 */
export function leeDelNavegador(almacen: AlmacenDelNavegador | null | undefined, llave: string, fecha: string, choferId: string | null, semillas: boolean): Lectura {
  let todas = leeTodo(almacen, llave);
  if (semillas) {
    const faltan = semillasDelDemo(fecha).filter((s) => !todas.some((f) => f.id === s.id));
    if (faltan.length) { todas = [...todas, ...faltan]; guardaTodo(almacen, llave, todas); }
  }
  const filas = todas
    .filter((f) => f.inspection_date === fecha && (!choferId || f.driver_id === choferId))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { estado: "listo", filas };
}

export function guardaEnElNavegador(almacen: AlmacenDelNavegador | null | undefined, llave: string, nueva: InspeccionNueva, ahora: Date): Guardado {
  const todas = leeTodo(almacen, llave);
  // La misma regla que el índice único de la 165: una por chofer, día y vehículo.
  if (todas.some((f) => f.driver_id === nueva.driver_id && f.inspection_date === nueva.inspection_date && claveDeVehiculo(f) === claveDeVehiculo(nueva))) {
    return { ok: false, motivo: "repetida" };
  }
  const fila: Inspeccion = { ...nueva, id: `local-${ahora.getTime()}`, repairs: {}, created_at: ahora.toISOString() };
  if (!guardaTodo(almacen, llave, [...todas, fila])) return { ok: false, motivo: "error", detalle: "localStorage" };
  return { ok: true, fila };
}

export function corrigeEnElNavegador(
  almacen: AlmacenDelNavegador | null | undefined, llave: string, id: string, punto: string, corregido: boolean, nota: string,
  quien: { id: string; nombre: string }, ahora: Date,
): Correccion {
  const todas = leeTodo(almacen, llave);
  const fila = todas.find((f) => f.id === id);
  if (!fila) return { ok: false, detalle: "no existe" };
  if (fila.answers?.[punto]?.estado !== "defecto") return { ok: false, detalle: "ese punto no es un defecto" };
  const repairs: Reparaciones = { ...(fila.repairs ?? {}) };
  if (corregido) repairs[punto] = { at: ahora.toISOString(), by: quien.id, by_name: quien.nombre, note: nota.trim() || null };
  else delete repairs[punto];
  if (!guardaTodo(almacen, llave, todas.map((f) => (f.id === id ? { ...f, repairs } : f)))) return { ok: false, detalle: "localStorage" };
  return { ok: true, repairs };
}
