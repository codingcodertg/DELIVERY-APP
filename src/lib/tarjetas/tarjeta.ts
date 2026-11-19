import { esClaveDeTienda, type ClaveDeTienda } from "@/lib/tarjetas/datos";
import { urlPublicaDeFoto } from "@/lib/tarjetas/fotos";

/**
 * Lo que la tarjeta pública recibe de la base: solo los campos públicos de `business_card_public` y
 * `business_card_by_token` (nunca el token, el id ni quién la editó). Aquí se pasa a lo que pinta la página.
 */
export interface FilaPublica {
  slug: string;
  full_name: string;
  role_es: string | null;
  role_en: string | null;
  store: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  photo_path: string | null;
  cover_path: string | null;
}

export interface TarjetaPublica {
  slug: string;
  nombre: string;
  rolEs: string;
  rolEn: string;
  tienda: ClaveDeTienda | null;
  /** Teléfono de la persona (la línea de la tienda, si es distinta del celular). */
  telefono: string | null;
  /** Celular para llamar, escribir y WhatsApp. */
  celular: string | null;
  correo: string | null;
  fotoUrl: string | null;
  portadaUrl: string | null;
}

/** Pasa una fila de la base a la tarjeta que pinta la página. Lo que no esté bien formado se deja vacío. */
export function tarjetaPublicaDesdeFila(fila: FilaPublica, baseSupabase: string): TarjetaPublica {
  const telefono = fila.phone?.trim() || null;
  const whatsapp = fila.whatsapp?.trim() || null;
  return {
    slug: fila.slug,
    nombre: fila.full_name.trim(),
    rolEs: fila.role_es?.trim() || "",
    rolEn: fila.role_en?.trim() || fila.role_es?.trim() || "",
    tienda: esClaveDeTienda(fila.store) ? fila.store : null,
    telefono,
    celular: whatsapp || telefono,
    correo: fila.email?.trim() || null,
    fotoUrl: fila.photo_path ? urlPublicaDeFoto(baseSupabase, fila.photo_path) : null,
    portadaUrl: fila.cover_path ? urlPublicaDeFoto(baseSupabase, fila.cover_path) : null,
  };
}

/** Las iniciales de un nombre, para el círculo cuando no hay foto (máximo dos letras). */
export function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Primer nombre, para el mensaje de WhatsApp («Hola Ana, …»). */
export function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? "";
}
