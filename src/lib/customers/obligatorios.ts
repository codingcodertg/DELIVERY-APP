import type { ContactoEnEdicion } from "./contactos";

/**
 * D-772: lo que un alta de cliente tiene que traer (el dueño, 2026-10-30, escribiendo «REQUIRED» en cada campo de la
 * captura, y «either phone or email required»): los términos, y del primer contacto el nombre, el cargo y un teléfono O un
 * correo. El correo y la dirección del contacto («REQUIRED BUT CAN PASS TO AUTH») son obligatorios en el alta directa del
 * admin, pero una SOLICITUD (D-743) puede ir sin ellos: los completa el admin al aprobar. Cuenta y tienda ya las exige
 * `parcheDe`. Una ficha ya creada no pasa por aquí: lo que falte de antes no bloquea un guardado.
 *
 * Devuelve las claves con la forma de `erroresDeContactos` (`contacto.<i>.<campo>[.<j>]`), que la ficha ya sabe marcar en
 * rojo y a cuya pestaña salta «Guardar».
 */
export function faltanEnElAlta(form: Record<string, string>, contactos: readonly ContactoEnEdicion[], solicitud: boolean): string[] {
  const out: string[] = [];
  if (!(form.terms ?? "").trim()) out.push("terms");
  const c = contactos[0];
  if (!c) return [...out, "contacto.0.name", "contacto.0.title", "contacto.0.phones.0", "contacto.0.emails.0"];
  if (!c.name.trim()) out.push("contacto.0.name");
  if (!c.title.trim()) out.push("contacto.0.title");
  const hayTelefono = c.phones.some((p) => p.trim() !== "");
  const hayCorreo = c.emails.some((e) => e.trim() !== "");
  if (!hayTelefono && !hayCorreo) out.push("contacto.0.phones.0", "contacto.0.emails.0");
  if (!solicitud) {
    if (!hayCorreo) out.push("contacto.0.emails.0");
    if (!c.address.trim()) out.push("contacto.0.address");
  }
  return [...new Set(out)];
}
