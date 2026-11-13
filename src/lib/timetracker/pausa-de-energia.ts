/**
 * Un parpadeo de energía no termina la jornada (D-510).
 *
 * El escritorio reenvía cuatro avisos de `powerMonitor` a la página: `lock-screen`, `suspend`,
 * `unlock-screen` y `resume`. Hasta ahora la página reaccionaba a los dos primeros parando el
 * cronómetro, y **a los dos últimos no reaccionaba**: un bloqueo de nueve segundos cerraba la
 * sesión para siempre, sin nota que lo distinguiera de un Stop a mano y sin reanudar al volver.
 *
 * Medido el 2026-10-10 en la laptop del dueño, con el registro de sucesos de Windows contra las
 * filas de `timetracker.sessions` (hora local = Chicago − 1 h):
 *
 * | la sesión cortó | Windows registró |
 * |---|---|
 * | 12:16:40 CT | `Critical Battery Trigger Met` 11:16:38 → bloqueo 11:16:39 → **desbloqueo 11:16:48** |
 * | 14:57:00 CT | `Critical Battery Trigger Met` 13:56:58 → bloqueo 13:56:59 → **desbloqueo 13:57:05** |
 *
 * Nueve segundos y seis segundos. Entre medias, 14 `Power source change` en tres horas: el cargador
 * de esa máquina no aguantaba. Eso es avería de hardware y no se arregla aquí. Lo que sí es nuestro
 * es el precio que cobró el app por ello: los dos cortes costaron **16 y 31 minutos** sin grabar,
 * porque nadie reanudó y el dueño tardó en darse cuenta.
 *
 * La regla que queda:
 *
 * - `lock-screen` / `suspend` → **se anota el instante y no se para.** Lo que se para es pagar.
 * - `unlock-screen` / `resume` dentro de la gracia → **sigue la misma sesión**, y los segundos de
 *   fuera se suman al contador de inactividad, que `netSeconds` resta de `durationSeconds`. Es
 *   decir: no se cobran, pero la jornada no se rompe.
 * - Más allá de la gracia → **ya no se para** (2026-11-05). Se cierra la fila tal como
 *   quedó en su último latido antes de dormir y el reloj **sigue en una fila nueva que empieza
 *   al volver**. El sueño no se paga (D-098): no cae en ninguna fila. Antes aquí se paraba, con
 *   un aviso de cinco segundos que nadie veía, y la persona seguía trabajando creyendo que el
 *   reloj corría. Medido en la laptop del dueño el 2026-11-05 (Kernel-Power 506/507): standby
 *   14:20:52–14:27:04 → la sesión paró a las 14:27:07 y no volvió hasta un Start a mano a las
 *   14:35:10; standby 16:32:55–18:09:19 → paró al despertar y no hubo nada guardado hasta que
 *   reabrió el app a las 18:43:57. Unos 43 minutos trabajados sin fila entre los dos.
 * - Si la máquina nunca vuelve (se apagó), no llega ningún aviso y la cierra el cron por falta de
 *   latido, en el último que hubo — como mucho diez segundos después del bloqueo.
 *
 * Por qué la gracia es de cinco minutos y no de uno: lo que se protege es «estaba sentado ahí»,
 * y una suspensión por batería crítica, un cambio de cargador o un salvapantallas tardan más de
 * un minuto en resolverse más veces de las que uno cree. Pasada la gracia, parar es lo correcto:
 * a los cinco minutos de pantalla bloqueada la persona se fue de verdad.
 *
 * Aquí vive solo la decisión, sin React y sin Electron, porque es la que acaba en la base: estos
 * segundos entran en `duration_seconds`, que es de lo que se cobra. La parte que escucha el puente
 * del escritorio está en `src/components/timetracker/Cronometro.tsx`.
 */

/** Hasta aquí, volver no rompe la jornada. Pasado esto, la persona se fue. */
export const GRACIA_DE_ENERGIA_MS = 5 * 60_000;

/** Los cuatro avisos que reenvía `desktop/main.js`. Cualquier otra cosa no es asunto nuestro. */
export const SE_VA: readonly string[] = ["lock-screen", "suspend"];
export const VUELVE: readonly string[] = ["unlock-screen", "resume"];

/** Qué hacer con el cronómetro. `fueraSegundos` siempre se suma a inactividad: no se paga. */
export type AccionDeEnergia =
  | { tipo: "nada" }
  | { tipo: "pausa"; desdeMs: number }
  | { tipo: "sigue"; fueraSegundos: number }
  | { tipo: "fila-nueva"; fueraSegundos: number };

