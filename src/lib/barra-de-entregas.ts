import type { UserRole } from "./types";

// ============================================================
// La barra de Entregas del chofer (D-545). El dueño, 2026-10-13, con dos capturas de la app en el teléfono de
// Ernesto Castillo:
//   «pretrip inspection goes into the dropdown del name donde esta teaching mode»
//   «el notification icon que vaya arriba al lado de rdz deliveries y el name ya no sera el name solo el bubbl eocn las
//    iniciales ya ete habia pedido eso»
//
// Aquí, puro y sin React, lo que decide la barra (`components/TopBar.tsx`) sobre las pestañas:
//   · `PESTANAS_DEL_MENU_DEL_NOMBRE` — las pestañas que no van en la fila sino dentro del menú del nombre.
//   · `vaEnElMenuDelNombre` y `pestanasDeLaFila` — la fila, sin ellas.
// Quién VE la inspección no cambia: lo sigue diciendo `canOpenTab` sobre `TABS` (D-240; chofer y admin, D-521), y la
// ruta `/inspection` sigue siendo una pestaña para `TabGate`. Solo cambia DÓNDE se pinta su puerta. La opción del menú
// la pone `opcionesDelMenuDeCuenta` (`account-menu.ts`) con esta misma lista y la misma `canOpenTab`, así que la
// inspección sale en un sitio o en el otro, nunca en los dos ni en ninguno.
//
// Lo de la campana y la burbuja es solo CSS (`globals.css`, el bloque del teléfono de D-545), copiado de lo que D-528
// hizo en Time Tracker: no hay nada que decidir por rol, y por eso no está aquí.
// ============================================================

/** Las pestañas que van en el menú del nombre, junto a «Modo enseñanza», en vez de en la fila. */
export const PESTANAS_DEL_MENU_DEL_NOMBRE = ["inspection"] as const;

export function vaEnElMenuDelNombre(id: string): boolean {
  return (PESTANAS_DEL_MENU_DEL_NOMBRE as readonly string[]).includes(id);
}

/** Las pestañas visibles menos las que van en el menú del nombre, en el mismo orden. No muta la entrada. */
export function pestanasDeLaFila<T extends { id: string }>(visibles: readonly T[]): T[] {
  return visibles.filter((tb) => !vaEnElMenuDelNombre(tb.id));
}

/**
 * ¿Se pintan en «Mi ruta» la tarjeta del plan publicado («▸ Orden planeado del día…», D-324) y el aviso amarillo de que
 * la ruta cambió desde que se publicó (D-341)? **No para el chofer** (D-545). El dueño, 2026-10-13: «remove that yellow
 * message is not require for the driver» y «also take plan order of the day for driver».
 *
 * Se mira el rol de QUIEN MIRA (el efectivo, `me.role`), no el del chofer de la ruta: la misma página es la pestaña
 * «🚚 Chofer» del admin (D-502), que mira la ruta de un chofer y sigue viendo las dos tarjetas —ahí sí sirven: dicen a la
 * oficina qué se movió tras publicar—. El admin «viendo como» chofer ve lo que ve el chofer. Sin rol (aún sin cargar), no
 * se pintan.
 */
export function muestraElPlanEnMiRuta(rolDeQuienMira: UserRole | null | undefined): boolean {
  return !!rolDeQuienMira && rolDeQuienMira !== "driver";
}
