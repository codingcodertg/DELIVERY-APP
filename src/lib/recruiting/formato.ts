import type { Candidate } from "./types";

/* ---- Formatos estándar al guardar un candidato (D-610, 2026-10-20) ----
 * El dueño: «quiero que en el sistema todo esté estandarizado. Uno mete un nombre y un teléfono, lo que sea … que todo
 * tenga el mismo formato. Si el teléfono viene todo pegado, que el sistema automáticamente lo ponga como debe de ser».
 * Medido en producción: teléfonos como «9563405910», «956)735-4681», «956-715-1463», «(956) 599-3449»; nombres en
 * MAYÚSCULAS, en minúsculas y mezclados. Aquí se decide el formato; el proveedor lo aplica en TODA escritura (alta y
 * edición), así que da igual por qué pantalla entre el dato. */

/** «(956) 340-5910» con 10 dígitos (o 11 empezando por 1, el país); otra cosa (internacional, corto) se deja limpia tal cual.
 * Con letras tampoco se toca (D-635): «956-246-6915 - Viya, A/P» lleva a quién llamar, y quitarlo lo perdería. */
export function telefonoEstandar(t: string | null | undefined): string {
  const limpio = (t ?? "").trim();
  if (!limpio) return "";
  if (/\p{L}/u.test(limpio)) return limpio.replace(/\s+/g, " ");
  const d = limpio.replace(/\D/g, "");
  const diez = d.length === 10 ? d : d.length === 11 && d.startsWith("1") ? d.slice(1) : null;
  if (!diez) return limpio.replace(/\s+/g, " ");
  return `(${diez.slice(0, 3)}) ${diez.slice(3, 6)}-${diez.slice(6)}`;
}

const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do", "dos", "das", "van", "von"]);

const capitaliza = (w: string) => (w ? w[0].toLocaleUpperCase("es") + w.slice(1).toLocaleLowerCase("es") : w);

/** «maria de la CRUZ silva-garcia» → «Maria de la Cruz Silva-Garcia»; espacios de más fuera; acentos como vienen. */
export function nombreEstandar(n: string | null | undefined): string {
  const palabras = (n ?? "").replace(/\s+/g, " ").trim().split(" ");
  return palabras
    .map((p, i) => {
      const baja = p.toLocaleLowerCase("es");
      if (i > 0 && PARTICULAS.has(baja)) return baja;
      return baja.split(/([-'’])/).map((trozo) => (/^[-'’]$/.test(trozo) ? trozo : capitaliza(trozo))).join("");
    })
    .join(" ");
}

export const correoEstandar = (e: string | null | undefined): string => (e ?? "").trim().toLowerCase();

const lista = (xs: readonly string[] | null | undefined, f: (s: string) => string): string[] =>
  (xs ?? []).map(f).filter((x) => x.length > 0);

/** El parche de un candidato con los campos de formato ya puestos; lo que no viene en el parche no se toca. */
export function estandarizaCandidato<T extends Partial<Candidate>>(c: T): T {
  const out: Partial<Candidate> = { ...c };
  if ("name" in c && typeof c.name === "string") out.name = nombreEstandar(c.name);
  if ("phone" in c && typeof c.phone === "string") out.phone = telefonoEstandar(c.phone);
  if ("email" in c && c.email != null) out.email = correoEstandar(c.email) || null;
  if ("extra_phones" in c && Array.isArray(c.extra_phones)) out.extra_phones = lista(c.extra_phones, telefonoEstandar);
  if ("extra_emails" in c && Array.isArray(c.extra_emails)) out.extra_emails = lista(c.extra_emails, correoEstandar);
  return out as T;
}
