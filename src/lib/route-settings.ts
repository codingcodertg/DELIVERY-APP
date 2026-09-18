import { DELIVERY_WINDOW_PRESETS } from "./constants";
import { PARAMETROS_POR_DEFECTO, PESOS_POR_DEFECTO } from "./route-engine";
import type { DriverSettings, NamedLocation, RouteWeights, Settings } from "./types";

/**
 * Los ajustes del motor de rutas: pesos, ventanas duras, tope de retraso, y lo de cada chofer (D-316).
 *
 * Todo lo que decidió el orquestador por delegación del dueño el 2026-09-18 vive aquí como VALOR POR
 * DEFECTO y en Ajustes como valor editable: nada de esto es una regla en el código.
 * (`docs/route-algorithm-design.md`, §11.)
 */

/** El orden del dueño: builder temprano > ruta corta (manejo y millas) > ventana ancha > balance. **Una sola
 *  fuente: los del motor** (`route-engine/evalua.ts`), que son los que fijan sus pruebas. La migración 130
 *  siembra los mismos números, y una prueba compara los dos. */
export const PESOS_DE_RUTA_POR_DEFECTO: RouteWeights = { ...PESOS_POR_DEFECTO };

/** Las ventanas a las que no se llega tarde nunca. El dueño puso de ejemplo 08:30–12:00, que dura tres
 *  horas y media: por eso es una LISTA y no una regla de duración. */
export const VENTANAS_DURAS_POR_DEFECTO: readonly string[] = ["0830-1000", "0830-1200"];

export const TOPE_DE_RETRASO_POR_DEFECTO_MIN = PARAMETROS_POR_DEFECTO.topeTardeAnchaMin;
export const TURNO_POR_DEFECTO = { entrada: "08:00", salida: "17:30" } as const;
/** El mismo 12 que usa hoy el Gestor de Rutas cuando nadie puso otra cosa (`routes/page.tsx`). */
export const CAPACIDAD_POR_DEFECTO = 12;

const CLAVES_DE_PESO = ["builder", "manejo", "millas", "tarde", "balance"] as const;
const numeroValido = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Los pesos vigentes: lo de Ajustes, y por cada peso que falte o no sea un número ≥ 0, el de por defecto. */
export function pesosDeRuta(settings: Pick<Settings, "route_weights">): RouteWeights {
  const guardados = settings.route_weights ?? {};
  const r = { ...PESOS_DE_RUTA_POR_DEFECTO };
  for (const k of CLAVES_DE_PESO) if (numeroValido(guardados[k])) r[k] = guardados[k] as number;
  return r;
}

/** Las ventanas duras vigentes. Una lista VACÍA guardada a propósito es «ninguna es dura», no «las de
 *  por defecto»: solo `null`/ausente cae al valor por defecto. Se descarta lo que no sea un slot de la app. */
export function ventanasDuras(settings: Pick<Settings, "route_hard_windows">): string[] {
  const guardadas = settings.route_hard_windows;
  const lista = Array.isArray(guardadas) ? guardadas : VENTANAS_DURAS_POR_DEFECTO;
  const slots = new Set(DELIVERY_WINDOW_PRESETS.map((p) => p.value));
  return [...new Set(lista.map((v) => String(v).trim()))].filter((v) => slots.has(v));
}

export function esVentanaDura(ventana: string | null | undefined, settings: Pick<Settings, "route_hard_windows">): boolean {
  const v = (ventana ?? "").trim();
  return !!v && ventanasDuras(settings).includes(v);
}

/**
 * ¿La base ya tiene las columnas de la 130? `settings` se lee con `select("*")`, así que si la clave
 * viene, la columna existe. Las migraciones se aplican después de fusionar: hay una ventana en la que el
 * código nuevo corre contra la base vieja, y en ella estos ajustes se enseñan pero no se pueden guardar.
 */
export function laBaseTieneAjustesDeRuta(settings: object): boolean {
  return "route_weights" in settings && "route_hard_windows" in settings && "route_late_cap_min" in settings;
}

