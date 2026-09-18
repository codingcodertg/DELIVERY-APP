import type { NamedLocation } from "@/lib/types";
import type { PersonaDirectorio } from "@/lib/phone-book";
import { normaliza } from "@/lib/phone-book";

/**
 * A quién llama el chofer cuando toca una tienda de la parada (D-309).
 *
 * El dueño: *«so driver could click on any pu or del store and see the warehouse phone number so he
 * can call him»*, y de las dos formas posibles eligió **la gente del directorio**, no un teléfono
 * escrito por tienda.
 *
 * Medido antes de escribir esto (producción, 2026-09-18, por el orquestador):
 *   · un **chofer** puede ejecutar `phone_book()` con su sesión y recibe filas — sin migración;
 *   · el directorio solo trae a quien tiene extensión de RingCentral **y** teléfono, y aun así hay
 *     almacenistas dentro;
 *   · **el departamento identifica mejor que el rol**: hay 8 personas de «Almacén» sin cuenta en la
 *     app, que el rol no vería y el departamento sí. Por eso aquí se filtra por departamento.
 */

/** El texto que marca el departamento de almacén, ya normalizado. */
export const DEPARTAMENTO_ALMACEN = "almacen";

/**
 * ¿Esta persona es de almacén?
 *
 * Se compara **normalizado** —sin acentos, sin espacios de sobra y en minúsculas— porque el
 * departamento lo teclea RR. HH. en el expediente: «Almacén», «almacen » y «ALMACEN» son el mismo.
 */
export function esDeAlmacen(departamento: string | null | undefined): boolean {
  return normaliza(departamento ?? "") === DEPARTAMENTO_ALMACEN;
}

/**
 * El código con el que el directorio agrupa a una tienda: el de Ajustes, o su nombre si no tiene.
 *
 * Es la misma regla que aplica la 117 dentro de `phone_book`, y por eso vive en una función: si una
 * de las dos cambiara, el chofer llamaría a la tienda equivocada sin que nada fallara.
 */
export function codigoDeTienda(nombre: string | null | undefined, tiendas: readonly NamedLocation[]): string | null {
  const buscado = normaliza(nombre ?? "");
  if (!buscado) return null;
  const tienda = tiendas.find((s) => normaliza(s.name) === buscado);
  if (!tienda) return null;
  return (tienda.directory_code ?? "").trim() || tienda.name;
}

/**
 * La gente de almacén a la que puede llamar el chofer en esa tienda.
 *
 * `null` cuando el sitio **no es una tienda nuestra** (la casa de un cliente): ahí no hay nada que
 * ofrecer. Una lista **vacía** es otra cosa —es una tienda pero sin nadie a quien llamar— y la
 * pantalla lo dice, que es lo que pidió el dueño.
 *
 * **Varias tiendas pueden compartir código** y entonces el directorio las trata como un solo grupo
 * (D-261). Se devuelven todas, y la pantalla enseña de qué tienda es cada persona: el chofer tiene
 * que saber a quién está llamando, no solo que alguien contesta.
 */
export function almacenDeLaTienda(
  filas: readonly PersonaDirectorio[],
  nombreDeLaTienda: string | null | undefined,
  tiendas: readonly NamedLocation[],
): PersonaDirectorio[] | null {
  const codigo = codigoDeTienda(nombreDeLaTienda, tiendas);
  if (!codigo) return null;
  const buscado = normaliza(codigo);
  return filas
    .filter((f) => normaliza(f.store ?? "") === buscado && esDeAlmacen(f.department) && (f.phone ?? "").trim())
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
