/**
 * El filtro de chofer del Gestor de Rutas y de «Ruta de hoy» son las CASILLAS del panel «Choferes y rutas» (D-481).
 *
 * El dueño, 2026-10-06 (dictado, literal): «so when clickin the checkbox just show the driver dont show any other drivers
 * and the checkbox, remove the all driver dropdown».
 *
 * Hasta aquí había dos cosas distintas (D-393): un desplegable «Todos los choferes» en la barra de vistas, que ESCONDÍA a
 * los demás, y la casilla de cada chofer en el panel, que solo RESALTABA (los demás se atenuaban). El dueño quiere una sola:
 * marcar un chofer enseña SOLO a ese chofer —su fila del panel, su tarjeta, su tabla, su ruta en el mapa— y los demás no
 * salen; con varios marcados, esos; sin ninguno marcado, todos. El desplegable se va.
 *
 * Lo marcado se recuerda por persona en este navegador, como se recordaba el desplegable (misma razón que D-393: la lista
 * de claves de `user_prefs` está cerrada en la base). La clave es nueva: lo guardado por el desplegable (un solo nombre) se
 * deja donde estaba y se ignora.
 */

/** La clave del navegador, por persona. */
export const claveDeMarcados = (userId: string): string => `rtg_routes_marcados_${userId}`;

/** Lo guardado: una lista de claves de ruta (nombres de chofer o de ruta temporal). Sin nada, o roto, vacío = todos. */
export function leeMarcados(leer: (clave: string) => string | null, userId: string): string[] {
  try {
    const v = leer(claveDeMarcados(userId));
    if (!v) return [];
    const lista: unknown = JSON.parse(v);
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120).slice(0, 50) : [];
  } catch { return []; }
}

/** Guarda lo marcado; sin nada marcado BORRA la clave, para que el defecto (todos) siga siendo el defecto. */
export function guardaMarcados(almacen: () => { setItem(k: string, v: string): void; removeItem(k: string): void }, userId: string, marcados: ReadonlySet<string>): void {
  try {
    if (marcados.size === 0) almacen().removeItem(claveDeMarcados(userId));
    else almacen().setItem(claveDeMarcados(userId), JSON.stringify([...marcados]));
  } catch { /* sin almacenamiento, lo marcado dura lo que la pantalla */ }
}

/**
 * Lo marcado que MANDA ahora: solo las rutas que siguen en la pantalla. Un chofer marcado que ya no está (se fue, se
 * renombró, los usuarios aún no cargaron) no cuenta — si contara, la pantalla se quedaría vacía sin decir por qué. Lo
 * marcado NO se borra por esto: cuando vuelva, vuelve a valer.
 */
export function marcadosVigentes(marcados: ReadonlySet<string>, rutas: readonly string[]): Set<string> {
  // «Ninguno» (D-488) ya no existe (D-566): lo guardado con él se lee como nada, o sea todos.
  const enPantalla = new Set(rutas);
  return new Set([...marcados].filter((m) => enPantalla.has(m)));
}

/** ¿Se enseña esta ruta? Sin nada marcado, todas; con algo marcado, solo las marcadas. */
export function pasaElFiltro(marcados: ReadonlySet<string>, ruta: string | null | undefined): boolean {
  return marcados.size === 0 || (ruta != null && marcados.has(ruta));
}

/** Hay choferes marcados: lo que no es de ninguno (lo sin chofer en el mapa) tampoco sale. */
export const soloAlgunos = (marcados: ReadonlySet<string>): boolean => marcados.size > 0;

/** Marcar o desmarcar una ruta. Devuelve un conjunto nuevo. */
export function alternaMarcado(marcados: ReadonlySet<string>, clave: string): Set<string> {
  const n = new Set(marcados);
  if (n.has(clave)) n.delete(clave); else n.add(clave);
  return n;
}

/** Para quien solo entiende UN chofer de filtro (el recuadro «Elige conductor», D-395): el único marcado, o ninguno (""). */
export function unicoMarcado(marcados: ReadonlySet<string>): string {
  return marcados.size === 1 && !marcados.has(NINGUNO) ? [...marcados][0] : "";
}

/*
 * D-488. El dueño, 2026-10-06 (dictado): «cuando elijo un conductor […] solo se elige uno. Pero quiero que estén los tres y
 * que yo pueda apretar uno. Y si quiero elegir los tres y que los tres vayan apareciendo. Y si no los elijo, no aparece en el
 * mapa. Hay una opción arriba que diga elegir todos».
 *
 * Lo que fallaba: al marcar un chofer el PANEL también escondía a los demás (D-481), así que no quedaba casilla para marcar
 * un segundo. Ahora el panel siempre lista a todos, y su casilla dice si esa ruta SE VE: marcada se ve, desmarcada no. Sin
 * nada guardado se ven todas (todas marcadas). Desmarcarlas todas es posible —«Ninguno»— y entonces no se ve ninguna.
 * Arriba, la casilla «Todos» las marca o desmarca de una vez.
 */

/** Lo que D-488 guardaba al desmarcar todas. Desde D-566 solo se lee para IGNORARLO: no es una clave de ruta. */
export const NINGUNO = "__ninguno__";

/*
 * D-566. El dueño, 2026-10-15 (literal): «in routes manager, deselect mean select all so if no driver is selected but
 * empty means all always» y «and if empty is all all boxes are empty but if you press a driver it will select just that
 * driver». Revierte la parte de D-488 que permitía «Ninguno» (no ver a nadie) y la casilla como «se ve»: ahora la casilla
 * es «marcado». Sin ninguna marcada se ven TODAS y las casillas van vacías; marcar una enseña solo esa; marcar varias,
 * esas; desmarcar la última vuelve a todas. «Todos» arriba está marcada cuando no hay ninguna marcada y, pulsada, las
 * desmarca todas (= todas a la vista). Un valor «Ninguno» guardado en el navegador se ignora.
 */

/** Las rutas que se ven: sin nada marcado, todas; si no, las marcadas. */
export function rutasVisibles(marcados: ReadonlySet<string>, rutas: readonly string[]): Set<string> {
  const m = marcadasAProposito(marcados);
  if (m.size === 0) return new Set(rutas);
  return new Set(rutas.filter((r) => m.has(r)));
}

/** La casilla de una ruta: marcada <-> no marcada. Sin ninguna marcada, se ven todas (D-566). */
export function alternaVisible(marcados: ReadonlySet<string>, _rutas: readonly string[], clave: string): Set<string> {
  return alternaMarcado(marcadasAProposito(marcados), clave);
}

/** ¿Se ven todas? Solo cuando no hay ninguna marcada; es lo que marca la casilla «Todos». */
export function seVenTodas(marcados: ReadonlySet<string>, _rutas: readonly string[]): boolean {
  return marcadasAProposito(marcados).size === 0;
}

/** La casilla «Todos»: desmarca todas, que es ver todas. (Con todas ya a la vista, no cambia nada.) */
export function alternaTodas(_marcados: ReadonlySet<string>, _rutas: readonly string[]): Set<string> {
  return new Set();
}

/** Las rutas marcadas a propósito (para «Unir»): sin «Ninguno». */
export function marcadasAProposito(marcados: ReadonlySet<string>): Set<string> {
  return new Set([...marcados].filter((m) => m !== NINGUNO));
}
