/**
 * Quién está trabajando AHORA, para la hoja de Nómina. La sección «Trabajando ahora» salió de Nómina el
 * 2026-11-25: el estado vive ahora en el nombre de cada persona (verde o gris) y en el orden (los que trabajan,
 * primero; `trabajando-primero.ts`). Esta función es la misma definición de siempre, sin cambios.
 */

/**
 * Quién está activo AHORA: los del cronómetro (sus sesiones en vivo, `liveSessions`) y los que fichan
 * (en turno, `getCrewNow().onClock`). Sin «inactivo» ni «última vez»: lo que no está en el conjunto no trabaja ahora.
 */
export function idsActivosAhora(
  sesiones: readonly { employeeUid: string }[],
  fichandoAhora: readonly { employeeId: string }[],
): Set<string> {
  return new Set([...sesiones.map((s) => s.employeeUid), ...fichandoAhora.map((p) => p.employeeId)]);
}
