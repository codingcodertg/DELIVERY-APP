/**
 * Validación de destinatarios para las rutas que llaman o mandan mensajes desde la centralita de la empresa
 * (`/api/call`, `/api/notify`). Solo lo que se decide sin red, para que la ruta y las pruebas digan lo mismo.
 *
 * Teléfono: solo números de EE. UU. (la operación es de Texas), en E.164 (`+1XXXXXXXXXX`). Se admiten los
 * separadores que escribe la gente («(214) 555-1234», «214.555.1234») y una extensión al final («ext. 5»), que
 * se descarta. Un número fuera de ese formato NO sale: sin esta comprobación cualquiera llama o escribe a
 * donde quiera desde el número de la empresa.
 */

/** Un correo con forma mínima de correo, y no más de 254 caracteres (límite práctico de RFC 5321). */
export function correoValido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const limpio = v.trim().toLowerCase();
  if (limpio.length > 254) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpio) ? limpio : null;
}

/**
 * Un teléfono de EE. UU. → `+1XXXXXXXXXX`, o `null` si no lo es. El área y la central no pueden empezar por 0 ni 1
 * (plan de numeración de Norteamérica).
 */
export function telefonoUSaE164(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Fuera la extensión («ext. 12», «x12», «#12») antes de quitar separadores, o se mezclaría con los dígitos.
  const sinExtension = v.trim().replace(/\s*(ext\.?|x|#)\s*\d+\s*$/i, "");
  if (!/^\+?[\d\s().-]+$/.test(sinExtension)) return null;
  const conMas = sinExtension.startsWith("+");
  const digitos = sinExtension.replace(/\D/g, "");
  let nacional: string;
  if (conMas) {
    if (digitos.length !== 11 || !digitos.startsWith("1")) return null;
    nacional = digitos.slice(1);
  } else if (digitos.length === 11 && digitos.startsWith("1")) {
    nacional = digitos.slice(1);
  } else if (digitos.length === 10) {
    nacional = digitos;
  } else {
    return null;
  }
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(nacional)) return null;
  return `+1${nacional}`;
}

/** Tope del texto de un SMS (varios segmentos ya cuestan dinero; por encima, no es un aviso). */
export const MAX_TEXTO_SMS = 1000;
/** Tope del asunto y del cuerpo de un correo. */
export const MAX_ASUNTO_CORREO = 200;
export const MAX_TEXTO_CORREO = 5000;
