/**
 * El arranque numerado del plan (D-722, 208). El dueño: «yo agarro tres y le pongo 1, 2 y 3 a las primeras 3; entonces
 * el optimizer va a respetar eso y las va a asignar de inicio en ese orden».
 *
 * `plan_rank` es el número de cada orden. Aquí solo se decide QUÉ números se ponen: lo marcado, en el orden en que se
 * marcó, siguiendo a lo que ya estaba numerado ese día (así se puede numerar en dos tandas). Lo que ya tenía número y
 * se vuelve a marcar se renumera. Qué hace el motor con ellos vive en `route-engine/planifica.ts` (la cabeza de la ruta).
 */
export function numerosDeArranque(
  marcadas: readonly string[],
  ordenesDelDia: readonly { id: string; plan_rank?: number | null }[],
): { id: string; plan_rank: number }[] {
  const elegidas = new Set(marcadas);
  const tope = ordenesDelDia.reduce((m, o) => (!elegidas.has(o.id) && Number(o.plan_rank) > m ? Number(o.plan_rank) : m), 0);
  return marcadas.map((id, i) => ({ id, plan_rank: tope + i + 1 }));
}

/** Las numeradas de un día, en su orden: lo que enseña el chip del plan y lo que «✕» vacía. */
export function numeradasDelDia<T extends { id: string; plan_rank?: number | null }>(ordenesDelDia: readonly T[]): T[] {
  return ordenesDelDia.filter((o) => Number(o.plan_rank) > 0).sort((a, b) => Number(a.plan_rank) - Number(b.plan_rank));
}
