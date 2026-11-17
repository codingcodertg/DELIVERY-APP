import { randomInt } from "node:crypto";

// SOLO SERVIDOR: usa `randomInt` de `node:crypto` (criptográfico). La regla de la contraseña vive en `contrasena-regla.ts`.

const ADJETIVOS = ["Swift", "Bright", "Bold", "Calm", "Sharp", "Quick", "Solid", "Prime", "Brave", "Clear"] as const;
const SUSTANTIVOS = ["Puma", "Falcon", "Cedar", "River", "Delta", "Comet", "Harbor", "Summit", "Maple", "Forest"] as const;
/** Letras sin las que se confunden al leerlas por teléfono (sin i, l, o). */
const LETRAS_SIN_CONFUSION = "abcdefghjkmnpqrstuvwxyz";

function elegir<T>(a: readonly T[]): T {
  return a[randomInt(a.length)];
}

/**
 * Una contraseña temporal que se puede leer por teléfono: `Palabra-Palabra-1234-xy` (p. ej. `Swift-Puma-4821-kq`).
 * Cumple la regla de `contrasena-regla.ts` (más de 10 caracteres, letras y cifras) y sale de `randomInt`, que es
 * criptográfico; antes salía de `Math.random`.
 */
export function generaContrasenaTemporal(): string {
  const cifras = String(randomInt(1000, 10000));
  const sufijo = elegir([...LETRAS_SIN_CONFUSION]) + elegir([...LETRAS_SIN_CONFUSION]);
  return `${elegir(ADJETIVOS)}-${elegir(SUSTANTIVOS)}-${cifras}-${sufijo}`;
}
