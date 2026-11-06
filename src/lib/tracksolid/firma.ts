import { createHash } from "node:crypto";

// ============================================================
// La firma del Open API de TrackSolid Pro (Jimi IoT) — D-NEXT.
//
// Cada llamada lleva `sign` = MD5 EN MAYÚSCULAS de  secreto + (parámetros ordenados por clave, pegados
// como clave+valor) + secreto. La hora va en UTC, «yyyy-MM-dd HH:mm:ss», y el servidor de Jimi admite
// ±10 minutos. Solo corre en el servidor: usa `node:crypto` y toca el secreto.
// ============================================================

/** «2026-11-06 14:39:26», en UTC. */
export function marcaDeTiempo(ahora: Date = new Date()): string {
  return ahora.toISOString().slice(0, 19).replace("T", " ");
}

/** La firma de un juego de parámetros (sin `sign`). */
export function firma(parametros: Record<string, string>, secreto: string): string {
  const base = Object.keys(parametros).sort().map((k) => k + parametros[k]).join("");
  return createHash("md5").update(secreto + base + secreto, "utf8").digest("hex").toUpperCase();
}
