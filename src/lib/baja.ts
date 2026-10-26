// D-NEXT · Un dado de baja ya no sale en ninguna app.
// El dueño: «una vez se le da de baja, ya no tiene que volver a salir en ninguna de las aplicaciones».
//
// `public.profiles.left_at` (migración 205) copia la `date_left` del expediente de RR. HH. Nula = activo. Una fecha
// futura sigue activa hasta ese día: la baja cuenta desde el día que dice, en hora de Brownsville (D-632), no del
// aparato ni UTC. Esta es la ÚNICA regla; `estadoEmpleado` de RR. HH. la usa también.
//
// Qué se esconde y qué no: solo las listas y selectores de gente *actual* (elegir chofer, vendedor, contacto, a quién
// asignar). Lo histórico —el nombre del chofer de una orden vieja, una nómina de un periodo pasado— sigue buscando
// en la lista completa: por eso los proveedores cargan a todos y los selectores pasan por `soloActivos`.

import { hoyEnBrownsville } from "@/lib/recruiting/hora-de-brownsville";

/** ¿Está de baja hoy? `left_at` es «AAAA-MM-DD» o nula; `hoy`, el día de Brownsville. */
export function estaDadoDeBaja(leftAt: string | null | undefined, hoy: string = hoyEnBrownsville()): boolean {
  const fecha = (leftAt ?? "").trim().slice(0, 10);
  return fecha !== "" && fecha <= hoy;
}

/** Los que siguen activos hoy. */
export function soloActivos<T extends { left_at?: string | null }>(filas: readonly T[], hoy: string = hoyEnBrownsville()): T[] {
  return filas.filter((f) => !estaDadoDeBaja(f.left_at, hoy));
}

/** El mismo filtro para PostgREST: `.or(filtroActivos())` deja fuera a quien ya está de baja hoy. */
export function filtroActivos(hoy: string = hoyEnBrownsville()): string {
  return `left_at.is.null,left_at.gt.${hoy}`;
}
