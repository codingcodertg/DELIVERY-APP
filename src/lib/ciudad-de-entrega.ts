/**
 * La CIUDAD de una dirección de entrega, para la columna «Ciudad de entrega» del Gestor de Rutas (D-408).
 *
 * El dueño, el 2026-09-26: «instead of delivery address column que salga delivery city y solo salga la city donde se
 * entrega en routes manager». La orden no tiene un campo de ciudad (`Delivery` solo trae `delivery_address`, texto
 * libre), así que la ciudad se saca de la dirección.
 *
 * No se usa `cityFromAddress` (`utils.ts`): con «4500 N 23rd St, McAllen TX» devuelve la CALLE (toma el penúltimo
 * trozo entre comas, y aquí solo hay dos), y con la de Nominatim «…, Pharr, Hidalgo County, Texas, 78577, United
 * States» devuelve «78577». Además la usa el cálculo del costo de entrega (`pricing.ts`): cambiarla movería precios.
 *
 * Cómo lee: parte por comas y quita, desde el final, lo que no es ciudad —el país, el código postal, el estado y el
 * condado—. Lo que queda al final es el trozo de la ciudad, al que aún se le quitan el código postal y el estado pegados
 * («McAllen TX 78504» → «McAllen»). Si ese trozo empieza con un número, es la calle: la dirección no dice la ciudad y se
 * devuelve «» (la celda pinta «—» y la dirección entera va en el `title`). Nunca adivina buscando nombres conocidos
 * dentro del texto: «2 McAllen Ave, Pharr TX» es Pharr.
 */

const PAIS = /^(?:usa|us|u\.s\.a?\.?|united states(?: of america)?|estados unidos|m[eé]xico|mx)$/i;
const CODIGO_POSTAL = /^\d{5}(?:-\d{4})?$/;
/** Un estado solo en su trozo: dos mayúsculas («TX», «TX 78501») o el nombre de los que salen en esta región. */
const ESTADO_SIGLA = /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/;
const ESTADO_NOMBRE = /^(?:tx|texas|tamaulipas|tamps\.?|nuevo le[oó]n|n\.\s?l\.)(?:\s+\d{5}(?:-\d{4})?)?$/i;
const CONDADO = /\bcounty$/i;
/** Lo que va pegado DETRÁS de la ciudad en su mismo trozo: «McAllen TX», «McAllen, TX 78501» ya partido, «mcallen tx». */
const COLA_POSTAL = /\s+\d{5}(?:-\d{4})?$/;
const COLA_ESTADO_SIGLA = /\s+[A-Z]{2}\.?$/;
const COLA_ESTADO_NOMBRE = /\s+(?:texas|tx)\.?$/i;

export function ciudadDeEntrega(direccion: string | null | undefined): string {
  const trozos = String(direccion ?? "").split(",").map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  // El primer trozo es la calle: nunca se quita, aunque parezca un estado.
  while (trozos.length > 1) {
    const ultimo = trozos[trozos.length - 1];
    if (PAIS.test(ultimo) || CODIGO_POSTAL.test(ultimo) || ESTADO_SIGLA.test(ultimo) || ESTADO_NOMBRE.test(ultimo) || CONDADO.test(ultimo)) trozos.pop();
    else break;
  }
  if (trozos.length === 0) return "";
  // Las colas llevan un espacio delante: un trozo que es solo «TX» no se vacía.
  const ciudad = trozos[trozos.length - 1].replace(COLA_POSTAL, "").replace(COLA_ESTADO_SIGLA, "").replace(COLA_ESTADO_NOMBRE, "");
  // Empieza con número: es la calle. Pasa con un solo trozo («123 Main St McAllen TX», sin coma no se puede separar) y
  // cuando la dirección acaba en la calle.
  if (/^\d/.test(ciudad)) return "";
  return ciudad;
}
