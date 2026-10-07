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

/**
 * **D-NEXT — «Voy a salir» pregunta también por el VEHÍCULO.** El dueño, el 2026-10-06: al pulsar
 * «Voy a salir» tiene que salir la pregunta de visitas/mandados/viajes —que NO se quita— y además
 * si va en su vehículo personal o en uno de la empresa. Y su regla de antes: «si se le asigna un
 * vehículo, que sí ponga el odómetro; si es su carro personal, no need».
 *
 * Antes (D-455) la ventana solo preguntaba por el vehículo a quien tenía uno de la empresa
 * ASIGNADO, con una casilla «voy en el mío». Ahora se pregunta a todos, con dos respuestas, y
 * hasta que contesta no se puede seguir (`falta: "eleccion"`).
 */
export type Vehiculo = "personal" | "empresa";

/**
 * El vehículo de la empresa que sale elegido: el asignado si sigue activo; si no, el primero de
 * la lista. `null` si la empresa no tiene ninguno activo — entonces «de la empresa» no se puede
 * elegir y la pantalla lo dice.
 */
export function vehiculoDeEmpresaPorDefecto(asignado: string | null | undefined, activos: { id: string }[]): string | null {
  if (asignado && activos.some((v) => v.id === asignado)) return asignado;
  return activos[0]?.id ?? null;
}

/**
 * El motivo con el que se guarda un VIAJE que no es visita. Los de «voy a salir» son del enumerado
 * de salidas (`clockin.leave_reason`); el del viaje es texto libre, pero el panel de viajes
 * escribe `pickup` para «recoger», y una misma cosa con dos nombres se cuenta dos veces.
 */
export function motivoDeViaje(m: MotivoDeSalida): string {
  return m === "picking_up_supplies" ? "pickup" : m;
}

export type PlanDeSalida =
  | {
      ok: true;
      /** Un viaje (`startTrip`): toda visita, y toda salida en vehículo de la empresa. */
      accion: "viaje";
      viaje: { personal: boolean; vehicleId: string | null; odometer: number | null; reason: string; note: string | null };
    }
  | {
      ok: true;
      /** La salida de siempre (`startLeave`): no es visita y va en su vehículo (o a pie). */
      accion: "salida";
      salida: { reason: MotivoDeSalida; note: string | undefined };
    }
  | { ok: false; falta: "eleccion" | "vehiculo" | "odometro" };

/**
 * Qué se graba al pulsar «Voy a salir», con lo que contestó.
 *
 *  · **Sin contestar personal / empresa: nada** (`falta: "eleccion"`). Es una pregunta, no un
 *    defecto escondido.
 *  · **Empresa**: hace falta el vehículo y el cuentakilómetros de salida — `startTrip` los exige,
 *    y un vacío NO es 0 (D-136: un hueco se ve, un cero se cree). Y se graba SIEMPRE como viaje,
 *    sea o no visita: el cuentakilómetros solo tiene sitio en un viaje (`vehicle_trips`), y una
 *    salida (`exceptions`) no lo guardaría en ninguna parte.
 *  · **Personal**: ni vehículo ni cuentakilómetros. Visita → viaje personal (la respuesta queda en
 *    el viaje: `vehicle_id` nulo, como desde D-136). No visita → la salida de siempre.
 *
 * Por eso no hace falta columna nueva: «empresa» siempre deja un viaje con su vehículo, y una
 * salida sin viaje es, por construcción, sin vehículo de la empresa.
 */
export function planDeSalida(e: {
  vehiculo: Vehiculo | null;
  vehicleId: string | null;
  odometro: string;
  visita: boolean;
  motivo: MotivoDeSalida;
  nota: string;
}): PlanDeSalida {
  if (e.vehiculo == null) return { ok: false, falta: "eleccion" };
  const nota = e.motivo === "other" ? e.nota.trim() || undefined : undefined;
  if (e.vehiculo === "personal") {
    if (e.visita) {
      return { ok: true, accion: "viaje", viaje: { personal: true, vehicleId: null, odometer: null, reason: MOTIVO_VISITA, note: null } };
    }
    return { ok: true, accion: "salida", salida: { reason: e.motivo, note: nota } };
  }
  if (!e.vehicleId) return { ok: false, falta: "vehiculo" };
  const texto = e.odometro.trim();
  const n = texto === "" ? NaN : Number(texto);
  if (!Number.isFinite(n)) return { ok: false, falta: "odometro" };
  return {
    ok: true,
    accion: "viaje",
    viaje: {
      personal: false,
      vehicleId: e.vehicleId,
      odometer: n,
      reason: e.visita ? MOTIVO_VISITA : motivoDeViaje(e.motivo),
      note: e.visita ? null : nota ?? null,
    },
  };
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
