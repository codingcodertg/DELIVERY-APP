/**
 * Los avisos del Gestor de Rutas que la persona cerró con su ✕ (D-NEXT). El dueño, el 2026-09-25, con una captura del
 * Gestor: *«que estos mensajes tengan una X para que se cierren y así no aparezcan más»*.
 *
 * CERRADO PARA SIEMPRE, no «hasta que cambie lo que dice». Los avisos de choferes sin señal y de atrasadas cambian de
 * texto casi cada día (otro chofer, otro número): cerrarlos «hasta que cambie» los haría volver al día siguiente, que es
 * justo lo que pidió que no pasara. Para recuperarlos, «Mostrar avisos ocultos» en la barra de herramientas del Gestor.
 *
 * Se recuerda por persona en ESTE navegador (`localStorage`, con el id de la persona en la clave), como el filtro de
 * chofer de D-393 y por la misma razón: `user_prefs` tiene su lista de claves cerrada en la base (136/137/141) y una clave
 * nueva es una migración; y meterlo dentro del valor de otra clave lo borraría quien guarda esa clave, que escribe la fila
 * entera (D-385/D-394). Consecuencia que se dice: en otra computadora, u otro navegador, los avisos vuelven a salir.
 */

/** Los avisos que se pueden cerrar. El id es lo que se guarda: no se renombra sin perder lo cerrado. */
export const AVISOS_DEL_GESTOR = {
  /** La barra «🧭 Armar las rutas del día automáticamente» (PlanDelDia) con su pastilla «N orden(es) sin plan». */
  armarRutas: "armar-rutas",
  /** El recuadro «N chofer(es) en turno no están reportando su ubicación». */
  choferesSinSenal: "choferes-sin-senal",
  /** La línea «N orden(es) atrasadas · N sin fecha — no son de este día. [Verlas]». */
  atrasadas: "atrasadas",
  /** El recuadro «No hay órdenes para programar en esta fecha» del día vacío. */
  diaVacio: "dia-vacio",
  /** La explicación fija bajo el mapa («Todas las rutas están en el mapa a la vez…»). */
  ayudaDelMapa: "ayuda-del-mapa",
} as const;

export type AvisoDelGestor = (typeof AVISOS_DEL_GESTOR)[keyof typeof AVISOS_DEL_GESTOR];

const CONOCIDOS: ReadonlySet<string> = new Set(Object.values(AVISOS_DEL_GESTOR));

/** La clave del navegador, por persona: dos personas en la misma computadora no se cierran los avisos la una a la otra. */
export const claveDeAvisosOcultos = (userId: string): string => `rtg_routes_hidden_notices_${userId}`;

/** Lo cerrado por esta persona. Nada guardado, basura, o un navegador que niega el almacenamiento: nada cerrado. */
export function leeAvisosOcultos(leer: (clave: string) => string | null, userId: string): Set<AvisoDelGestor> {
  try {
    const v: unknown[] = JSON.parse(leer(claveDeAvisosOcultos(userId)) ?? "[]");
    return new Set(v.filter((x): x is AvisoDelGestor => typeof x === "string" && CONOCIDOS.has(x)));
  } catch { return new Set(); }      // basura, o algo que no es una lista (no tiene `.filter`): nada cerrado
}

type Almacen = () => { setItem(k: string, v: string): void; removeItem(k: string): void };

/** Guarda la lista entera; vacía BORRA la clave, para que «nada cerrado» siga siendo el defecto. */
export function guardaAvisosOcultos(almacen: Almacen, userId: string, ocultos: ReadonlySet<AvisoDelGestor>): void {
  try {
    if (ocultos.size === 0) almacen().removeItem(claveDeAvisosOcultos(userId));
    else almacen().setItem(claveDeAvisosOcultos(userId), JSON.stringify([...ocultos].sort()));
  } catch { /* sin almacenamiento, lo cerrado dura lo que la pantalla */ }
}

/** Cerrar uno: lo de antes sigue cerrado. */
export const cierraAviso = (ocultos: ReadonlySet<AvisoDelGestor>, id: AvisoDelGestor): Set<AvisoDelGestor> => new Set([...ocultos, id]);
