import { nombreNormalizado } from "./store-pins";
import type { NamedLocation } from "./types";

/**
 * Tiendas que trabajan juntas (D-NEXT).
 *
 * El dueño: *«no, no como una tienda; siempre 2 tiendas, pero ambos employees mirarán las órdenes de
 * ambas»*. O sea: **no** se funden. La orden conserva su tienda, el directorio las sigue separando y
 * los informes también. Lo que se comparte es el **trabajo**: la cola de almacén, poder vender desde la
 * otra, y prestarse vendedores y choferes.
 *
 * El grupo vive en `settings.stores[*].group`, que edita el admin en Datos. Vacío = la tienda va sola,
 * que es el caso de todas hasta que alguien las agrupe: por eso esta decisión, recién fusionada, **no
 * cambia nada** hasta que se rellene ese campo — y por eso aquí no hay ningún nombre de tienda escrito.
 *
 * No se reusa `directory_code` a propósito; la razón está en el comentario de `NamedLocation.group`.
 */

const grupoNormalizado = (g: string | null | undefined): string => (g ?? "").trim().toLowerCase();

/** El grupo de esta tienda, o null si va sola (sin grupo, o con uno que no comparte con nadie). */
export function grupoDeLaTienda(tienda: string | null | undefined, tiendas: readonly NamedLocation[]): string | null {
  const buscada = nombreNormalizado(tienda);
  if (!buscada) return null;
  const suya = tiendas.find((s) => nombreNormalizado(s.name) === buscada);
  const g = grupoNormalizado(suya?.group);
  return g || null;
}

/**
 * Las tiendas que cuentan como «la tuya» para trabajar: la propia y las que comparten su grupo.
 *
 * Devuelve **siempre** la tienda pedida, aunque no esté en la lista de Ajustes —una orden vieja con una
 * tienda que ya se borró tiene que seguir comparando consigo misma— y devuelve vacío solo cuando no se
 * pide ninguna tienda. Los nombres salen tal como están escritos en Ajustes, que es lo que guardan las
 * órdenes.
 */
export function tiendasDelGrupo(tienda: string | null | undefined, tiendas: readonly NamedLocation[]): string[] {
  const buscada = nombreNormalizado(tienda);
  if (!buscada) return [];
  const suya = tiendas.find((s) => nombreNormalizado(s.name) === buscada);
  const g = grupoNormalizado(suya?.group);
  if (!g) return [suya?.name ?? (tienda as string)];
  const juntas = tiendas.filter((s) => grupoNormalizado(s.group) === g).map((s) => s.name);
  return juntas.length ? juntas : [suya?.name ?? (tienda as string)];
}

/** ¿Estas dos tiendas se trabajan la una a la otra? Dos vacías no: «sin tienda» no empareja con nada. */
export function mismaTiendaOGrupo(
  a: string | null | undefined,
  b: string | null | undefined,
  tiendas: readonly NamedLocation[],
): boolean {
  const x = nombreNormalizado(a);
  const y = nombreNormalizado(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return tiendasDelGrupo(a, tiendas).some((n) => nombreNormalizado(n) === y);
}

/** ¿Esta tienda trabaja con alguna otra? Lo usa la ficha para saber si el selector de «Vendido desde»
 *  tiene algo que elegir o se queda fijo, como estaba antes de esta decisión. */
export function trabajaConOtras(tienda: string | null | undefined, tiendas: readonly NamedLocation[]): boolean {
  return tiendasDelGrupo(tienda, tiendas).length > 1;
}
