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
 * guarda nada para ventas — salvo el ANCHO de sus columnas (`_anchos`, D-338), que sí es suyo.
 */

/**
 * Las columnas que ve VENTAS: la lista de Ajustes —o el defecto del rol—, sin las que para ventas repiten lo que ya se ve.
 * El dueño (D-338): «in sales view invoice is duplicated as its already visible with the id number»: la celda `#` ya enseña
 * «INV …». D-330 la quitó del defecto; esto cierra el otro camino, que un admin la marque en Ajustes. La lista guardada NO se
 * toca: se filtra al leer.
 */
export const COLUMNAS_QUE_VENTAS_NO_VE: readonly string[] = ["invoice"];
export function columnasDeVentas(deAjustes: readonly string[] | null | undefined, defecto: readonly string[]): string[] {
  return (deAjustes ?? defecto).filter((k) => !COLUMNAS_QUE_VENTAS_NO_VE.includes(k));
}

export const CLAVE_DE_COLUMNAS = "order_columns";
/** Las columnas de las tablas del Gestor de Rutas (137). Misma forma: `{ "<rol>": [columnas] }`. Aquí no hay nada
 *  en el navegador que sembrar: nace con el defecto. */
export const CLAVE_DE_COLUMNAS_DEL_GESTOR = "routes_columns";
/** Las columnas de la tabla de RTG PROMOS (141). Misma forma: `{ "<rol>": [columnas] }`, y tampoco
 *  hay nada en el navegador que sembrar. */
export const CLAVE_DE_COLUMNAS_DE_PROMOS = "promos_columns";
/** La lista CERRADA de la base (`user_prefs_key_permitida`). Una prueba la compara con la última migración que la toca. */
export const CLAVES_DE_PREFERENCIA = [CLAVE_DE_COLUMNAS, CLAVE_DE_COLUMNAS_DEL_GESTOR, CLAVE_DE_COLUMNAS_DE_PROMOS] as const;
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

/**
 * El ORDEN de las columnas vive en el mismo `value`, bajo la clave `_orden`, con la misma forma por rol:
 *   { "logistics": [visibles], "_orden": { "logistics": [todas, en el orden de la persona] } }
 * `_orden` NO es un rol: `columnasValidas` solo recorre `ROLES_QUE_ELIGEN`, así que nunca se cuela como uno. Y las dos
 * mitades se leen y se escriben SIEMPRE juntas (`valorDeColumnas`): guardar la visibilidad no pisa el orden, ni al revés.
 */
export const CLAVE_DEL_ORDEN = "_orden";

/**
 * El ANCHO de las columnas, la tercera mitad del mismo `value` (D-338): `{ "_anchos": { "<rol>": { "<columna>": px } } }`.
 * El dueño: «make it possible to resize columns and however it keeps that way it saves for ever». Arrastrar ya se podía; lo que
 * se arrastraba vivía en `localStorage`, o sea por navegador y no por persona.
 *
 * A diferencia de las otras dos mitades, esta vale para TODOS los roles, ventas incluida: ventas no elige QUÉ columnas ve
 * (eso es de Ajustes), pero el ancho es cosa de cada pantalla y cada persona. La RLS de la 136 es por `user_id`, sin rol.
 */
export const CLAVE_DE_ANCHOS = "_anchos";
export const ANCHO_MINIMO = 40;
export const ANCHO_MAXIMO = 800;
export const TODOS_LOS_ROLES: readonly UserRole[] = ["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"];
export type AnchosPorRol = Partial<Record<UserRole, Record<string, number>>>;

/** Un juego de anchos, saneado: números finitos, recortados a [mínimo, máximo] y enteros; claves cortas; y, si se dice qué
 *  columnas existen, solo esas. Un ancho que no es un número se descarta: la columna vuelve a su ancho por defecto. */
export function anchosDeUnRol(v: unknown, conocidas?: readonly string[]): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const r: Record<string, number> = {};
  for (const [k, px] of Object.entries(v as Record<string, unknown>).slice(0, MAX_COLUMNAS)) {
    if (!k || k.length > 40 || typeof px !== "number" || !Number.isFinite(px) || (conocidas && !conocidas.includes(k))) continue;
    r[k] = Math.round(Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, px)));
  }
  return r;
}