export function topeDeRetrasoMin(settings: Pick<Settings, "route_late_cap_min">): number {
  const v = settings.route_late_cap_min;
  return numeroValido(v) ? Math.round(v) : TOPE_DE_RETRASO_POR_DEFECTO_MIN;
}

// ---- El chofer -----------------------------------------------------------------------------------

/** "08:00" o "08:00:00" → minutos desde la medianoche; `null` si no es una hora. */
export function minutosDeHora(hora: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((hora ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

export type ChoferParaElMotor = {
  id: string; nombre: string; base: string | null; capacidad: number;
  entradaMin: number; salidaMin: number; vuelveABase: boolean; rutea: boolean;
  /** Qué le falta para que el motor pueda darle trabajo. Vacío = listo. */
  falta: ("base" | "base_sin_punto")[];
};

/**
 * Lo que el motor sabe de un chofer, juntando su fila de `driver_settings` con lo que ya había.
 *
 * La capacidad tiene una cadena de respaldo para que nada cambie el día que se aplique la migración:
 * su fila → la que ya tenía por NOMBRE en `settings.driver_capacity` → la de flota → 12. Es la misma
 * cadena, en el mismo orden, que usa hoy el Gestor de Rutas, con un eslabón nuevo delante.
 *
 * Sin base, o con una base que no es una tienda con punto, el chofer NO rutea aunque esté marcado: el
 * motor no puede sacarlo de ningún sitio. Se dice en `falta` en vez de inventarle una base.
 */
export function choferParaElMotor(
  perfil: { id: string; full_name: string | null; store?: string | null },
  fila: DriverSettings | null | undefined,
  settings: Pick<Settings, "driver_capacity" | "default_truck_capacity" | "stores">,
): ChoferParaElMotor {
  const nombre = (perfil.full_name ?? "").trim();
  const capacidad = [fila?.capacity_pallets, settings.driver_capacity?.[nombre], settings.default_truck_capacity]
    .find((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0) ?? CAPACIDAD_POR_DEFECTO;
  const base = (fila?.base_store ?? "").trim() || null;
  const tienda = base ? (settings.stores ?? []).find((s: NamedLocation) => s.name.trim().toLowerCase() === base.toLowerCase()) : undefined;
  const falta: ChoferParaElMotor["falta"] = !base ? ["base"] : !tienda || tienda.lat == null || tienda.lng == null ? ["base_sin_punto"] : [];
  return {
    id: perfil.id, nombre, base: tienda?.name ?? base, capacidad,
    entradaMin: minutosDeHora(fila?.shift_start) ?? minutosDeHora(TURNO_POR_DEFECTO.entrada)!,
    salidaMin: minutosDeHora(fila?.shift_end) ?? minutosDeHora(TURNO_POR_DEFECTO.salida)!,
    vuelveABase: fila?.returns_to_base ?? true,
    rutea: (fila?.routable ?? true) && falta.length === 0,
    falta,
  };
}

export type ErrorDeAjustesDeChofer = "capacidad" | "turno" | "base";

/** Lo que la pantalla comprueba antes de guardar. La base comprueba lo mismo (128): capacidad > 0 y la
 *  salida después de la entrada. Que la base sea una tienda de Ajustes solo lo puede saber la pantalla. */
export function erroresDeAjustesDeChofer(
  f: Pick<DriverSettings, "base_store" | "capacity_pallets" | "shift_start" | "shift_end">, tiendas: readonly NamedLocation[],
): ErrorDeAjustesDeChofer[] {
  const errores: ErrorDeAjustesDeChofer[] = [];
  if (f.capacity_pallets != null && !(Number.isFinite(f.capacity_pallets) && f.capacity_pallets > 0)) errores.push("capacidad");
  const a = minutosDeHora(f.shift_start), b = minutosDeHora(f.shift_end);
  if (a == null || b == null || b <= a) errores.push("turno");
  const base = (f.base_store ?? "").trim();
  if (base && !tiendas.some((s) => s.name.trim().toLowerCase() === base.toLowerCase())) errores.push("base");
  return errores;
}
