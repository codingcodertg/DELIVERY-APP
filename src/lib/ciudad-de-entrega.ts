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
 * dentro del texto: «2 McAllen Ave, Pharr TX» es Pharr. (Nota de D-423: sigue valiendo para una dirección con comas;
 * sin ellas, una ciudad conocida que CIERRE el texto sí se toma — abajo.)
 *
 * **Direcciones escritas a mano, sin comas (D-423, T-0413).** Medido en producción el 2026-09-27: 21 de 295 direcciones
 * daban «» o basura — «LOTE #24 9 W ROBLES EDINBURG, TX» (el lote delante), «…, TX, USA LOTE 11» (el lote detrás del país),
 * «…, TX.» y «…, TX.78521» (el estado con punto), y «9 W ROBLES EDINBURG TX» (todo en un trozo). (Calles inventadas; los patrones, los medidos). Ahora:
 *   · el lote, apartamento o suite («LOTE #24», «APT 3», «STE 200», «#12») se quita antes de leer;
 *   · el estado con punto («TX.», «TX.78521», «tx. 78521») se reconoce como estado;
 *   · si lo que queda es la calle (lleva números), la ciudad es la CONOCIDA que cierre el texto (`conocidas`: las que
 *     salen limpias de otras direcciones, las de las tiendas y las zonas de los choferes). Sin ninguna, «»: no se inventa.
 *   La ciudad sale siempre del propio texto, con su grafía; la lista solo dice DÓNDE empieza. Se probó también leer lo que
 *   va detrás del tipo de vía (St, Rd, Loop…) y se descartó: «7 Dos St sin coma» daba la ciudad «sin coma».
 */

const PAIS = /^(?:usa|us|u\.s\.a?\.?|united states(?: of america)?|estados unidos|m[eé]xico|mx)$/i;
const CODIGO_POSTAL = /^\d{5}(?:-\d{4})?$/;
/** Un estado solo en su trozo: dos mayúsculas («TX», «TX 78501») o el nombre de los que salen en esta región. */
const ESTADO_SIGLA = /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/;
const ESTADO_NOMBRE = /^(?:tx|texas|tamaulipas|tamps\.?|nuevo le[oó]n|n\.\s?l\.)\.?(?:\s*\d{5}(?:-\d{4})?)?$/i;
const CONDADO = /\bcounty$/i;
/** Lo que va pegado DETRÁS de la ciudad en su mismo trozo: «McAllen TX», «McAllen, TX 78501» ya partido, «mcallen tx». */
const COLA_POSTAL = /[\s.]+\d{5}(?:-\d{4})?$/;
const COLA_ESTADO_SIGLA = /\s+[A-Z]{2}\.?$/;
const COLA_ESTADO_NOMBRE = /\s+(?:texas|tx)\.?$/i;

/** Un lote, apartamento o suite con su número: «LOTE #24», «Lot 11», «APT 3B», «STE 200», «Suite 5», «SWEET 104» (así se
 *  escribe a veces «suite»), «#12». Se quita donde esté: no es ni la calle ni la ciudad. */
const UNIDAD = /(?:\b(?:lote|lot|apt|apartment|unit|ste|suite|sweet|spc|space|trlr)\b\.?|#)\s*#?\s*[a-z]?-?\d+[a-z]?\b/gi;
const sinPuntoFinal = (s: string) => s.replace(/[.\s]+$/, "");

/** Las ciudades que se leen limpias de estas direcciones (con coma delante): la lista `conocidas` para las que no la tienen. */
export function ciudadesConocidas(direcciones: Iterable<string | null | undefined>): string[] {
  const vistas = new Map<string, string>();
  for (const d of direcciones) {
    const c = ciudadDeEntrega(d);
    if (c && !vistas.has(c.toLowerCase())) vistas.set(c.toLowerCase(), c);
  }
  return [...vistas.values()];
}

/** La ciudad al final de un trozo que es la calle («9 W ROBLES EDINBURG»): la conocida más larga que lo cierre, con la
 *  calle delante. Con las palabras del propio texto; si ninguna lo cierra, «». */
function ciudadDetrasDeLaCalle(calle: string, conocidas: Iterable<string>): string {
  const palabras = calle.split(" ").filter(Boolean);
  let mejor = 0;
  for (const c of conocidas) {
    const nombre = c.trim().replace(/\s+/g, " ").toLowerCase();
    const n = nombre.split(" ").length;
    // Tiene que quedar algo delante (la calle, que es la que lleva el número): la conocida sola no.
    if (nombre && n > mejor && n < palabras.length && palabras.slice(-n).join(" ").toLowerCase() === nombre) mejor = n;
  }
  return mejor ? palabras.slice(-mejor).join(" ") : "";
}

export function ciudadDeEntrega(direccion: string | null | undefined, conocidas: Iterable<string> = []): string {
  const trozos = String(direccion ?? "").replace(UNIDAD, " ").split(",").map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  // El primer trozo es la calle: nunca se quita, aunque parezca un estado.
  while (trozos.length > 1) {
    const ultimo = trozos[trozos.length - 1];
    if (PAIS.test(ultimo) || CODIGO_POSTAL.test(ultimo) || ESTADO_SIGLA.test(ultimo) || ESTADO_NOMBRE.test(ultimo) || CONDADO.test(ultimo)) trozos.pop();
    else break;
  }
  if (trozos.length === 0) return "";
  // Las colas llevan un espacio delante: un trozo que es solo «TX» no se vacía.
  const ciudad = sinPuntoFinal(trozos[trozos.length - 1].replace(COLA_POSTAL, "").replace(COLA_ESTADO_SIGLA, "").replace(COLA_ESTADO_NOMBRE, ""));
  // Lleva números: es la calle. Pasa con un solo trozo («123 Main St McAllen TX», sin coma) y cuando la dirección acaba en
  // la calle. La ciudad, si está, va detrás de ella (D-423).
  if (/\d/.test(ciudad)) return ciudadDetrasDeLaCalle(ciudad, conocidas);
  return ciudad;
}
