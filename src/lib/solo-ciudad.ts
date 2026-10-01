import type { Delivery } from "@/lib/types";
import { ciudadDeEntrega } from "@/lib/ciudad-de-entrega";

/**
 * «Solo ciudad»: una dirección de entrega que es NADA MÁS una ciudad («Mission, TX, USA»), sin calle ni número (D-454).
 *
 * El dueño, el 2026-10-01: «cuando buscas una direccion que puedas selecionar solo la ciudad si asi lo quieres como broad
 * answer». El buscador ofrece ahora la ciudad (`sugerenciasDePlaces`), y la orden que la lleva se guarda como cualquier
 * otra: el punto lo pone `geocode-on-save` (el centro de la ciudad) y de él salen zona, tarifa y millas.
 *
 * No hay columna nueva: que una orden sea «solo ciudad» se DERIVA del texto de la dirección cada vez que se pinta. Así no
 * puede quedar una marca vieja: en cuanto alguien escribe la calle, el aviso se va solo; y vale también para las órdenes
 * que ya existían con solo la ciudad tecleada a mano.
 *
 * La regla: quitados el país, el código postal, el estado y el condado (lo hace `ciudadDeEntrega`, D-408/D-423), queda UN
 * solo trozo y no lleva números. «Mission, TX, USA», «Mission TX 78572», «Pharr, Hidalgo County, Texas, 78577, United
 * States» (el formato de Nominatim) y «Mission» a secas lo son; «123 Main St, Mission, TX» y «Main St, Mission, TX» no
 * (la segunda no trae número, pero trae calle: eso es otra cosa y no se le llama «solo ciudad»).
 */
export function esSoloCiudad(direccion: string | null | undefined): boolean {
  const texto = String(direccion ?? "");
  const ciudad = ciudadDeEntrega(texto);
  // Sin ciudad legible («» también cuando lo que hay es una calle con número y nada más) no es «solo ciudad».
  if (!ciudad) return false;
  // El PRIMER trozo es la ciudad misma: delante no hay calle.
  return ciudadDeEntrega(texto.split(",")[0]) === ciudad;
}

/**
 * ¿Esta ORDEN sale con el aviso? Sí cuando su dirección es solo una ciudad, SALVO que alguien haya soltado un pin a mano:
 * ahí el punto exacto existe (lo marcó una persona) y el chofer ya ve su propio aviso, «Navegar usa el pin» (D-221). Un
 * punto `geocoded` no cuenta: es el centro de la ciudad, que es justo lo que hay que confirmar.
 */
export function ordenSoloCiudad(d: Pick<Partial<Delivery>, "delivery_address" | "delivery_pin_source"> | null | undefined): boolean {
  return !!d && d.delivery_pin_source !== "manual" && esSoloCiudad(d.delivery_address);
}

/** El texto del aviso, el mismo en la ficha, el Gestor, Mi ruta, la parada del chofer y el Quote Builder. */
export const AVISO_SOLO_CIUDAD = { en: "City only — address to be confirmed", es: "Solo ciudad — dirección por confirmar" } as const;
