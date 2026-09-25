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
 * Desde D-NEXT (2026-09-25) se vacían también el nombre del destino y la dirección de entrega, y lo que la persona tecleó
 * a mano en el formulario ya NO se borra: ver `vaciarParaMostrador`.
 */

interface ConContacto { contact?: string | null; phone?: string | null }
interface OrdenPasada { contact?: string | null; delivery_phone?: string | null }

/**
 * Lo que es DEL CLIENTE en una orden: a quién se llama y a dónde se lleva (D-NEXT). El dueño, el 2026-09-25: «venta al
 * mostrador son walk-ins, entonces si selecciona, should be empty» — y preguntado, eligió que queden vacíos contacto,
 * teléfono, el nombre del destino y la dirección de entrega. D-337 solo vaciaba los dos primeros: la dirección y el
 * nombre del destino de la cuenta anterior se quedaban dentro de la orden de mostrador.
 */
export const CAMPOS_DEL_CLIENTE = ["contact", "delivery_phone", "delivery_name", "delivery_address"] as const;
export type CampoDelCliente = (typeof CAMPOS_DEL_CLIENTE)[number];

/** Lo último que la PERSONA escribió o eligió a mano en cada campo del cliente, en este formulario. */
export type Tecleado = Partial<Record<CampoDelCliente, string>>;

export function esCampoDelCliente(k: string): k is CampoDelCliente {
  return (CAMPOS_DEL_CLIENTE as readonly string[]).includes(k);
}

type ConCamposDelCliente = Partial<Record<CampoDelCliente, string | null>>;

/** Lo que se escribe en la orden al pasar a mostrador (D-NEXT). */
export type AlPasarAMostrador = Partial<Record<CampoDelCliente, string>> & {
  delivery_lat?: null; delivery_lng?: null; delivery_pin_source?: null;
  route_miles?: null; route_duration?: null; route_provider?: null; route_traffic?: null;
};

/**
 * Al elegir «Venta al mostrador», los cuatro campos del cliente se vacían **salvo lo que la persona escribió a mano en
 * este formulario** (D-NEXT). Precargado —de la cuenta anterior, de la última orden, de la orden ya guardada que se está
 * editando— se va; tecleado se queda: quien escribe primero el nombre del cliente de paso y luego pulsa «Venta al
 * mostrador» no debe perderlo. Un campo cuenta como tecleado solo si todavía tiene EXACTAMENTE lo que se tecleó: si un
 * autorrelleno lo pisó después, ya no es de la persona.
 *
 * Si la dirección se va, se van con ella el punto del mapa y la ruta calculada, que eran de esa dirección: dejarlos
 * llevaría al chofer al cliente anterior. Si no había dirección, el punto no se toca (un pin soltado a mano sin dirección
 * sigue siendo de la persona).
 */
export function vaciarParaMostrador(actual: ConCamposDelCliente, tecleado: Tecleado): AlPasarAMostrador {
  const out: AlPasarAMostrador = {};
  const esSuyo = (k: CampoDelCliente) => tecleado[k] !== undefined && tecleado[k] === (actual[k] ?? "");
  for (const k of CAMPOS_DEL_CLIENTE) if (!esSuyo(k)) out[k] = "";
  if (out.delivery_address === "" && !!(actual.delivery_address ?? "").trim()) {
    Object.assign(out, {
      delivery_lat: null, delivery_lng: null, delivery_pin_source: null,
      route_miles: null, route_duration: null, route_provider: null, route_traffic: null,
    });
  }
  return out;
}

export function contactoAlElegirCuenta(o: {
  cuenta: string; guardada: ConContacto | undefined; ultimaOrden: OrdenPasada | undefined;
  actual: ConCamposDelCliente;
  /** Lo tecleado a mano en el formulario: solo cuenta con mostrador (D-NEXT). */
  tecleado?: Tecleado;
}): AlPasarAMostrador | { contact: string | null | undefined; delivery_phone: string | null | undefined } {
  if (esCuentaDeMostrador(o.cuenta)) return vaciarParaMostrador(o.actual, o.tecleado ?? {});
  if (o.guardada) return { contact: o.guardada.contact, delivery_phone: o.guardada.phone };
  return { contact: o.ultimaOrden?.contact ?? o.actual.contact, delivery_phone: o.ultimaOrden?.delivery_phone ?? o.actual.delivery_phone };
}

/** ¿Esta cuenta recuerda cosas de una orden a otra (contacto, teléfono, direcciones)? La de mostrador, no. */
export function laCuentaRecuerda(cuenta: string | null | undefined): boolean {
  return !!(cuenta ?? "").trim() && !esCuentaDeMostrador(cuenta);
}
