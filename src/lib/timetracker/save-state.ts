/**
 * Cuando el cronómetro deja de guardar, tiene que decirlo (D-241).
 *
 * El incidente: la sesión del dueño caducó a media jornada. El tick de diez segundos siguió
 * corriendo y escribiendo contra Supabase, la base respondió que no —el JWT ya no valía— y
 * `writeSession` hizo lo que hace con cualquier fallo: tres reintentos y **a la cola sin
 * conexión**, devolviendo `"queued"`. Nadie mira ese valor salvo para el solape, así que el
 * reloj siguió en pantalla como si estuviera grabando durante más de quince minutos.
 *
 * La diferencia que faltaba: **una cola sirve cuando lo que falla es la red, y no sirve para
 * nada cuando lo que falla es la autenticación.** Sin red, el patch se guarda y sale al volver
 * la conexión. Sin sesión, ese patch no va a salir nunca por sí solo, y encolarlo es
 * exactamente lo que convierte un fallo en silencio.
 *
 * Aquí vive solo lo que hace falta para CONTARLO. Reconocer el fallo no vive aquí: eso ya lo
 * sabe hacer `isAuthDenied` (`session-guard.ts`), que además conoce el caso de 081 —sin sesión
 * la petición sale como `anon` y Postgres corta con "permission denied for schema
 * timetracker", que no dice "row-level security" por ningún lado—. Escribir un segundo
 * reconocedor habría sido volver a tener dos respuestas para una pregunta.
 */

/** El reloj de pantalla, en horas y minutos locales, para decir DESDE CUÁNDO no se guarda. */
export function horaCorta(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Cuántos minutos de los que enseña el reloj **no están guardados**.
 *
 * El aviso dice una hora, pero lo que le duele a quien lo lee es el número de minutos que va a
 * perder. Se cuenta desde el último guardado bueno, no desde el primer fallo: entre uno y otro
 * puede haber entrado un reintento. Nunca negativo, por si el reloj del equipo se movió.
 */
export function minutosSinGuardar(desdeMs: number, ahoraMs: number): number {
  return Math.max(0, Math.floor((ahoraMs - desdeMs) / 60_000));
}
