import type { UserRole } from "@/lib/types";

/**
 * Las columnas de la tabla de Órdenes, por PERSONA (D-330).
 *
 * Hasta aquí vivían en `localStorage` con una clave por rol: por navegador y por rol, no por persona. Ahora viven
 * en `user_prefs` (migración 136), una fila por persona y preferencia, con el `localStorage` como red.
 *
 * Orden de lectura: la base → el navegador → el defecto del rol. **Nadie pierde su elección:** el navegador nunca se
 * borra, y si la base no contesta —o la 136 aún no está aplicada— todo sigue como antes, sin un error a la vista.
 *
 * VENTAS NO ELIGE. Su lista es una sola para toda la empresa y la pone un admin en Ajustes
 * (`settings.sales_columns`): es una decisión del dueño anterior a esto y no se revierte. Aquí ni se lee ni se
 * guarda nada para ventas.
 */

export const CLAVE_DE_COLUMNAS = "order_columns";
/** Las columnas de las tablas del Gestor de Rutas (137). Misma forma: `{ "<rol>": [columnas] }`. Aquí no hay nada
 *  en el navegador que sembrar: nace con el defecto. */
export const CLAVE_DE_COLUMNAS_DEL_GESTOR = "routes_columns";
/** La lista CERRADA de la base (`user_prefs_key_permitida`). Una prueba la compara con la última migración que la toca. */
export const CLAVES_DE_PREFERENCIA = [CLAVE_DE_COLUMNAS, CLAVE_DE_COLUMNAS_DEL_GESTOR] as const;
export type ClaveDePreferencia = typeof CLAVES_DE_PREFERENCIA[number];
export const claveDelNavegador = (rol: UserRole): string => `rtg_order_columns_${rol}`;
export const ROLES_QUE_ELIGEN: readonly UserRole[] = ["admin", "manager", "warehouse", "driver", "logistics", "accounting"];

/** Lo que guarda la base para `order_columns`: por rol, la lista de claves de columna. */
export type ColumnasPorRol = Partial<Record<UserRole, string[]>>;

const MAX_COLUMNAS = 60;
const esLista = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MAX_COLUMNAS && v.every((c) => typeof c === "string" && c.length > 0 && c.length <= 40);

/** Lo que venga de la base o del navegador, saneado: solo roles que eligen, solo listas de textos cortos. */
export function columnasValidas(v: unknown): ColumnasPorRol {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const r: ColumnasPorRol = {};
  for (const rol of ROLES_QUE_ELIGEN) { const lista = (v as Record<string, unknown>)[rol]; if (esLista(lista)) r[rol] = [...lista]; }
  return r;
}

/** Lo que hay en ESTE navegador, para todos los roles que eligen. Un JSON roto no es una elección. */
export function semillaDelNavegador(leer: (clave: string) => string | null): ColumnasPorRol {
  const crudo: Record<string, unknown> = {};
  for (const rol of ROLES_QUE_ELIGEN) {
    try { const t = leer(claveDelNavegador(rol)); if (t) crudo[rol] = JSON.parse(t); } catch { /* ese rol no tenía nada que valga */ }
  }
  return columnasValidas(crudo);
}

export type OrigenDeColumnas = "base" | "navegador" | "defecto";

/** Qué columnas ve esta persona con este rol, y de dónde salieron. */
export function columnasDe(rol: UserRole, deLaBase: ColumnasPorRol | null, delNavegador: ColumnasPorRol, defecto: readonly string[]): { columnas: string[]; origen: OrigenDeColumnas } {
  const b = deLaBase?.[rol];
  if (b) return { columnas: b, origen: "base" };
  const n = delNavegador[rol];
  if (n) return { columnas: n, origen: "navegador" };
  return { columnas: [...defecto], origen: "defecto" };
}

/**
 * ¿Hay que sembrar la base desde el navegador? SOLO si se pudo leer la base y no había fila, si el navegador tiene
 * algo, y si NO hay una suplantación en curso: durante una suplantación la sesión es la del suplantado, y el
 * navegador es el del admin — sembrar metería las columnas del admin en la fila de otra persona. Si no se sabe si
 * hay suplantación, no se siembra.
 */
export function hayQueSembrar(estado: { baseLeida: boolean; hayFila: boolean; suplantando: boolean | null }, delNavegador: ColumnasPorRol): boolean {
  return estado.baseLeida && !estado.hayFila && estado.suplantando === false && Object.keys(delNavegador).length > 0;
}

// ---------------------------------------------------------------------------------------------------------------
// La base. Lo mínimo de supabase-js que se usa, para poder probarlo sin él.
// ---------------------------------------------------------------------------------------------------------------

type Respuesta<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
export interface ClienteDePrefs {
  from(tabla: "user_prefs"): {
    select(cols: string): { eq(c: string, v: string): { eq(c: string, v: string): { maybeSingle(): Respuesta<{ value: unknown }> } } };
    upsert(fila: { user_id: string; key: string; value: ColumnasPorRol }, opciones: { onConflict: string }): { select(cols: string): Respuesta<{ user_id: string }[]> };
  };
}

/** `leida: false` = no se pudo leer (sin red, o la tabla aún no existe): se sigue con el navegador y NO se siembra. */
export async function leeColumnas(supabase: ClienteDePrefs, userId: string, clave: ClaveDePreferencia = CLAVE_DE_COLUMNAS): Promise<{ leida: boolean; hayFila: boolean; columnas: ColumnasPorRol }> {
  try {
    const { data, error } = await supabase.from("user_prefs").select("value").eq("user_id", userId).eq("key", clave).maybeSingle();
    if (error) return { leida: false, hayFila: false, columnas: {} };
    return { leida: true, hayFila: !!data, columnas: columnasValidas(data?.value) };
  } catch { return { leida: false, hayFila: false, columnas: {} }; }
}

/** Guarda la fila propia, y MIDE que se escribió: en PostgREST un UPDATE de cero filas vuelve limpio. */
export async function guardaColumnas(supabase: ClienteDePrefs, userId: string, columnas: ColumnasPorRol, clave: ClaveDePreferencia = CLAVE_DE_COLUMNAS): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("user_prefs").upsert({ user_id: userId, key: clave, value: columnasValidas(columnas) }, { onConflict: "user_id,key" }).select("user_id");
    return !error && !!data && data.length === 1;
  } catch { return false; }
}
