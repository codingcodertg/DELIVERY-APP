/**
 * El orden de las apps del hub, elegido por el admin (D-739, 2026-10-29).
 *
 * El dueño: «en la parte del hub, para los administradores solamente, deja que el admin pueda rearrange las
 * aplicaciones para que estén en el orden que mejor le convenga».
 *
 * - Solo el **admin** ordena (`puedeOrdenarElHub`); los demás ven el orden de siempre (`MODULES`, Entregas primero).
 * - Se guarda **por persona** en `user_prefs` con la clave `hub_order` (migración 214 la admite), con la forma
 *   `{ "modules": ["deliveries", "customers", ...] }`; y en el navegador (`rtg_hub_order_<id>`) como copia, para que
 *   se vea al instante y para seguir funcionando si la base aún no admite la clave.
 * - Se reordena ARRASTRANDO una tarjeta sobre otra (D-757; antes flechas): el sitio nuevo lo calcula `colocaColumna`.
 * - La tarjeta «Mapa de la empresa» también se ordena (el admin, 2026-11-05: «Allow me to reorder map as well»): va en
 *   la misma lista con la clave `company-map`. Mientras no esté en lo guardado sigue PRIMERA, como siempre
 *   (`tarjetasDelHub`); el primer arrastre guarda la lista entera y desde ahí se queda donde se la deje.
 * - Lo guardado es una lista de claves de módulo. Las que la persona ya no tiene se saltan; las que tiene y no están
 *   en la lista van después, en el orden de siempre: una app nueva aparece al final, no desaparece.
 */
import type { ClienteDePrefs } from "./user-prefs";

export const CLAVE_DE_ORDEN_DEL_HUB = "hub_order";
export const claveDelNavegadorDelHub = (userId: string): string => `rtg_hub_order_${userId}`;
const MAX = 40;

export function puedeOrdenarElHub(me: { role: string }): boolean {
  return me.role === "admin";
}

/** De lo que venga (base o navegador) a una lista de claves, o vacía si no es una. */
export function ordenValido(v: unknown): string[] {
  const lista = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>).modules : v;
  if (!Array.isArray(lista) || lista.length > MAX) return [];
  const limpia = lista.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 40);
  return [...new Set(limpia)];
}

export function valorDeOrden(orden: readonly string[]): { modules: string[] } {
  return { modules: ordenValido([...orden]) };
}

/** Los módulos en el orden guardado; los que no están en la lista, después y como venían. */
export function ordenaModulos<T extends { key: string }>(modulos: readonly T[], orden: readonly string[]): T[] {
  const pos = new Map(orden.map((k, i) => [k, i]));
  const conSitio = modulos.filter((m) => pos.has(m.key)).sort((a, b) => pos.get(a.key)! - pos.get(b.key)!);
  const sinSitio = modulos.filter((m) => !pos.has(m.key));
  return [...conSitio, ...sinSitio];
}

/** La clave de la tarjeta del mapa dentro del orden guardado. No es un módulo: ninguna clave de `MODULES` es esta. */
export const CLAVE_DEL_MAPA_EN_EL_HUB = "company-map";
export type TarjetaDelMapa = { key: typeof CLAVE_DEL_MAPA_EN_EL_HUB; esElMapa: true };
const TARJETA_DEL_MAPA: TarjetaDelMapa = { key: CLAVE_DEL_MAPA_EN_EL_HUB, esElMapa: true };

/**
 * Las tarjetas grandes del hub, en orden: los módulos y, para quien lo ve (`conMapa`), la del mapa de la empresa.
 * Si el mapa está en el orden guardado, va donde diga; si no (nadie lo ha movido aún), primero, como antes de poder moverlo.
 */
export function tarjetasDelHub<T extends { key: string }>(modulos: readonly T[], orden: readonly string[], conMapa: boolean): (T | TarjetaDelMapa)[] {
  if (!conMapa) return ordenaModulos(modulos, orden);
  if (orden.includes(CLAVE_DEL_MAPA_EN_EL_HUB)) return ordenaModulos<T | TarjetaDelMapa>([TARJETA_DEL_MAPA, ...modulos], orden);
  return [TARJETA_DEL_MAPA, ...ordenaModulos(modulos, orden)];
}

/** Lee el orden: primero la base; si no se puede, el navegador. */
export async function leeOrdenDelHub(supabase: ClienteDePrefs, userId: string, navegador: (clave: string) => string | null): Promise<string[]> {
  try {
    const { data, error } = await supabase.from("user_prefs").select("value").eq("user_id", userId).eq("key", CLAVE_DE_ORDEN_DEL_HUB).maybeSingle();
    if (!error && data) return ordenValido(data.value);
  } catch { /* sin red o sin la 214: el navegador */ }
  try { return ordenValido(JSON.parse(navegador(claveDelNavegadorDelHub(userId)) ?? "null")); } catch { return []; }
}

/** Guarda en los dos sitios. Devuelve si la base lo aceptó (si no, queda solo en este navegador). */
export async function guardaOrdenDelHub(supabase: ClienteDePrefs, userId: string, orden: readonly string[], navegador: (clave: string, valor: string) => void): Promise<boolean> {
  const valor = valorDeOrden(orden);
  try { navegador(claveDelNavegadorDelHub(userId), JSON.stringify(valor)); } catch { /* sin localStorage */ }
  try {
    const { data, error } = await supabase.from("user_prefs").upsert({ user_id: userId, key: CLAVE_DE_ORDEN_DEL_HUB, value: valor }, { onConflict: "user_id,key" }).select("user_id");
    return !error && !!data && data.length === 1;
  } catch { return false; }
}
