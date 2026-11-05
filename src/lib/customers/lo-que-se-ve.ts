import { claveDeFiltro, type FiltrosPorColumna } from "@/lib/orden-y-filtro";
import { filtraEmpresas, ORDENES_INICIALES } from "./cabeceras";
import { codigoDeTienda } from "./duplicados";
import { ordenarEmpresas, principalDe, type Empresa } from "./empresas";
import type { Orden } from "./reglas";

/**
 * Lo que filtra y ordena la lista de Clientes es lo que SE VE. El dueño, 2026-11-04: «Clientes: no me gustan las ocultas,
 * porque afectan los filtros y el orden».
 *
 * Había dos cosas escondidas decidiendo:
 * - **Columnas escondidas.** Un filtro o un nivel de orden puesto en una columna que luego se quitaba con «⚙ Columnas»
 *   seguía mandando: faltaban filas sin un ▾ a la vista con que quitarlo, y la lista salía en un orden que no se veía.
 *   Órdenes, la tabla de referencia, solo filtra y ordena por las columnas que se ven (D-360); aquí, igual. El filtro o el
 *   orden NO se borra: vuelve a mandar si la columna se vuelve a enseñar, como en Órdenes.
 * - **La tienda del «+N».** Desde D-673 la celda «Tienda» pinta la tienda de la fila que se enseña y «+N» por las demás.
 *   El filtro de esa columna mira todas las tiendas de la empresa (D-650, de cuando la celda las pintaba todas), así que
 *   «Tienda = Brownsville» traía a una empresa pintada como «Pharr +1», con el estado, el vendedor y el teléfono de Pharr.
 *   Ahora, con ese filtro puesto, la fila que se enseña es la de una tienda marcada (la más completa), y los demás
 *   filtros, el orden y las casillas miran esa fila. Es lo que ya hacía la pastilla de tienda de arriba.
 *
 * Puro, sin navegador: lo prueba `lo-que-se-ve.test.ts`.
 */

/** Los filtros de columna de las columnas que se ven; los de una escondida no cuentan. */
export function filtrosQueSeVen(filtros: FiltrosPorColumna, claves: readonly string[]): FiltrosPorColumna {
  const se = new Set(claves);
  return Object.fromEntries(Object.entries(filtros).filter(([k]) => se.has(k)));
}

/** Los niveles de orden de las columnas que se ven, subiendo los de debajo; sin ninguno, el de entrada (Cuenta ↑). */
export function ordenesQueSeVen(ordenes: readonly Orden[], claves: readonly string[]): Orden[] {
  const se = new Set(claves);
  const quedan = ordenes.filter((o) => se.has(o.por));
  return quedan.length ? quedan : [...ORDENES_INICIALES];
}

/**
 * Con el filtro de «Tienda» puesto, cada empresa enseña una fila de una tienda marcada: la más completa de las que pasan
 * los filtros de arriba. Si la que ya se enseña está en una tienda marcada, se queda (no salta de fila sin motivo); si
 * ninguna de las que pasan los filtros de arriba está en una tienda marcada (p. ej. la pastilla «Pharr» arriba y
 * «Brownsville» en la columna), manda la de arriba. No quita ni añade empresas: eso lo sigue haciendo `filtraEmpresas`.
 */
export function conLaTiendaFiltrada(empresas: readonly Empresa[], filtros: FiltrosPorColumna): Empresa[] {
  const marcadas = filtros.store;
  if (!marcadas || marcadas.size === 0) return [...empresas];
  const marcada = (c: Empresa["principal"]) => marcadas.has(claveDeFiltro(codigoDeTienda(c.store)));
  return empresas.map((e) => {
    if (marcada(e.principal)) return e;
    const enLasMarcadas = e.coinciden.filter(marcada);
    return enLasMarcadas.length ? { ...e, principal: principalDe(enLasMarcadas) } : e;
  });
}

/** Lo que pinta la tabla: la fila de la tienda filtrada, los filtros y el orden de las columnas que se ven. */
export function empresasQueSeVen(empresas: readonly Empresa[], filtros: FiltrosPorColumna, ordenes: readonly Orden[], claves: readonly string[]): Empresa[] {
  const vistos = filtrosQueSeVen(filtros, claves);
  // D-NEXT: `filtraEmpresas` ya mira todas las filas de cada empresa y pinta una que pasa (también la de la tienda marcada).
  return ordenarEmpresas(filtraEmpresas(empresas, vistos), ordenesQueSeVen(ordenes, claves));
}
