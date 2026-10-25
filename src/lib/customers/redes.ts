import type { Parche } from "./reglas";

/**
 * Las redes sociales de un cliente (D-682, migración 197). Roberto Rodriguez Jr (admin), 2026-10-25, en Clientes:
 * «Lets add a Socials tab for their Facebook, Instagram, YouTube, TikTok, Twitter, Alignable, LinkedIn», señalando el
 * sitio a la derecha de las pastillas de contactos. Una pestaña «Socials» en la tarjeta «Contacto», como una pastilla
 * más: pulsarla enseña sus perfiles, cada uno abre en otra pestaña. Se guardan en `erp.customers.socials` (jsonb, un
 * objeto red → texto). Lo escrito puede ser la URL entera o solo el usuario («@rtg», «rtg»): `urlDeRed` lo abre igual.
 */
export const REDES = ["facebook", "instagram", "youtube", "tiktok", "twitter", "alignable", "linkedin"] as const;
export type Red = (typeof REDES)[number];
export type Redes = Partial<Record<Red, string>>;
/** Lo que se escribe: las siete, con texto vacío si no hay. */
export type RedesEnEdicion = Record<Red, string>;

export const NOMBRE_DE_RED: Record<Red, string> = {
  facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", twitter: "X (Twitter)", alignable: "Alignable", linkedin: "LinkedIn",
};

/** Dónde vive un usuario de cada red, para cuando solo se escribió el usuario. */
const BASE: Record<Red, string> = {
  facebook: "https://www.facebook.com/", instagram: "https://www.instagram.com/", youtube: "https://www.youtube.com/@",
  tiktok: "https://www.tiktok.com/@", twitter: "https://x.com/", alignable: "https://www.alignable.com/", linkedin: "https://www.linkedin.com/company/",
};

/** Lo guardado, limpio: solo las redes conocidas, el texto recortado, y sin las vacías. Lo que no es un objeto, nada. */
export function normalizaRedes(x: unknown): Redes {
  const out: Redes = {};
  if (!x || typeof x !== "object" || Array.isArray(x)) return out;
  for (const k of REDES) {
    const v = (x as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** Las redes de una fila; sin la 197 (o sin nada escrito), ninguna. */
export const redesDe = (c: { socials?: unknown } | null | undefined): Redes => normalizaRedes(c?.socials);

export const hayRedes = (r: Redes): boolean => REDES.some((k) => Boolean(r[k]));

/** Para abrirlo: la URL tal cual si lo es; «facebook.com/rtg» con su https; y un usuario («@rtg» o «rtg») en su red. */
export function urlDeRed(red: Red, valor: string): string {
  const v = valor.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/i.test(v)) return `https://${v}`;
  return BASE[red] + v.replace(/^@/, "");
}

/** Lo que se enseña en la lista: el usuario corto si lo es, o la URL sin su «https://www.». */
export const textoDeRed = (valor: string): string => valor.trim().replace(/^https?:\/\/(www\.)?/i, "");

export const redesEnEdicion = (r: Redes): RedesEnEdicion =>
  Object.fromEntries(REDES.map((k) => [k, r[k] ?? ""])) as RedesEnEdicion;

/** El parche de las redes, solo si algo cambió: abrir y guardar otra cosa no reescribe unas redes que nadie tocó. */
export function parcheDeRedes(antes: Redes, editadas: RedesEnEdicion): Parche {
  const nuevas = normalizaRedes(editadas);
  if (JSON.stringify(nuevas) === JSON.stringify(normalizaRedes(antes))) return {};
  return { socials: nuevas };
}
