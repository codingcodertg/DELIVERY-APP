// Clic en una fila de parada del Gestor de Rutas (P o D): solo RESALTA la orden en el mapa y en la fila.
// Marcar (la casilla) es otra cosa y no pasa por aquí.

/** Lo resaltado tras un clic en una fila con estas órdenes. Un clic sobre lo ya resaltado (mismas órdenes) lo quita. */
export function alternaResaltada(actual: ReadonlySet<string>, idsDeLaFila: readonly string[]): Set<string> {
  const ids = [...new Set(idsDeLaFila)];
  if (!ids.length) return new Set(actual);
  const igual = actual.size === ids.length && ids.every((id) => actual.has(id));
  return igual ? new Set() : new Set(ids);
}

/** Los puntos que el mapa encuadra para lo resaltado: recogida y entrega, sin los que faltan o no son coordenadas válidas
 *  (`null`/`undefined`, no finitos, o el 0,0 de un dato vacío). */
export function encuadreDeResaltadas(puntos: readonly (readonly [number, number] | null | undefined)[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of puntos) {
    if (!p) continue;
    const [lat, lng] = p;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    out.push([lat, lng]);
  }
  return out;
}

/** ¿El clic salió de un control dentro de la fila (casilla, botón, menú, enlace, la etapa)? Esos no resaltan la fila. */
export function esControlDeLaFila(origen: { closest?: (selector: string) => unknown } | null | undefined): boolean {
  return !!origen?.closest?.("input,select,button,a,textarea,label,[data-cambiar-etapa]");
}
