import { contactosDeLosCampos, espejoDeContactos, normalizaContactos, type Contacto } from "./formato";
import type { Cliente, Parche } from "./reglas";

export type { Contacto };
type T = (en: string, es: string) => string;

/**
 * Los contactos de un cliente en la pantalla (D-668, migración 193). El dueño, 2026-10-24: «así como tienes las
 * tiendas, que uno le da clic a las tiendas y cambia las tiendas, así mero quiero en contacto: que salga el nombre de la
 * persona y le das clic y vas cambiando los contactos. Si es más de lo que el view agarra, quedaría como +5, y hay un
 * drop down». Y al editar, «que uno pueda agregar cuántos contactos quieran, y si es mismo contacto, varios teléfonos,
 * varios correos». Lo puro, aquí; la forma de cada contacto y el formato, en `formato.ts`.
 */

type ConContactos = Pick<Cliente, "contact_name" | "contact_title" | "phone" | "email"> & { contacts?: readonly Contacto[] | null };

/** Los contactos de una fila: los guardados (193) o, si la lista está vacía o la base aún no la tiene, los de las cuatro columnas de antes. */
export function contactosDe(c: ConContactos | null | undefined): Contacto[] {
  if (!c) return [];
  if (c.contacts && c.contacts.length > 0) return normalizaContactos(c.contacts);
  return contactosDeLosCampos(c);
}

/** Cuántas pastillas de contacto caben a la vista; las demás van al desplegable «+N». */
export const PASTILLAS_A_LA_VISTA = 3;

/** Qué contactos van en pastilla y cuáles en el desplegable «+N». Con uno de más, también al desplegable: así no cambia de forma. */
export function repartoDePastillas(cuantos: number, aLaVista = PASTILLAS_A_LA_VISTA): { pastillas: number[]; enElMenu: number[] } {
  const todos = Array.from({ length: Math.max(0, cuantos) }, (_, i) => i);
  return { pastillas: todos.slice(0, aLaVista), enElMenu: todos.slice(aLaVista) };
}

/** El rótulo de un contacto en su pastilla: su nombre; sin nombre, su cargo; sin nada, «Contacto N». */
export function rotuloDeContacto(c: Contacto, i: number, t: T): string {
  return c.name ?? c.title ?? t(`Contact ${i + 1}`, `Contacto ${i + 1}`);
}

// ---- Editar ----------------------------------------------------------------------------------------------------------

/** Un contacto mientras se escribe: todo texto, sin formato todavía. */
export interface ContactoEnEdicion { name: string; title: string; phones: string[]; emails: string[]; note: string; website: string; address: string }

export const contactoVacio = (): ContactoEnEdicion => ({ name: "", title: "", phones: [""], emails: [""], note: "", website: "", address: "" });

/** La lista para editar: la de la fila, o un contacto en blanco si no tiene (así hay dónde escribir). Cada uno con al menos un hueco de teléfono y uno de correo. */
export function enEdicion(lista: readonly Contacto[]): ContactoEnEdicion[] {
  if (!lista.length) return [contactoVacio()];
  return lista.map((c) => ({
    name: c.name ?? "", title: c.title ?? "", note: c.note ?? "",
    // D-NEXT: cada contacto con su sitio web y su dirección; sin los suyos, vacíos (no hereda los de la cuenta).
    website: c.website ?? "", address: c.address ?? "",
    phones: c.phones.length ? [...c.phones] : [""],
    emails: c.emails.length ? [...c.emails] : [""],
  }));
}

/** Lo escrito, en su formato (`normalizaContactos`): los huecos vacíos y los contactos sin nada se van. */
export const deEdicion = (lista: readonly ContactoEnEdicion[]): Contacto[] => normalizaContactos(lista);

const digitos = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
export const correoValido = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/**
 * Lo que está mal escrito, con su clave (`contacto.<i>.phones.<j>`, `contacto.<i>.emails.<j>`): un teléfono empezado
 * (de 1 a 9 dígitos) y un correo que no lo parece. Un hueco vacío no es un error: se ignora al guardar.
 */
export function erroresDeContactos(lista: readonly ContactoEnEdicion[]): string[] {
  const out: string[] = [];
  lista.forEach((c, i) => {
    c.phones.forEach((p, j) => { const n = digitos(p).length; if (n > 0 && n < 10) out.push(`contacto.${i}.phones.${j}`); });
    c.emails.forEach((e, j) => { if (e.trim() && !correoValido(e)) out.push(`contacto.${i}.emails.${j}`); });
  });
  return out;
}

/**
 * Lo que se guarda de los contactos: la lista y el espejo de las cuatro columnas de antes (`espejoDeContactos`), y solo si
 * algo cambió: abrir y guardar otra cosa no reescribe unos contactos que nadie tocó (ni rellena la lista de una fila que
 * aún la saca de sus columnas). Del espejo, solo lo que difiere de la fila.
 */
export function parcheDeContactos(antes: readonly Contacto[], editados: readonly ContactoEnEdicion[], fila: ConContactos | null): Parche {
  const lista = deEdicion(editados);
  if (JSON.stringify(lista) === JSON.stringify(normalizaContactos(antes))) return {};
  const parche: Parche = { contacts: lista };
  const espejo = espejoDeContactos(lista);
  for (const k of ["contact_name", "contact_title", "phone", "email"] as const) {
    if ((fila?.[k] ?? null) !== espejo[k]) parche[k] = espejo[k];
  }
  return parche;
}

/** Todos los teléfonos y todos los correos de unos contactos, en un texto, para el aviso de duplicado (D-665). */
export function textoDeTelefonos(lista: readonly Contacto[] | readonly ContactoEnEdicion[]): string {
  return lista.flatMap((c) => c.phones).filter(Boolean).join(" / ");
}
export function textoDeCorreos(lista: readonly Contacto[] | readonly ContactoEnEdicion[]): string {
  return lista.flatMap((c) => c.emails).filter(Boolean).join("; ");
}
