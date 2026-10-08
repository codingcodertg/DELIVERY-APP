import { paradasDelChofer } from "./ordenes-del-dia";
import type { Delivery, Profile, UserRole } from "./types";

/**
 * La pestaña «🚚 Chofer» del admin es la pantalla «Mi ruta» de UN chofer, tal como la ve él en su teléfono (D-NEXT).
 *
 * El dueño, 2026-10-08: «la vista de chofer quiero que sea exactamente el view de cada chofer asi como lo miran ellos el que
 * sale en el admin».
 *
 * Aquí va todo lo que decide algo, sin pantalla: a quién le toca esta vista, de qué choferes se puede elegir, cuál queda
 * elegido (y cómo se recuerda en este navegador), y cuándo «Mi ruta» es de solo lectura.
 */

/** Lo mínimo de una persona para pintar su ruta: con quién se cruza (`id`) y cómo se asignan sus órdenes (`full_name`). */
export type ChoferVisto = Pick<Profile, "id" | "full_name">;

/**
 * ¿La pestaña «Chofer» de esta persona es la ruta de un chofer elegido?
 *
 * Solo para el admin (el rol EFECTIVO: un admin con «Ver como → Chofer» ve la pestaña como un chofer, que es lo que pidió
 * al cambiar de rol). El chofer sigue con su lista de siempre, y quien tenga el permiso suelto `deliver` también: el pedido
 * habla de «el que sale en el admin».
 */
export function pestanaChoferEsRutaDeUnChofer(me: { role: UserRole } | null | undefined): boolean {
  return me?.role === "admin";
}

/**
 * ¿«Mi ruta» se pinta de solo lectura? Sí, siempre que quien mira NO es el dueño de la ruta.
 *
 * No es una opción de la pantalla: es la regla. Lo que escribe «Mi ruta» sale de quien está en la sesión y de SU teléfono:
 * el evento de la etapa y los saltos llevan su `created_by`, el aviso de rechazo dice «(<su nombre>)» (`avisosDeRechazo`),
 * y la posición de la recogida y de la entrega es la de SU navegador (`captureLocationSplit`). Un admin que pulsara
 * «Entregado» en la ruta de Carlos dejaría la entrega firmada por el admin y con el punto GPS de la oficina. Para actuar en
 * nombre de otro está «Cambiar usuario» (D-243), que sí cambia la identidad.
 * Sin saber quién mira, o sin chofer, también solo lectura: lo que no se sabe no se concede.
 */
export function rutaDeSoloLectura(me: { id: string } | null | undefined, chofer: { id: string } | null | undefined): boolean {
  if (!me || !chofer) return true;
  return me.id !== chofer.id;
}

export interface OpcionDeChofer {
  id: string;
  nombre: string;
  /** Sus paradas de hoy: la MISMA cuenta que hace «Mi ruta» con `paradasDelChofer` para pintar su lista. */
  paradasHoy: number;
}

/**
 * De quién se puede mirar la ruta: toda persona con el rol de chofer (la misma lista que el panel de choferes del Gestor,
 * D-488, que los lista a todos), por nombre. Sin nombre no hay ruta —las órdenes se asignan por nombre— y no sale.
 */
export function choferesParaVer(
  users: readonly Pick<Profile, "id" | "full_name" | "role">[],
  deliveries: readonly Delivery[],
  hoy: string,
): OpcionDeChofer[] {
  return users
    .filter((u) => u.role === "driver" && (u.full_name ?? "").trim() !== "")
    .map((u) => ({ id: u.id, nombre: u.full_name, paradasHoy: paradasDelChofer(deliveries, u.full_name, hoy, "dia").length }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** La etiqueta de cada opción del selector: «Carlos R. · 5 paradas hoy». */
export function etiquetaDeOpcion(o: OpcionDeChofer, es: boolean): string {
  const n = o.paradasHoy;
  return es ? `${o.nombre} · ${n} ${n === 1 ? "parada" : "paradas"} hoy` : `${o.nombre} · ${n} ${n === 1 ? "stop" : "stops"} today`;
}

/**
 * El chofer que se enseña: el último elegido si sigue en la lista; si no (nunca se eligió, se fue, cambió de rol), el
 * primero. Sin choferes, ninguno. Lo guardado NO se borra por no estar: si los usuarios aún no cargaron, vuelve a valer.
 */
export function choferVigente(guardado: string | null, opciones: readonly Pick<OpcionDeChofer, "id">[]): string | null {
  if (guardado && opciones.some((o) => o.id === guardado)) return guardado;
  return opciones[0]?.id ?? null;
}

/**
 * La elección se recuerda por persona en ESTE navegador, como el filtro de chofer del Gestor (`vista-del-gestor.ts`, D-393):
 * `localStorage` con el id de quien mira en la clave, para que dos admins en la misma computadora no se pisen.
 */
export const claveDelChoferVisto = (quienMira: string): string => `rtg_vista_de_chofer_${quienMira}`;

/** Lo guardado, o `null`. Un navegador sin almacenamiento, o que lo niega, es «nada guardado» — nunca un error a la vista. */
export function leeChoferVisto(leer: (clave: string) => string | null, quienMira: string): string | null {
  try {
    const v = leer(claveDelChoferVisto(quienMira));
    return typeof v === "string" && v.length > 0 && v.length <= 120 ? v : null;
  } catch { return null; }
}

/** `almacen` se pide perezoso: en algunos navegadores leer `window.localStorage` ya lanza, y eso también cae en el `catch`. */
export function guardaChoferVisto(almacen: () => { setItem(k: string, v: string): void }, quienMira: string, choferId: string): void {
  try { almacen().setItem(claveDelChoferVisto(quienMira), choferId); } catch { /* sin almacenamiento, la elección dura lo que la pantalla */ }
}
