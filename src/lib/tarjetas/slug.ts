/**
 * El «slug» de una tarjeta: lo que va después del dominio (`businesscard.rdztilegroup.com/<slug>`) y lo que se
 * imprime en el NFC. Solo minúsculas, números y guiones; sin guion al principio ni al final ni dos seguidos.
 */
export const SLUG_MIN = 2;
export const SLUG_MAX = 60;

/** Rutas de la app y palabras que no pueden ser el nombre de una persona en la URL. */
export const SLUGS_RESERVADOS: readonly string[] = [
  "editar", "api", "tarjeta", "tarjetas", "track", "login", "auth", "unsubscribe", "reset-password",
  "change-password", "no-access", "device-blocked", "web-blocked", "monitoring", "no-encontrada", "_next",
];

const FORMATO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ResultadoSlug = { ok: true } | { ok: false; motivo: "largo" | "formato" | "reservado" };

export function validaSlug(slug: string): ResultadoSlug {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return { ok: false, motivo: "largo" };
  if (!FORMATO.test(slug)) return { ok: false, motivo: "formato" };
  if (SLUGS_RESERVADOS.includes(slug)) return { ok: false, motivo: "reservado" };
  return { ok: true };
}

export function esSlugDeTarjeta(slug: string): boolean {
  return validaSlug(slug).ok;
}

/**
 * Propone un slug a partir del nombre: sin acentos, en minúsculas, todo lo que no sea letra o número pasa a guion.
 * «José Pérez» → «jose-perez». Puede devolver vacío o uno reservado; `validaSlug` lo dice.
 */
export function slugDesdeNombre(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return base;
}
