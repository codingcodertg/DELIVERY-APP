import type { UserRole } from "@/lib/types";

/**
 * En qué orden se pintan las pestañas de la barra para un rol (D-480).
 *
 * `TABS` tiene UN orden, el del admin, y la barra de cada rol es ese orden filtrado. Para almacén eso
 * ponía «Ruta de hoy» (`map`, que D-467 dio a todos) por delante de su propia cola, que es la pestaña que
 * para él se lee «Órdenes» (`warehouse`, `tabLabel` en TopBar). El dueño (2026-10-06): «orders before todays
 * routes for warehouse». Se reordena aquí y no moviendo la entrada en `TABS`: moverla cambiaría también la
 * barra del admin, que nadie pidió.
 *
 * Solo almacén, a propósito: el chofer tiene la misma forma (su «Órdenes» es `driver`, detrás de `map`) y
 * el dueño no lo nombró; es una pregunta para él, no una decisión de aquí.
 */
export function pestanasEnOrden<T extends { id: string }>(pestanas: readonly T[], rol: UserRole): T[] {
  if (rol !== "warehouse") return [...pestanas];
  const suya = pestanas.filter((tb) => tb.id === "warehouse");
  return [...suya, ...pestanas.filter((tb) => tb.id !== "warehouse")];
}

/**
 * Las pestañas de Entregas de la oficina (`accounting`), por ahora, y en este orden. El dueño (2026-10-06):
 * «when in office just to oredr and today route office for now». No es una segunda lista que decida nada
 * —quién entra lo sigue decidiendo `canOpenTab` sobre `TABS` (D-240), y para oficina sin contar los permisos
 * sueltos (`ROLES_CON_PESTANAS_FIJAS`)—: es lo que esa pregunta TIENE que responder para oficina, y una prueba lo
 * compara. Si alguien le da a oficina otra pestaña en `TABS`, esa prueba cae y obliga a decidirlo a sabiendas.
 */
export const PESTANAS_DE_OFICINA_POR_AHORA: readonly string[] = ["board", "map"];
