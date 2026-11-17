/**
 * La clave de deduplicación de un correo de Gmail (`recruiting.outlook_processed.message_id`). PURO.
 *
 * Regla: el Message-ID del correo de Indeed, normalizado (minúsculas, sin ángulos). Así el MISMO correo llegado por la
 * regla de redirección y luego reenviado en lote tiene la misma clave y se procesa una sola vez. Si no trae Message-ID,
 * se usa el UID de la bandeja (con el UIDVALIDITY) y, dentro de un lote, el número de adjunto.
 * El prefijo `gmail:` separa estas claves de los ids de Graph de Outlook.
 */
export function claveDelCorreo(p: {
  messageId: string | null | undefined;
  uidvalidity: number;
  uid: number;
  /** Posición del .eml dentro de un mensaje reenviado en lote (solo si no trae Message-ID). */
  parte?: number;
}): string {
  const mid = (p.messageId ?? "").trim().replace(/^<|>$/g, "").trim().toLowerCase();
  if (mid) return `gmail:${mid.slice(0, 240)}`;
  const base = `gmail:uid:${p.uidvalidity}:${p.uid}`;
  return p.parte === undefined ? base : `${base}:${p.parte}`;
}
