// ============================================================
// Cambiar el usuario del hub de alguien.
//
// El usuario (`profiles.username`) solo sirve para entrar cuando la cuenta entra con
// el correo DERIVADO de él (`<usuario>@users.rdztilegroup.net`, ver `username.ts`).
// Así que renombrar sin mover ese correo deja a la persona fuera, y quitarlo sin
// moverlo deja el usuario viejo funcionando. Estas reglas las usa `/api/user-identity`
// (la única ruta que cambia el usuario, sea desde Usuarios o desde RR. HH.) y la ficha
// del empleado para avisar antes de mandar nada.
// ============================================================

import { esAliasDeBaja } from "@/lib/credenciales-liberadas";
import { emailForUsername, isSyntheticEmail, isValidUsername, normalizeUsername } from "@/lib/username";

/**
 * El correo de acceso al que hay que mover la cuenta cuando SOLO cambia el usuario, o `null` si no se toca.
 *
 * - Correo derivado de un usuario: se mueve al del usuario nuevo; el viejo deja de entrar.
 * - Alias de baja (D-709): tampoco es un contacto, así que el usuario nuevo pasa a ser con lo que entra. Es el
 *   caso de alguien reactivado al que se le da un usuario nuevo porque el suyo se liberó.
 * - Correo de verdad: nunca se reescribe por renombrar (sería quitarle la cuenta en silencio); el usuario se
 *   guarda, pero la persona sigue entrando con su correo.
 */
export function correoTrasCambioDeUsuario(correoActual: string | null | undefined, usuario: string | null): string | null {
  if (!usuario) return null;
  const actual = (correoActual ?? "").trim().toLowerCase();
  if (!isSyntheticEmail(actual) && !esAliasDeBaja(actual)) return null;
  const nuevo = emailForUsername(usuario);
  return nuevo === actual ? null : nuevo;
}

/**
 * ¿Quitar el usuario dejaría entrar con el viejo? Sí si la cuenta entra con el correo derivado: el correo se
 * quedaría y el usuario «borrado» seguiría abriendo la puerta. Se rechaza; para eso está dar de baja.
 */
export function quitarUsuarioDejaElViejo(correoActual: string | null | undefined): boolean {
  return isSyntheticEmail(correoActual);
}

/**
 * El patrón `ilike` que encuentra EXACTAMENTE este usuario, sin importar mayúsculas (como el índice único de la
 * 051). Un usuario válido solo lleva `[a-z0-9._-]`, y de eso solo `_` es comodín en LIKE: se escapa.
 */
export function patronDeUsuario(usuario: string): string {
  return normalizeUsername(usuario).replace(/[\\%_]/g, (c) => "\\" + c);
}

export type RevisionDeUsuario =
  | { ok: true; usuario: string }
  | { ok: false; motivo: "vacio" | "formato" | "igual" };

/** Lo que se teclea en «Cambiar usuario» de la ficha, antes de mandarlo. Desde RR. HH. no se quita: se cambia. */
export function revisaUsuarioNuevo(escrito: string | null | undefined, actual: string | null | undefined): RevisionDeUsuario {
  const usuario = normalizeUsername(escrito);
  if (!usuario) return { ok: false, motivo: "vacio" };
  if (!isValidUsername(usuario)) return { ok: false, motivo: "formato" };
  if (usuario === normalizeUsername(actual)) return { ok: false, motivo: "igual" };
  return { ok: true, usuario };
}