export function accionDeEnergia(args: {
  /** El aviso tal como llega del puente, sin normalizar. */
  evento: string;
  ahoraMs: number;
  /** Cuándo se bloqueó, o `null` si no hay pausa abierta. */
  pausadoDesdeMs: number | null;
  /** ¿Hay cronómetro corriendo? Sin sesión viva no hay nada que pausar ni que parar. */
  corriendo: boolean;
  graciaMs?: number;
}): AccionDeEnergia {
  const { evento, ahoraMs, pausadoDesdeMs, corriendo, graciaMs = GRACIA_DE_ENERGIA_MS } = args;

  if (SE_VA.includes(evento)) {
    if (!corriendo) return { tipo: "nada" };
    // Un segundo `lock-screen` sin desbloqueo entre medias (Windows manda los dos avisos en
    // algunas suspensiones) no reinicia el reloj de la pausa: se conserva el primero, que es el
    // instante en que la persona dejó de estar.
    if (pausadoDesdeMs != null) return { tipo: "nada" };
    return { tipo: "pausa", desdeMs: ahoraMs };
  }

  if (!VUELVE.includes(evento)) return { tipo: "nada" };
  // Un `resume` sin pausa abierta es el que llega al arrancar la máquina con el app ya puesto, o
  // tras un Stop a mano. No hay nada que reanudar y no se inventa tiempo fuera.
  if (pausadoDesdeMs == null || !corriendo) return { tipo: "nada" };

  // El reloj de pared puede ir hacia atrás (ajuste de hora, que esta misma máquina registró hoy):
  // un «fuera» negativo no resta tiempo pagado ni dispara el cierre.
  const fueraMs = Math.max(0, ahoraMs - pausadoDesdeMs);
  const fueraSegundos = Math.round(fueraMs / 1000);
  return fueraMs <= graciaMs ? { tipo: "sigue", fueraSegundos } : { tipo: "fila-nueva", fueraSegundos };
}

// ---- Sueño entre ticks (sin evento del sistema) ------------------------------------------

/**
 * Hueco entre dos ticks a partir del cual el equipo se durmió (2026-11-13).
 *
 * El reloj cuenta `ahora − inicio`, así que cualquier hueco entre ticks entra en la fila. Los
 * avisos de `powerMonitor` llegan tarde —el renderer está congelado mientras el equipo duerme—,
 * y entonces la pausa empieza al despertar y no al dormir: 8 h 25 min pagadas (D-510 no basta
 * solo). Por eso el propio tick también mira el hueco.
 *
 * El número sale del ritmo real del código, no de una cifra suelta:
 *  · el tick corre cada 1 s; una pestaña en segundo plano, estrangulada, despierta cada minuto;
 *  · las escrituras van cada 120 s (`LATIDO_DB_MS`) y los reintentos de red crecen hasta 30 s;
 *  · el cron cierra a los 15 min sin latido (`LATIDO_MAX_MS`), que es el techo de lo que el
 *    sistema ya tolera como «no se paga».
 * Cinco minutos quedan por encima de todo eso y muy por debajo de cualquier sueño real.
 */
export const HUECO_DORMIDO_MS = GRACIA_DE_ENERGIA_MS;

/**
 * ¿Se durmió el equipo entre el tick anterior y este?
 *
 * `null` si no: el primer tick, un hueco normal (un minuto de pestaña estrangulada, una caída de
 * red, cualquier cosa hasta el umbral) o un reloj que retrocedió (no se resta ni se corta nada).
 * Si sí: `ultimoLatidoMs` es el último instante en que el reloj seguro estaba corriendo. Ahí se
 * para la fila; lo que pasó después no se paga (D-098).
 */
export function suenoEntreTicks(args: {
  prevMs: number | null;
  ahoraMs: number;
  umbralMs?: number;
}): { ultimoLatidoMs: number; fueraMs: number } | null {
  const { prevMs, ahoraMs } = args;
  if (prevMs === null || !Number.isFinite(prevMs) || !Number.isFinite(ahoraMs)) return null;
  const hueco = ahoraMs - prevMs;
  if (hueco <= (args.umbralMs ?? HUECO_DORMIDO_MS)) return null;
  return { ultimoLatidoMs: prevMs, fueraMs: hueco };
}
