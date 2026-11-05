import { esCuentaDeMostrador } from "./customer-type";

/**
 * Lo que se rellena —y lo que NO— al elegir una cuenta en la orden (D-337).
 *
 * El dueño: «si se selecciona cuenta venta al mostrador nombre de contacto y teléfono siempre será vacío porque no es una
 * cuenta, son cuentas para los que son clientes walk-in». Cada orden de mostrador es de una persona distinta, así que:
 *   · contacto y teléfono se VACÍAN al elegirla, aunque vinieran de otra cuenta — siguen siendo obligatorios: se teclean;
 *   · no se rellenan con «la última orden de esa cuenta»: serían los datos de OTRO cliente de paso;
 *   · no se ofrece guardarlos sobre la cuenta, ni se guardan sus direcciones como sitios de la cuenta.
 *
 * Desde D-391 (2026-09-25) se vacían también el nombre del destino y la dirección de entrega, con su pin y su ruta:
 * ver `vaciarParaMostrador`.
 */

interface ConContacto { contact?: string | null; phone?: string | null }
interface OrdenPasada { contact?: string | null; delivery_phone?: string | null }

/**
 * Lo que es DEL CLIENTE en una orden: a quién se llama y a dónde se lleva (D-391). El dueño, el 2026-09-25: «venta al
 * mostrador son walk-ins, entonces si selecciona, should be empty» — y preguntado, eligió que queden vacíos contacto,
 * teléfono, el nombre del destino y la dirección de entrega. D-337 solo vaciaba los dos primeros: la dirección y el
 * nombre del destino de la cuenta anterior se quedaban dentro de la orden de mostrador.
 */
export const CAMPOS_DEL_CLIENTE = ["contact", "delivery_phone", "delivery_name", "delivery_address"] as const;
export type CampoDelCliente = (typeof CAMPOS_DEL_CLIENTE)[number];

type ConCamposDelCliente = Partial<Record<CampoDelCliente, string | null>>;

/** Lo que se escribe en la orden al pasar a mostrador (D-391). */
export type AlPasarAMostrador = Record<CampoDelCliente, string> & {
  delivery_lat: null; delivery_lng: null; delivery_pin_source: null;
  route_miles: null; route_duration: null; route_provider: null; route_traffic: null;
};

/**
 * Al elegir «Venta al mostrador», los cuatro campos del cliente quedan SIEMPRE vacíos (D-391), vengan de donde vengan:
 * de la cuenta anterior, de la orden ya guardada que se edita o tecleados a mano. El dueño lo dijo dos veces con «siempre»
 * (D-337: «nombre de contacto y teléfono siempre será vacío»; D-391: «si selecciona, should be empty»). Se teclean
 * DESPUÉS de elegir mostrador. El pin y la ruta se van con la dirección: eran de ella, y dejarlos llevaría al chofer al
 * cliente anterior.
 */
export function vaciarParaMostrador(): AlPasarAMostrador {
  return {
    contact: "", delivery_phone: "", delivery_name: "", delivery_address: "",
    delivery_lat: null, delivery_lng: null, delivery_pin_source: null,
    route_miles: null, route_duration: null, route_provider: null, route_traffic: null,
  };
}

/**
 * D-860: el destino (nombre, dirección, pin y ruta) solo se vacía si era de OTRA cuenta. En una orden nueva la dirección se
 * teclea en el primer paso («Siguiente →») ANTES de elegir la cuenta; vaciarla al elegir mostrador la borraba, y el vendedor
 * veía que «la dirección no se guarda». Sin cuenta previa (o ya de mostrador), esa dirección es la del cliente de paso.
 */
function destinoEsDeOtraCuenta(cuentaAnterior: string | null | undefined): boolean {
  return laCuentaRecuerda(cuentaAnterior);
}

export function contactoAlElegirCuenta(o: {
  cuenta: string; guardada: ConContacto | undefined; ultimaOrden: OrdenPasada | undefined;
  actual: ConCamposDelCliente & { account?: string | null };
}): AlPasarAMostrador | { contact: string | null | undefined; delivery_phone: string | null | undefined } {
  if (esCuentaDeMostrador(o.cuenta)) {
    if (destinoEsDeOtraCuenta(o.actual.account)) return vaciarParaMostrador();
    return { contact: "", delivery_phone: "" };
  }
  if (o.guardada) return { contact: o.guardada.contact, delivery_phone: o.guardada.phone };
  return { contact: o.ultimaOrden?.contact ?? o.actual.contact, delivery_phone: o.ultimaOrden?.delivery_phone ?? o.actual.delivery_phone };
}

/** ¿Esta cuenta recuerda cosas de una orden a otra (contacto, teléfono, direcciones)? La de mostrador, no. */
export function laCuentaRecuerda(cuenta: string | null | undefined): boolean {
  return !!(cuenta ?? "").trim() && !esCuentaDeMostrador(cuenta);
}
