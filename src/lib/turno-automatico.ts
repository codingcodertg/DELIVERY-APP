// ============================================================
// Turno automático del chofer (D-831): empieza al cargar la primera orden, termina con la última entrega.
//
// El dueño: «los drivers quiero que podamos trackear con el GPS pero no están haciendo el clock in; desde que ellos
// pickup la primera carga será como que hagan clock in y los vas a trackear con el GPS hasta la última orden que
// hagan delivered: es el clock out».
//
// El turno (driver_shifts) es lo que enciende el GPS (LocationTracker, D-714), y solo desde la app Android, que es la
// única que reporta con la pantalla apagada. Por eso la regla solo decide en la app nativa: un navegador no abre ni
// cierra turnos automáticos (abriría uno sin GPS, y el teléfono con la app no lo podría rastrear, D-200 G-7).
//
// Un turno abierto a mano con el botón sigue siendo del chofer: la regla no lo cierra. Solo cierra los suyos (nota).
// ============================================================

/** La nota con la que nace un turno automático; es lo que lo distingue de uno abierto con el botón. */
export const NOTA_TURNO_AUTOMATICO = "auto: carga";

export interface OrdenParaTurno { assigned_driver: string | null; stage: string }
export interface TurnoParaRegla { note: string | null; ended_at: string | null }

/** Cuántas órdenes lleva cargadas (en camino) este chofer, por nombre: `assigned_driver` es el nombre, no el id. */
export function ordenesCargadasDe(ordenes: OrdenParaTurno[], nombre: string | null | undefined): number {
  const n = (nombre ?? "").trim();
  if (!n) return 0;
  return ordenes.filter((o) => (o.assigned_driver ?? "").trim() === n && o.stage === "picked_up").length;
}

/**
 * Qué toca hacer con el turno de este chofer ahora mismo.
 *  · «abrir»: lleva algo cargado y no tiene turno abierto.
 *  · «cerrar»: no lleva nada cargado y su turno abierto es automático.
 *  · null: nada (fuera de la app nativa, turno manual, o ya está como debe).
 */
export function decideTurnoAutomatico(x: { ordenes: OrdenParaTurno[]; nombre: string | null | undefined; turnoAbierto: TurnoParaRegla | null; nativa: boolean }): "abrir" | "cerrar" | null {
  if (!x.nativa) return null;
  const cargadas = ordenesCargadasDe(x.ordenes, x.nombre);
  if (cargadas > 0) return x.turnoAbierto ? null : "abrir";
  if (x.turnoAbierto && !x.turnoAbierto.ended_at && x.turnoAbierto.note === NOTA_TURNO_AUTOMATICO) return "cerrar";
  return null;
}
