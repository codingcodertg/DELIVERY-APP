/**
 * Marcar varias en el Gestor de Rutas, para TODO tipo de fila (Roberto, reunión del 11 nov: «be able to click on multiple
 * so I don't have to go one by one… it only works for deliveries»).
 *
 * Antes: solo las filas de ENTREGA (D) tenían casilla; las de RECOGIDA (P) —intertienda, relevos, recogidas en otra
 * tienda— no se podían marcar. Y la barra de seleccionadas solo contaba lo que se puede repartir HOY (del día y en etapa
 * de ruta), así que una orden de otra fecha, sin fecha («Fecha pendiente») o ya en camino ni siquiera hacía aparecer la
 * barra para reprogramarla.
 *
 * Ahora se marca cualquier fila, y cada acción en bloque decide con su propia regla qué hace y qué salta (y lo dice):
 * repartir sigue siendo solo lo de este día en etapa de ruta; reprogramar, lo que `puedeReprogramar` permita.
 */

/** Cómo está la casilla de una fila que agrupa varias órdenes (una recogida puede llevar varias). */
export function estadoDeGrupo(ids: readonly string[], marcadas: ReadonlySet<string>): "todas" | "algunas" | "ninguna" {
  if (ids.length === 0) return "ninguna";
  const n = ids.filter((id) => marcadas.has(id)).length;
  return n === 0 ? "ninguna" : n === ids.length ? "todas" : "algunas";
}

/** Pulsar la casilla de una fila de varias: si estaban todas marcadas, se desmarcan; si no, se marcan todas. */
export function alternaGrupo(marcadas: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const n = new Set(marcadas);
  const todas = estadoDeGrupo(ids, marcadas) === "todas";
  for (const id of ids) { if (todas) n.delete(id); else n.add(id); }
  return n;
}

/** Lo marcado en cualquier tabla (las dos selecciones del Gestor), de cualquier fecha, tipo o etapa. */
export function lasMarcadas<T extends { id: string }>(
  ordenes: readonly T[], seleccion: ReadonlySet<string>, marcadas: ReadonlySet<string>,
): T[] {
  return ordenes.filter((d) => seleccion.has(d.id) || marcadas.has(d.id));
}

/** De lo marcado, lo que se puede REPARTIR: de este día y en una etapa de ruta (el motor planifica un día). */
export function lasRepartibles<T extends { delivery_date?: string | null; stage: string }>(
  marcadas: readonly T[], dia: string, etapasDeRuta: readonly string[],
): T[] {
  return marcadas.filter((d) => d.delivery_date === dia && etapasDeRuta.includes(d.stage));
}
