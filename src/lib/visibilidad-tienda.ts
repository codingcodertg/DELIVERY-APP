import type { Profile, UserRole } from "@/lib/types";

/**
 * Qué tiendas ve cada persona (D-315, migración 131).
 *
 * El dueño lo pidió como **seguridad**, no como comodidad: «que no puedan verlo». Así que **quien
 * decide qué llega es la política RLS de `deliveries`**, no este fichero. Aquí no hay ninguna copia de
 * esa decisión, y es a propósito: una copia en el navegador se separa de la de la base el día que
 * alguien toque una y no la otra, y entonces la pantalla y los datos dicen cosas distintas.
 *
 * Lo que sí vive aquí es lo que la base no puede saber: **a quién se le ofrece el ajuste** y **a quién
 * habría que avisar** antes de renombrar una tienda.
 */

/**
 * Los roles a los que la política 131 les aplica la tienda.
 *
 * Es la otra cara de lo que la función `tiendas_visibles()` excluye: `admin` (administra esto, nunca
 * se filtra) y `driver`/`warehouse` (tienen su propia rama en la política, y sumarles la tienda encima
 * podría dejar a un chofer sin ver su propia entrega). Una prueba compara esta lista con el `.sql`,
 * para que no se separen.
 */
export const ROLES_SIN_FILTRO_DE_TIENDA: readonly UserRole[] = ["admin", "driver", "warehouse"];

/** ¿A esta persona le aplica el límite por tienda? */
export function seFiltraPorTienda(rol: UserRole | null | undefined): boolean {
  return !!rol && !ROLES_SIN_FILTRO_DE_TIENDA.includes(rol);
}

/**
 * El nombre de una tienda, comparable: sin espacios de sobra y en minúsculas.
 *
 * Los nombres son texto libre —se escriben en Datos— así que «McAllen » y «mcallen» son la misma
 * tienda. La base normaliza igual (`lower(btrim(...))`).
 */
export function normalizaTienda(nombre: string | null | undefined): string {
  return (nombre ?? "").trim().toLowerCase();
}

/** Las tiendas marcadas de alguien, sin blancos ni repetidas, en el orden en que están guardadas. */
export function tiendasMarcadas(p: Pick<Profile, "visible_stores"> | null | undefined): string[] {
  const marcadas = p?.visible_stores ?? [];
  const vistas = new Set<string>();
  return marcadas.filter((n) => {
    const clave = normalizaTienda(n);
    if (!clave || vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
}

/**
 * ¿Esta persona ve todas las tiendas?
 *
 * Sin nada marcado, sí: es lo que pidió el dueño y lo que tienen todas las filas el día que la 131 se
 * aplique, así que aplicarla no deja a nadie a oscuras. Y quien no se filtra por su rol, también.
 */
export function veTodasLasTiendas(
  p: Pick<Profile, "role" | "visible_stores"> | null | undefined,
): boolean {
  if (!p) return true;
  return !seFiltraPorTienda(p.role) || tiendasMarcadas(p).length === 0;
}

/**
 * Quién se queda sin ver sus órdenes si esa tienda se renombra.
 *
 * Renombrar en Datos no toca `profiles.visible_stores`: las casillas guardadas seguirían apuntando al
 * nombre viejo, que ya no existe, y esas personas dejarían de ver esas órdenes **sin ningún aviso**.
 * Esto es lo que la pantalla enseña antes de dejar renombrar.
 */
export function quienPierdeLaTienda(
  usuarios: readonly Pick<Profile, "id" | "full_name" | "role" | "visible_stores">[],
  tienda: string,
): string[] {
  const buscada = normalizaTienda(tienda);
  if (!buscada) return [];
  return usuarios
    .filter((u) => seFiltraPorTienda(u.role) && tiendasMarcadas(u).some((n) => normalizaTienda(n) === buscada))
    .map((u) => (u.full_name || "").trim() || "—");
}

/** «Ana, Luis y 3 más» — para no escribir doce nombres en un aviso. */
export function nombresEnLinea(nombres: readonly string[], y: string, mas: (n: number) => string, tope = 3): string {
  if (nombres.length === 0) return "";
  if (nombres.length <= tope) {
    return nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} ${y} ${nombres[nombres.length - 1]}`;
  }
  return `${nombres.slice(0, tope).join(", ")} ${y} ${mas(nombres.length - tope)}`;
}
