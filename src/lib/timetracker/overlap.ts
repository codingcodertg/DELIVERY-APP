/**
 * ¿Rechazó la base por solaparse con tiempo ya fichado? (082)
 *
 * `sessions_no_overlap` es una restricción EXCLUDE, así que Postgres responde con
 * SQLSTATE 23P01 (exclusion_violation). Importa distinguirla de un fallo de red: una
 * escritura que solapa NO va a funcionar por reintentar ni por dejarla en la cola
 * offline — la base la va a rechazar igual dentro de una hora. Reintentarla en
 * silencio es la peor de las opciones, porque el reloj sigue en pantalla como si
 * estuviera guardando.
 *
 * Se mira el código y también el nombre de la restricción: PostgREST y supabase-js
 * no siempre traen `code` con la misma forma según por dónde venga el error.
 */
export function isOverlapError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (err.code === "23P01") return true;
  const text = [err.message, err.details, err.hint].filter((x) => typeof x === "string").join(" ");
  return text.includes("sessions_no_overlap") || text.includes("exclusion constraint");
}
