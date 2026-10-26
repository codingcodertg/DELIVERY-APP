/**
 * Elegir varios clientes de la lista y hacerles lo mismo de golpe (D-NEXT). El dueño, 2026-10-26: «que uno pueda elegir
 * múltiple y así, y ahí asignar a tal persona». La lista pinta una fila por EMPRESA (D-666); marcarla elige TODAS sus filas
 * (una por tienda), que es lo que se guarda. Lo puro, aquí; la barra, en `BarraDeSeleccion`.
 */
export type Seleccion = ReadonlySet<number>;

/** ¿Está marcada la empresa? Solo si TODAS sus filas lo están (una a medias no sale marcada). */
export const estaMarcada = (sel: Seleccion, ids: readonly number[]): boolean => ids.length > 0 && ids.every((id) => sel.has(id));

/** Marcar o desmarcar una empresa: si estaba marcada, salen sus filas; si no, entran todas. */
export function alternaEmpresa(sel: Seleccion, ids: readonly number[]): Set<number> {
  const out = new Set(sel);
  if (estaMarcada(sel, ids)) for (const id of ids) out.delete(id);
  else for (const id of ids) out.add(id);
  return out;
}

/** «Elegir todas las visibles»: las filas de todas las empresas que deja el filtro, sumadas a lo ya elegido. */
export function marcaTodas(sel: Seleccion, empresas: readonly { filas: readonly { id: number }[] }[]): Set<number> {
  const out = new Set(sel);
  for (const e of empresas) for (const f of e.filas) out.add(f.id);
  return out;
}

/** Cuántas EMPRESAS hay elegidas (enteras o a medias), para el rótulo de la barra. */
export const empresasElegidas = (sel: Seleccion, empresas: readonly { filas: readonly { id: number }[] }[]): number =>
  empresas.filter((e) => e.filas.some((f) => sel.has(f.id))).length;
