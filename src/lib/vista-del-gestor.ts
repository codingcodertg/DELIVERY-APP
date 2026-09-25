/**
 * Cómo se MIRA el Gestor de Rutas (D-NEXT): con qué chofer se trabaja, y qué nace plegado. No cambia ninguna orden.
 *
 * 1 · EL FILTRO DE CHOFER. El dueño, el 2026-09-25: *«WHEN WILL ASK YOU TO SELECT WHICH DRIVER YOU WANT TO WORK»*;
 * preguntado, eligió «Filtro de chofer». Un selector arriba: «Todos» (el defecto) o un chofer / ruta temporal. Con uno
 * elegido, la lista de choferes, las tarjetas de «Rutas» y el mapa enseñan solo lo suyo. Es distinto de SELECCIONAR choferes
 * en el panel (eso resalta y atenúa el resto, y sirve para unir rutas): el filtro ESCONDE.
 *
 * Se recuerda por persona en ESTE navegador (`localStorage`, con el id de la persona en la clave), como los anchos de las
 * tablas de esta misma pantalla. No va a `user_prefs` como las columnas porque su lista de claves está cerrada en la base
 * (136/137/141) y una clave nueva es una migración; y meterlo dentro del `value` de `routes_columns` lo borraría quien
 * guarde las columnas, que escribe la fila entera.
 *
 * 2 · TODO NACE PLEGADO. El dueño, el mismo día: *«DEFAULT ALL COLLAPSE IN ROUTES for route manager»*. Las tarjetas de
 * los choferes en «Rutas» nacen plegadas, para todo el que entra, siempre: hasta hoy nacían abiertas y lo abierto o cerrado
 * NO se guardaba en ningún sitio (era estado de la pantalla), así que no hay nada guardado que pueda mandar sobre esto.
 * «Sin asignar» (su propia pestaña) sigue naciendo abierta: no es una tarjeta de chofer, y plegarla dejaría la pestaña en
 * blanco al pulsarla.
 */

export const TODOS_LOS_CHOFERES = "";

/** La clave del navegador, por persona: dos personas en la misma computadora no se pisan la elección. */
export const claveDelFiltroDeChofer = (userId: string): string => `rtg_routes_driver_filter_${userId}`;

/** Lo guardado, o «Todos». Un navegador sin almacenamiento, o que lo niega, es «Todos» — nunca un error a la vista. */
export function leeFiltroDeChofer(leer: (clave: string) => string | null, userId: string): string {
  try {
    const v = leer(claveDelFiltroDeChofer(userId));
    return typeof v === "string" && v.length <= 120 ? v : TODOS_LOS_CHOFERES;
  } catch { return TODOS_LOS_CHOFERES; }
}

/** Guarda la elección; «Todos» BORRA la clave en vez de guardar un vacío, para que el defecto siga siendo el defecto. */
/** `almacen` se pide perezoso: en algunos navegadores leer `window.localStorage` ya lanza, y eso también cae en el `catch`. */
export function guardaFiltroDeChofer(almacen: () => { setItem(k: string, v: string): void; removeItem(k: string): void }, userId: string, chofer: string): void {
  try {
    if (chofer === TODOS_LOS_CHOFERES) almacen().removeItem(claveDelFiltroDeChofer(userId));
    else almacen().setItem(claveDelFiltroDeChofer(userId), chofer);
  } catch { /* sin almacenamiento, la elección dura lo que la pantalla */ }
}

/**
 * El filtro que MANDA ahora: lo guardado si ese chofer sigue siendo una de las rutas de la pantalla; si no (se fue, se
 * renombró, o los usuarios aún no han cargado), «Todos». Lo guardado NO se borra por esto: cuando cargan los usuarios,
 * vuelve a valer. Un filtro a un chofer que no existe dejaría la pantalla vacía sin decir por qué.
 */
export function filtroVigente(guardado: string, rutas: readonly string[]): string {
  return guardado !== TODOS_LOS_CHOFERES && rutas.includes(guardado) ? guardado : TODOS_LOS_CHOFERES;
}

/** ¿Se enseña esta ruta (clave de chofer o de ruta temporal) con este filtro? */
export function pasaElFiltroDeChofer(filtro: string, ruta: string | null | undefined): boolean {
  return filtro === TODOS_LOS_CHOFERES || ruta === filtro;
}

/** La tarjeta de «Sin asignar» dentro de su pestaña. */
export const PANEL_SIN_ASIGNAR = "__unassigned__";

/** Qué nace plegado: toda tarjeta de chofer. «Sin asignar», no. */
export const nacePlegada = (id: string): boolean => id !== PANEL_SIN_ASIGNAR;

/** Plegada = lo que nace, salvo que la persona la haya pulsado en esta visita (`alternadas`). */
export const estaPlegada = (id: string, alternadas: ReadonlySet<string>): boolean => nacePlegada(id) !== alternadas.has(id);