export function anchosValidos(v: unknown, conocidas?: readonly string[]): AnchosPorRol {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const r: AnchosPorRol = {};
  for (const rol of TODOS_LOS_ROLES) { const a = anchosDeUnRol((v as Record<string, unknown>)[rol], conocidas); if (Object.keys(a).length) r[rol] = a; }
  return r;
}

/** `anchos` es opcional al ESCRIBIR el tipo —las columnas del Gestor no lo usan—, pero `prefsDeValor` lo devuelve siempre. */
export interface PrefsDeColumnas { visibles: ColumnasPorRol; orden: ColumnasPorRol; anchos?: AnchosPorRol }

/** Del `value` de la base a sus dos mitades, saneadas. */
export function prefsDeValor(v: unknown): PrefsDeColumnas {
  const orden = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>)[CLAVE_DEL_ORDEN] : null;
  const anchos = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>)[CLAVE_DE_ANCHOS] : null;
  return { visibles: columnasValidas(v), orden: columnasValidas(orden), anchos: anchosValidos(anchos) };
}

/** De las dos mitades al `value` que se guarda. Sin orden elegido no se escribe `_orden`: el canónico no se guarda. */
export function valorDeColumnas(p: PrefsDeColumnas): Record<string, unknown> {
  const orden = columnasValidas(p.orden), anchos = anchosValidos(p.anchos);
  return {
    ...columnasValidas(p.visibles),
    ...(Object.keys(orden).length ? { [CLAVE_DEL_ORDEN]: orden } : {}),
    ...(Object.keys(anchos).length ? { [CLAVE_DE_ANCHOS]: anchos } : {}),
  };
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
export function hayQueSembrar(estado: { baseLeida: boolean; hayFila: boolean; suplantando: boolean | null }, delNavegador: ColumnasPorRol, anchosDelNavegador: AnchosPorRol = {}): boolean {
  return estado.baseLeida && !estado.hayFila && estado.suplantando === false && Object.keys(delNavegador).length + Object.keys(anchosDelNavegador).length > 0;
}

// ---------------------------------------------------------------------------------------------------------------
// La base. Lo mínimo de supabase-js que se usa, para poder probarlo sin él.
// ---------------------------------------------------------------------------------------------------------------

type Respuesta<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
export interface ClienteDePrefs {
  from(tabla: "user_prefs"): {
    select(cols: string): { eq(c: string, v: string): { eq(c: string, v: string): { maybeSingle(): Respuesta<{ value: unknown }> } } };
    upsert(fila: { user_id: string; key: string; value: Record<string, unknown> }, opciones: { onConflict: string }): { select(cols: string): Respuesta<{ user_id: string }[]> };
  };
}

/** `leida: false` = no se pudo leer (sin red, o la tabla aún no existe): se sigue con el navegador y NO se siembra. */
export async function leeColumnas(supabase: ClienteDePrefs, userId: string, clave: ClaveDePreferencia = CLAVE_DE_COLUMNAS): Promise<{ leida: boolean; hayFila: boolean; columnas: ColumnasPorRol; orden: ColumnasPorRol; anchos: AnchosPorRol }> {
  try {
    const { data, error } = await supabase.from("user_prefs").select("value").eq("user_id", userId).eq("key", clave).maybeSingle();
    if (error) return { leida: false, hayFila: false, columnas: {}, orden: {}, anchos: {} };
    const p = prefsDeValor(data?.value);
    return { leida: true, hayFila: !!data, columnas: p.visibles, orden: p.orden, anchos: p.anchos ?? {} };
  } catch { return { leida: false, hayFila: false, columnas: {}, orden: {}, anchos: {} }; }
}

/** Guarda la fila propia, y MIDE que se escribió: en PostgREST un UPDATE de cero filas vuelve limpio. */
/** `orden` y `anchos`: SIEMPRE lo que se leyó (o lo que la persona acaba de cambiar). La fila se escribe entera, así que
 *  quien no pase una mitad la borra — por eso la página de Órdenes escribe por un solo sitio, con las tres. */
export async function guardaColumnas(supabase: ClienteDePrefs, userId: string, columnas: ColumnasPorRol, clave: ClaveDePreferencia = CLAVE_DE_COLUMNAS, orden: ColumnasPorRol = {}, anchos: AnchosPorRol = {}): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("user_prefs").upsert({ user_id: userId, key: clave, value: valorDeColumnas({ visibles: columnas, orden, anchos }) }, { onConflict: "user_id,key" }).select("user_id");
    return !error && !!data && data.length === 1;
  } catch { return false; }
}
