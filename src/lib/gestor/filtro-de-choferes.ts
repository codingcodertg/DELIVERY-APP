/**
 * El filtro de chofer del Gestor de Rutas y de «Ruta de hoy» son las CASILLAS del panel «Choferes y rutas» (D-NEXT).
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
  return marcados.size === 1 ? [...marcados][0] : "";
}
