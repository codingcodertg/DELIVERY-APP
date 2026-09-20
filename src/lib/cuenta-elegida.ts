import { esCuentaDeMostrador } from "./customer-type";

/**
 * Lo que se rellena —y lo que NO— al elegir una cuenta en la orden (D-NEXT).
 *
 * El dueño: «si se selecciona cuenta venta al mostrador nombre de contacto y teléfono siempre será vacío porque no es una
 * cuenta, son cuentas para los que son clientes walk-in». Cada orden de mostrador es de una persona distinta, así que:
 *   · contacto y teléfono se VACÍAN al elegirla, aunque vinieran de otra cuenta — siguen siendo obligatorios: se teclean;
 *   · no se rellenan con «la última orden de esa cuenta»: serían los datos de OTRO cliente de paso;
 *   · no se ofrece guardarlos sobre la cuenta, ni se guardan sus direcciones como sitios de la cuenta.
 */

interface ConContacto { contact?: string | null; phone?: string | null }
interface OrdenPasada { contact?: string | null; delivery_phone?: string | null }

export function contactoAlElegirCuenta(o: {
  cuenta: string; guardada: ConContacto | undefined; ultimaOrden: OrdenPasada | undefined;
  actual: { contact?: string | null; delivery_phone?: string | null };
}): { contact: string | null | undefined; delivery_phone: string | null | undefined } {
  if (esCuentaDeMostrador(o.cuenta)) return { contact: "", delivery_phone: "" };
  if (o.guardada) return { contact: o.guardada.contact, delivery_phone: o.guardada.phone };
  return { contact: o.ultimaOrden?.contact ?? o.actual.contact, delivery_phone: o.ultimaOrden?.delivery_phone ?? o.actual.delivery_phone };
}

/** ¿Esta cuenta recuerda cosas de una orden a otra (contacto, teléfono, direcciones)? La de mostrador, no. */
export function laCuentaRecuerda(cuenta: string | null | undefined): boolean {
  return !!(cuenta ?? "").trim() && !esCuentaDeMostrador(cuenta);
}
