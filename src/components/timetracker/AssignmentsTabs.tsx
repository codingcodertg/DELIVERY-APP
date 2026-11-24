"use client";

import { ScheduleWeek } from "./ScheduleWeek";

/**
 * /timetracker/assignments: solo el horario semanal (tt/a-hr).
 *
 * Hasta ahora esta pantalla traía dos secciones, Tarifas y Horario (D-186). Las tarifas se han
 * ido a RR. HH. («💲 Pay rates», /recruiting/tt-tarifas), donde las monta `AssignmentsPanel`.
 * Aquí queda el horario, sin conmutador.
 *
 * El nombre del componente se conserva porque la página de asignaciones y las pruebas de
 * LOCAL_MODE lo nombran así. Lo que se cambió es el montaje, no el código de ninguna sección:
 *
 *   · `AssignmentsPanel` (tarifas) sigue siendo su propio fichero, con SU lista de personas
 *     (todo el que tiene `timetracker_role`, sin tienda, sin filtrar inactivos). Lo monta
 *     /recruiting/tt-tarifas.
 *   · `ScheduleWeek` (horario) lista solo las tiendas visibles del gerente y solo gente activa
 *     (D-127). Lo monta esta pantalla.
 *
 * Las dos listas siguen siendo distintas a propósito (D-186): unificarlas hace desaparecer a
 * alguien de un desplegable sin que salte ningún error. Lee D-186 antes de tocarlo.
 */
export function AssignmentsTabs() {
  return <ScheduleWeek />;
}
