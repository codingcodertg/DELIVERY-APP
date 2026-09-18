/**
 * Buscar dentro del desplegable de cuentas (D-299).
 *
 * El dueño mandó una captura: la lista de cuentas ya es larga y un `select` nativo no se busca, así que
 * hay que bajar con la rueda hasta encontrarla. El filtro va **encima** del selector y solo acota lo que
 * se pinta — no convierte el campo en texto libre, porque elegir una cuenta dispara el autorrellenado
 * de contacto, teléfono y tipo de orden, y con un campo de texto eso correría en cada tecla.
 */

/** Los diacríticos que deja `normalize("NFD")`, por sus códigos: escritos como escape unicode, la
 *  herramienta que editó este fichero los resolvía a caracteres invisibles dentro de la clase. */
const DIACRITICOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");

/** Comparable: sin acentos, sin mayúsculas y sin espacios de sobra. «Ángel» encuentra «angel». */
const comparable = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFD").replace(DIACRITICOS, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Las cuentas que se enseñan con lo escrito en el filtro.
 *
 * Con el filtro vacío, todas. Y **la cuenta que la orden ya tiene se enseña siempre**, aunque no
 * coincida (criterio de D-267): un selector que esconde su propio valor se ve vacío con un dato detrás.
 * El orden de la lista no se toca — llega ya ordenada y reordenarla por «lo que más se parece» haría
 * que la misma cuenta cambiara de sitio según lo tecleado.
 */
export function cuentasQueCoinciden(
  opciones: readonly string[],
  filtro: string | null | undefined,
  actual?: string | null,
): string[] {
  const q = comparable(filtro);
  if (!q) return [...opciones];
  const suya = comparable(actual);
  return opciones.filter((o) => comparable(o).includes(q) || (!!suya && comparable(o) === suya));
}
