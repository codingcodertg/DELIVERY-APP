import type { Contacto } from "./formato";
import type { ContactoEnEdicion } from "./contactos";

/**
 * Una sola casilla de dirección en la ficha que se edita. Roberto Rodriguez Jr (admin), solicitud de ayuda 3914768b,
 * 2026-11-04, con la captura del alta («New customer») marcando la segunda casilla «Address» bajo «Socials»: «address box
 * should not repeat».
 *
 * Qué pasaba: D-697 dio a cada contacto su dirección (y el alta la exige en el primero, D-772); D-786 devolvió la
 * dirección de la CUENTA a la tarjeta «Contacto», debajo de los contactos, porque es la que leen la orden y la búsqueda y
 * Roberto la echaba en falta al ver. Al crear o editar salían las dos casillas, una debajo de otra.
 *
 * Ahora: la dirección del PRIMER contacto es también la de la cuenta. Al editar solo se ve la casilla del contacto; la de la
 * cuenta la sigue al guardar (`direccionDeLaCuentaAlGuardar`). Si el primer contacto no tiene dirección y la cuenta sí (las
 * filas del Excel), su casilla abre con la de la cuenta (`conDireccionDeLaCuenta`): no se pierde nada a la vista. La única
 * excepción son las filas que YA traen dos direcciones distintas (`direccionesAparte`): ahí siguen las dos casillas, para
 * no esconder ni pisar ninguna.
 */

/** La dirección como la guarda un contacto (`normalizaContactos`): cada línea recortada y sin espacios dobles, sin líneas vacías. */
export const lineasDeDireccion = (s: string | null | undefined): string =>
  (s ?? "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");

/** La misma dirección, escrita con otras mayúsculas o espacios. Dos vacías son la misma. */
export const mismaDireccion = (a: string | null | undefined, b: string | null | undefined): boolean =>
  lineasDeDireccion(a).toLowerCase() === lineasDeDireccion(b).toLowerCase();

/** La fila trae dos direcciones distintas (la de la cuenta y la del primer contacto): entonces se ven las dos casillas. */
export function direccionesAparte(cuenta: string | null | undefined, contactos: readonly Contacto[]): boolean {
  const a = lineasDeDireccion(cuenta);
  const b = lineasDeDireccion(contactos[0]?.address);
  return a !== "" && b !== "" && !mismaDireccion(a, b);
}

/**
 * Los contactos para editar con una sola dirección: si el primero no tiene y la cuenta sí, el primero lleva la de la cuenta
 * (si no hay contactos, uno con solo esa dirección). Lo demás, tal cual. Se usa también como «lo de antes» al comparar, así
 * que abrir y cerrar sin tocar nada no cuenta como cambio.
 */
export function conDireccionDeLaCuenta(contactos: readonly Contacto[], cuenta: string | null | undefined): Contacto[] {
  const direccion = lineasDeDireccion(cuenta);
  if (!direccion || lineasDeDireccion(contactos[0]?.address)) return [...contactos];
  const primero: Contacto = contactos[0] ?? { name: null, title: null, phones: [], emails: [], note: null };
  return [{ ...primero, address: direccion }, ...contactos.slice(1)];
}

/**
 * La dirección de la cuenta que se guarda cuando hay una sola casilla: la del primer contacto, pero SOLO si esa casilla
 * cambió (o cambió quién es el primero). Si no, la que ya tenía la cuenta, sin tocar: guardar otra cosa no la reescribe.
 */
export function direccionDeLaCuentaAlGuardar(cuenta: string, antes: readonly Contacto[], editados: readonly ContactoEnEdicion[]): string {
  const ahora = lineasDeDireccion(editados[0]?.address);
  return ahora === lineasDeDireccion(antes[0]?.address) ? cuenta : ahora;
}
