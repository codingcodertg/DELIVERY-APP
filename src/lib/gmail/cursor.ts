/**
 * El cursor del Gmail: el UID del último correo procesado en la INBOX. PURO.
 *
 * El UID de IMAP solo significa algo mientras el UIDVALIDITY de la bandeja no cambie. Si cambia (Gmail reconstruyó la
 * bandeja), los UID guardados ya no apuntan a nada: se empieza de cero. Eso puede reprocesar correos viejos, pero la
 * dedupe por Message-ID (`outlook_processed`) hace que no se dupliquen candidatos.
 */

/** Los UID pendientes (mayores que el cursor), del más viejo al más nuevo, como mucho `tope`. */
export function uidsPendientes(uids: readonly number[], ultimoUid: number, tope: number): number[] {
  return uids
    .filter((u) => Number.isInteger(u) && u > ultimoUid)
    .sort((a, b) => a - b)
    .slice(0, tope);
}

/**
 * El nuevo cursor tras procesar `procesados` (en orden ascendente). Solo avanza: el máximo entre el actual y lo procesado.
 * Como la corrida se para al primer fallo de lectura, todo lo que queda por debajo del cursor ya está resuelto.
 */
export function nuevoUidCursor(anterior: number, procesados: readonly number[]): number {
  let c = anterior;
  for (const p of procesados) if (Number.isInteger(p) && p > c) c = p;
  return c;
}

/**
 * Compara el cursor guardado con el UIDVALIDITY actual. Si coinciden, se sigue con el UID guardado. Si no, el cursor se
 * reinicia a 0 (y `reinicio` avisa de ello, para el log). Si nunca hubo UIDVALIDITY guardado, también empieza en 0.
 */
export function cursorInicial(
  guardado: { uidvalidity: number | null; ultimoUid: number },
  actual: number,
): { uidvalidity: number; ultimoUid: number; reinicio: boolean } {
  if (guardado.uidvalidity === actual) return { uidvalidity: actual, ultimoUid: guardado.ultimoUid, reinicio: false };
  return { uidvalidity: actual, ultimoUid: 0, reinicio: guardado.uidvalidity !== null };
}
