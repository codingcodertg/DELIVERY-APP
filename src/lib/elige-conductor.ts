/**
 * «Elige conductor para N órdenes» (D-395), en «Sin asignar» del Gestor de Rutas.
 *
 * El dueño, el 2026-09-25: *«WHEN WILL ASK YOU TO SELECT WHICH DRIVER YOU WANT TO WORK»*. Se le hizo el filtro de chofer
 * (D-393) y, al verlo, dijo *«aún no me dice elige conductores para asignar conductores»*. Entre tres opciones eligió
 * «Preguntar al asignar»: en cuanto hay órdenes marcadas aparece un recuadro con los choferes como opciones de radio,
 * cada uno con su carga del día, y un botón «Asignar» que solo se activa con uno elegido.
 *
 * Aquí vive lo que decide el recuadro, sin pantalla: qué choferes salen, en qué orden, con qué números, y cuál está
 * elegido. La pantalla (`routes/page.tsx`) solo lo pinta.
 */

/** Una ruta a la que se puede asignar: un chofer de verdad o una ruta temporal (D-393 las llama igual, «lanes»). */
export interface RutaAsignable { clave: string; etiqueta: string; esRuta: boolean }

export interface OpcionDeConductor extends RutaAsignable {
  /** Paradas del día: el mismo número que el 📦 del panel «Choferes y rutas». */
  paradas: number;
  /** Pallets cargados y capacidad del camión: el mismo «12/26» del panel. */
  pallets: number;
  capacidad: number;
  /** De vacaciones, enfermo o en taller ese día: sale, marcado, porque asignarle a mano sigue siendo decisión de quien asigna. */
  noDisponible: boolean;
  /** Es el chofer del filtro de arriba (D-393): va primero. */
  delFiltro: boolean;
}

/**
 * Las opciones del recuadro. Salen TODOS los choferes y rutas temporales, aunque haya filtro: el filtro dice con quién se
 * trabaja, no a quién se puede asignar. El del filtro va primero; el resto, en el orden de siempre (el del panel).
 */
export function opcionesDeConductor(e: {
  rutas: readonly RutaAsignable[];
  paradasDe: (clave: string) => number;
  palletsDe: (clave: string) => number;
  capacidadDe: (clave: string) => number;
  noDisponibles: ReadonlySet<string>;
  filtro: string;
}): OpcionDeConductor[] {
  const opciones = e.rutas.map((r) => ({
    ...r,
    paradas: e.paradasDe(r.clave),
    pallets: e.palletsDe(r.clave),
    capacidad: e.capacidadDe(r.clave),
    noDisponible: e.noDisponibles.has(r.clave),
    delFiltro: e.filtro !== "" && r.clave === e.filtro,
  }));
  return [...opciones.filter((o) => o.delFiltro), ...opciones.filter((o) => !o.delFiltro)];
}

/**
 * Cuál está elegido ahora. Lo que la persona pulsó, si sigue entre las opciones; si no pulsó nada, el del filtro (así
 * «trabajo con Diego» y «asigna a Diego» son un clic); si no hay filtro, ninguno — y «Asignar» sigue apagado.
 */
export function eleccionVigente(pulsada: string | null, opciones: readonly OpcionDeConductor[]): string | null {
  if (pulsada != null && opciones.some((o) => o.clave === pulsada)) return pulsada;
  return opciones.find((o) => o.delFiltro)?.clave ?? null;
}
