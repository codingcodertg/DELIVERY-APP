/**
 * ¿Rechazó la base por solaparse con tiempo ya fichado? (085)
 *
 * Gemela de lib/timetracker/overlap.ts, y a propósito no compartida: cada módulo tiene
 * su propia restricción con su propio nombre, y una función que intentara servir a los
 * dos tendría que conocer los dos nombres para acabar diciendo lo mismo. Lo que sí
 * comparten es el criterio: distinguir un rechazo de la regla de un fallo de red, porque
 * el primero no se arregla reintentando y el segundo sí.
 *
 * `23P01` es exclusion_violation (el EXCLUDE de los fichajes cerrados) y `23505` es
 * unique_violation (el índice del fichaje abierto). Los dos significan lo mismo para
 * quien está delante: ese rato ya está contado.
 */
export const OVERLAP_MESSAGE =
  "Esas horas ya están fichadas. No se puede contar dos veces el mismo tramo — revisa la entrada que ya lo cubre. · Those hours are already logged; check the entry that covers them.";

export function isOverlapError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const text = [err.message, err.details, err.hint].filter((x) => typeof x === "string").join(" ");
  // El código solo NO basta: 23505 lo produce cualquier índice único, así que para ese
  // se exige además el nombre. 23P01 aquí solo puede venir de esta regla.
  if (err.code === "23P01") return true;
  if (err.code === "23505" && text.includes("time_entries_one_open_per_employee")) return true;
  return text.includes("time_entries_no_overlap") || text.includes("time_entries_one_open_per_employee");
}
