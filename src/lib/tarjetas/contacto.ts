/**
 * Los datos de contacto de la tarjeta, validados antes de hacer un enlace con ellos. Lo que no es válido no sale
 * como `tel:`, `mailto:` o `wa.me`: es mejor un botón que no aparece que uno que marca algo raro.
 */

/** Teléfono → «+<dígitos>» (7 a 15 dígitos), o null. Acepta espacios, guiones y paréntesis. */
export function telefonoValido(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = texto.trim();
  if (!/^\+?[0-9\s().-]+$/.test(t)) return null;
  const digitos = t.replace(/\D/g, "");
  if (digitos.length < 7 || digitos.length > 15) return null;
  return `+${digitos}`;
}

export function enlaceLlamar(texto: string | null | undefined): string | null {
  const n = telefonoValido(texto);
  return n ? `tel:${n}` : null;
}

export function enlaceMensaje(texto: string | null | undefined): string | null {
  const n = telefonoValido(texto);
  return n ? `sms:${n}` : null;
}

/** WhatsApp: `wa.me` quiere solo dígitos, sin el «+». */
export function enlaceWhatsApp(texto: string | null | undefined, mensaje: string): string | null {
  const n = telefonoValido(texto);
  if (!n) return null;
  return `https://wa.me/${n.slice(1)}?text=${encodeURIComponent(mensaje)}`;
}

const CORREO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function correoValido(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const c = texto.trim();
  if (c.length > 254 || !CORREO.test(c)) return null;
  return c;
}

export function enlaceCorreo(texto: string | null | undefined): string | null {
  const c = correoValido(texto);
  return c ? `mailto:${c}` : null;
}

/** Un enlace de solo https (la web, las redes, las reseñas, los mapas). Cualquier otra cosa devuelve null. */
export function enlaceHttps(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
