import type { AnySupabase } from "@/lib/clockin/supabase/types";

/**
 * Qué tiendas ve quien pregunta, y qué gente hay en ellas.
 *
 * Hasta D-127 esta regla **no se aplicaba nunca**. Decía "un gerente con tienda ve solo su
 * cuadrilla" y la condición era `role === "manager"`, pero `clockin.profiles` jamás emitía ese
 * valor: solo `owner` o `employee`. Ocho de doce personas tenían tienda asignada y no servía
 * para nada — todo el que entraba veía la empresa entera. La migración 089 crea el nivel de
 * verdad; esto es lo que por fin lo usa.
 *
 * La regla, en una frase: **el dueño lo ve todo; un gerente ve su tienda más las que se le
 * hayan concedido; un gerente sin tienda NO VE A NADIE**.
 *
 * **Esa última mitad la decidió D-127 al revés, y D-NEXT la invierte.** D-127 lo escribió como
 * el fallo fácil de evitar: acotar a una lista vacía dejaría a alguien sin cuadrilla y
 * «parecería que la app está rota, cuando lo que falta es configurarle la tienda». El motivo
 * era bueno; la salida, no. Un campo vacío ampliaba el alcance, que es la puerta abierta al
 * lado de la que cerró D-236.
 *
 * La objeción de D-127 se atiende por otro lado: `clockinManagerCtx` no le deja entrar y le
 * dice POR QUÉ, así que ya no parece una app rota. La regla de la familia manda:
 * **la falta de un dato acota, nunca amplía.**
 */

/**
 * El id que no es de nadie: un uuid de ceros. Vive en UNA constante porque de él cuelgan las
 * dos listas centinela de este fichero y los sitios que las usan (D-NEXT). Estaba escrito a
 * mano en SEIS —`clock.ts`, `reports.ts`, `schedule.ts`, el export de CSV, y dos veces en el
 * de XLSX— mas las dos definiciones de aqui: ocho copias del mismo valor son ocho sitios donde
 * cambiarlo mal.
 */
export const NADIE = "00000000-0000-0000-0000-000000000000";

export type StoreScope = {
  /** La tienda "principal", o null si no está acotado. Se conserva por compatibilidad. */
  scopeStore: string | null;
  /** TODAS las tiendas visibles, o null si no está acotado. */
  stores: string[] | null;
  /** Las personas de esas tiendas, o null si no está acotado. */
  ids: string[] | null;
};

/**
 * Una tienda que no existe, para acotar a NADIE sin depender de una lista vacía.
 *
 * OJO A LA RAZÓN, que cambió: cuando se escribió esto (D-237) se creía que `.in(col, [])`
 * podía leerse como «sin filtro». **Es falso en nuestro PostgREST**, medido después:
 * `supabase-js` construye `id=in.()` y la respuesta es `200` con cuerpo vacío, no la tabla
 * entera. Así que una lista vacía habría filtrado bien.
 *
 * Se mantiene el valor imposible **por consistencia, no por seguridad**: los seis sitios del
 * módulo que acotan por lista lo usan, y seis haciendo lo mismo de dos formas distintas es
 * peor que seis haciéndolo igual.
 */
export const NINGUNA_TIENDA = [NADIE];

/** Las tiendas que ve alguien: null = todas, `NINGUNA_TIENDA` = ninguna. */
export function visibleStores(
  role: string,
  storeId: string | null,
  extra: string[] | null | undefined,
): string[] | null {
  if (role !== "manager") return null;      // el dueño, y cualquier otro nivel, no se acota
  // Gerente sin tienda: NO VE A NADIE (D-NEXT). Antes devolvía null —«sin acotar»— y eso le
  // enseñaba la compañía entera en las tres pantallas de fichaje y le autorizaba cualquier
  // acción en `canManageEmployee`. Devolver una tienda imposible en vez de una lista vacía
  // es lo que hace que los siete sitios que llaman aquí acoten sin tocar ninguno.
  if (!storeId) return NINGUNA_TIENDA;
  const todas = [storeId, ...(extra ?? [])].filter(Boolean);
  return [...new Set(todas)];
}

export async function storeScope(
  supabase: AnySupabase,
  companyId: string,
  role: string,
  storeId: string | null,
  extra?: string[] | null,
): Promise<StoreScope> {
  const stores = visibleStores(role, storeId, extra);
  if (!stores) return { scopeStore: null, stores: null, ids: null };
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("company_id", companyId)
    .in("store_id", stores);
  return { scopeStore: storeId, stores, ids: (data ?? []).map((p) => p.id as string) };
}

// Sentinel used with `.in("employee_id", ...)`.
//
// El comentario que estuvo aquí desde antes decía que servía «so an empty allow-list matches
// nothing (rather than being dropped and matching everything)». **Ese «rather than being
// dropped» nunca se midió, y es falso en nuestro PostgREST.** Medido el 2026-09-11, las dos
// mitades:
//
//   · el cliente SÍ manda el filtro — `postgrest-js/src/PostgrestFilterBuilder.ts:846`
//     construye `in.()` con la lista vacía, no omite el parámetro;
//   · y el servidor lo resuelve como cero filas:
//       GET /rest/v1/profiles?select=id           → Content-Range: 0-32/33
//       GET /rest/v1/profiles?select=id&id=in.()  → 200, cuerpo []
//
// O sea que una lista vacía filtra bien y este centinela no la está salvando de nada.
//
// Se queda porque los seis sitios que acotan por lista lo usan y la uniformidad sí vale.
// Se corrige el comentario en vez de borrarlo: esa frase se heredó como hecho tres veces
// en un mismo día (D-237 y las dos ramas siguientes), y así nadie vuelve a heredarla.
export const NO_MATCH = [NADIE];
