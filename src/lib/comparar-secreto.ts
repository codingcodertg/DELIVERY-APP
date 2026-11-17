import { createHash, timingSafeEqual } from "node:crypto";

// SOLO SERVIDOR. Compara dos secretos en tiempo constante. Se comparan los SHA-256 y no los textos: los dos digests
// miden lo mismo, así que `timingSafeEqual` no necesita conocer de antemano la longitud del secreto, y una longitud
// distinta no se nota por el tiempo de respuesta.
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
