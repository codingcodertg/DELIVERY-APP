// ============================================================
// Visitar clientes y tomar fotos, desde la pantalla de fichar (D-455).
//
// La parte pura de «Voy a salir»: qué se pregunta, qué viaje empieza al decir que sí, con qué
// nombre se guarda cada foto y qué botones salen mientras dura la salida. Sin red ni Supabase,
// para probarla sola; PunchPanel y TripPanel la llaman y las acciones de servidor (runner.ts,
// leave.ts) son las de siempre.
//
// Una foto de visita ES una parada: `logStop` ya guarda foto, hora del servidor, GPS, dirección y
// millas desde el punto anterior en `clockin.trip_stops`. No se inventa otro almacén.
// ============================================================

/** El motivo con el que empieza la salida cuando contesta que SÍ visita a un cliente. */
export const MOTIVO_VISITA = "customer_visit" as const;

/**
 * Los motivos que se ofrecen cuando contesta que NO. Son valores del enumerado
 * `clockin.leave_reason` (072) — la columna `exceptions.reason` no admite otros — menos los dos
 * que no pintan nada aquí: `customer_visit` (acaba de decir que no) y `lunch` (tiene su botón).
 */
export type MotivoDeSalida = "delivery" | "picking_up_supplies" | "moving_between_stores" | "personal_emergency" | "other";
export const MOTIVOS_DE_SALIDA: readonly MotivoDeSalida[] = [
  "delivery", "picking_up_supplies", "moving_between_stores", "personal_emergency", "other",
];

/**
 * Sin vehículo de la empresa asignado, la persona va en el suyo: el viaje nace «personal» (ni
 * vehículo ni cuentakilómetros). Es lo que dice la ficha de Usuarios: «sin vehículo asignado =
 * usa el suyo». Con uno asignado nace con ese vehículo, y puede desmarcarlo.
 */
export function viajePersonalPorDefecto(vehiculoAsignado: string | null | undefined): boolean {
  return !vehiculoAsignado;
}

export type PlanDeVisita =
  | { ok: true; viaje: { personal: boolean; vehicleId: string | null; odometer: number | null; reason: typeof MOTIVO_VISITA } }
  | { ok: false; falta: "odometro" };

/**
 * El viaje que empieza al contestar «sí, visito a un cliente».
 *
 *  · Sin vehículo asignado, o marcando «voy en el mío»: viaje personal. Nada que rellenar.
 *  · Con vehículo de la empresa: hace falta el cuentakilómetros de salida — `startTrip` lo exige,
 *    y un vacío NO se convierte en 0 (D-136: un hueco se ve, un cero se cree).
 */
export function planDeVisita(e: { vehiculoAsignado: string | null; enPropio: boolean; odometro: string }): PlanDeVisita {
  if (e.enPropio || viajePersonalPorDefecto(e.vehiculoAsignado)) {
    return { ok: true, viaje: { personal: true, vehicleId: null, odometer: null, reason: MOTIVO_VISITA } };
  }
  const texto = e.odometro.trim();
  const n = texto === "" ? NaN : Number(texto);
  if (!Number.isFinite(n)) return { ok: false, falta: "odometro" };
  return { ok: true, viaje: { personal: false, vehicleId: e.vehiculoAsignado, odometer: n, reason: MOTIVO_VISITA } };
}

/**
 * El nombre con el que se guarda una foto. `logStop` rechaza una parada sin nombre («an unnamed
 * stop leaves the manager guessing»), y el botón de foto tiene que funcionar de un toque: si no
 * escribió nada, lleva el nombre por defecto.
 */
export function etiquetaDeFoto(nota: string, porDefecto: string): string {
  return nota.trim() || porDefecto;
}

/**
 * Qué fila de botones sale bajo el reloj, estando fichado.
 *
 *  · `descanso` — hay un almuerzo o una salida en curso: solo «ya volví».
 *  · `visita`   — hay un viaje abierto: el botón de foto, visible todo el rato.
 *  · `normal`   — «empezar almuerzo» y «voy a salir».
 *
 * El descanso manda sobre la visita: con el viaje en pausa por almuerzo `logStop` rechaza la
 * parada, así que ofrecer la foto ahí sería un botón que solo sabe fallar.
 */
export type FilaDeSalida = "descanso" | "visita" | "normal";
export function filaDeSalida(e: { descansoAbierto: boolean; viajeAbierto: boolean }): FilaDeSalida {
  if (e.descansoAbierto) return "descanso";
  if (e.viajeAbierto) return "visita";
  return "normal";
}

/**
 * «Ya volví» junto al botón de foto cierra el viaje, y eso solo puede hacerse de un toque en un
 * viaje personal: con vehículo de la empresa `endTrip` exige el cuentakilómetros de llegada, que
 * se pide en el panel de viajes de abajo.
 */
export function seCierraDeUnToque(viaje: { vehicleId: string | null }): boolean {
  return viaje.vehicleId == null;
}

/**
 * La ruta de una foto en el bucket `exception-photos`: `empresa/persona/hora.jpg`. No se cambia:
 * la política de subida (097) exige esas dos carpetas y la vista de Fotos de Auditoría (D-109)
 * busca justo ahí.
 */
export function rutaDeFoto(companyId: string | null, userId: string, ahoraMs: number): string {
  return `${companyId}/${userId}/${ahoraMs}.jpg`;
}
