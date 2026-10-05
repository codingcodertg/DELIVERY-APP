/**
 * Que el reloj no se pare en silencio (incidente del 2026-10-04).
 *
 * Lo que pasó, medido: el dueño arrancó el cronómetro a las 15:25 en la app de escritorio. A
 * las 16:29:28 abrió «Capturas» dentro de la misma app. El tick de un segundo, el latido de
 * diez, el contador de actividad y el receptor de capturas vivían DENTRO del componente de la
 * pantalla «Registrar tiempo», así que al salir de ella murieron los cuatro sin avisar a nadie.
 * La fila se quedó viva 3 h 12 min sin un solo latido. Al volver a las 19:41 —pasado el corte
 * de las 18:30— la pantalla recién montada se paró sola con los contadores a cero y escribió
 * encima de la fila: 4,27 h con 0 s de actividad, 0 teclas y 0 clics.
 *
 * Aquí vive la lógica pura de los cuatro arreglos, para probarla sin React ni red:
 *
 *  1. `esRutaDelCronometro` / `debeMontarCronometro` — el cronómetro se monta en el layout del
 *     módulo y sigue vivo (oculto) en todas sus pantallas, no solo en la suya.
 *  2. `estadoVigia` / `tocaSonar` / `tocaReintentar` — si el reloj enseña «corriendo» y no hay
 *     un guardado bueno desde hace más de un minuto, se dice (aviso y sonido) y se reintenta.
 *  3. `parcheDeStop` — un Stop sobre una sesión que esta página NO llegó a conducir no puede
 *     escribir sus contadores (están a cero) ni su reloj (incluye el hueco): solo la cierra.
 *  4. `pararPorCorteSiToca` — el paro de las 18:30 pregunta antes de parar, en vez de tratar
 *     «todavía no pregunté» como «no exento».
 */

// ---- 1. Dónde vive el cronómetro --------------------------------------------------------

/** La pantalla «Registrar tiempo». Con o sin barra final; nada más. */
export function esRutaDelCronometro(pathname: string | null | undefined): boolean {
  const p = (pathname ?? "").replace(/\/+$/, "");
  return p === "/timetracker";
}

/**
 * ¿Se monta el cronómetro en esta pantalla del módulo?
 *
 * En la suya, siempre. En las demás, **oculto pero vivo**, salvo para el presencial que no es
 * admin: a él «Registrar tiempo» le pinta el fichaje (`PunchPanel`), que pide la ubicación al
 * montarse, y no hay ningún reloj suyo que mantener latiendo fuera de esa pantalla.
 */
export function debeMontarCronometro(args: { visible: boolean; presencial: boolean; esAdmin: boolean }): boolean {
  if (args.visible) return true;
  return !(args.presencial && !args.esAdmin);
}

// ---- 2. El vigía ------------------------------------------------------------------------

/** Sin un guardado bueno durante más de esto con el reloj corriendo, se avisa. Seis latidos. */
export const VIGIA_MAX_MS = 60_000;
/** Cada cuánto mira el vigía. Va en su propio intervalo: no depende de que el tick viva. */
export const VIGIA_CADA_MS = 5_000;
/** Cada cuánto se repite el sonido mientras siga sin guardarse. */
export const ALARMA_CADA_MS = 5 * 60_000;
/** Cada cuánto se reintenta retomar la sesión mientras nadie la conduzca. */
export const REINTENTO_CADA_MS = 20_000;

export type EstadoVigia = "ok" | "sin-latido";

/**
 * ¿El reloj que se ve corresponde a algo que se está guardando?
 *
 * `ajeno` es la sesión que conduce el otro cliente (D-096): ahí esta pantalla no escribe a
 * propósito y no hay nada que vigilar. `ultimoGuardadoMs === null` es «todavía no hay con qué
 * comparar» y no alarma: quien arranca, adopta o monta con miga pone el suelo en ese momento.
 */
export function estadoVigia(args: {
  corriendo: boolean;
  ajeno: boolean;
  ultimoGuardadoMs: number | null;
  ahoraMs: number;
  maxMs?: number;
}): EstadoVigia {
  if (!args.corriendo || args.ajeno) return "ok";
  if (args.ultimoGuardadoMs === null) return "ok";
  return args.ahoraMs - args.ultimoGuardadoMs > (args.maxMs ?? VIGIA_MAX_MS) ? "sin-latido" : "ok";
}

/** El sonido: al detectarlo y luego cada `cadaMs`, no en cada vuelta del vigía. */
export function tocaSonar(ultimaAlarmaMs: number | null, ahoraMs: number, cadaMs: number = ALARMA_CADA_MS): boolean {
  return ultimaAlarmaMs === null || ahoraMs - ultimaAlarmaMs >= cadaMs;
}

/**
 * ¿Hay que volver a intentar retomar la sesión?
 *
 * Solo cuando nadie la conduce —la adopción falló, o el tick no está armado— y sin machacar:
 * un intento cada `cadaMs`. Con el tick vivo y conduciendo, lo que falla es la escritura, y de
 * eso ya se ocupan los reintentos de `writeSession` y la cola sin conexión.
 */
export function tocaReintentar(args: {
  conduce: boolean;
  tickArmado: boolean;
  ultimoIntentoMs: number | null;
  ahoraMs: number;
  cadaMs?: number;
}): boolean {
  if (args.conduce && args.tickArmado) return false;
  return args.ultimoIntentoMs === null || args.ahoraMs - args.ultimoIntentoMs >= (args.cadaMs ?? REINTENTO_CADA_MS);
}

// ---- 3. El Stop de una sesión que esta página no condujo ---------------------------------

export type ContadoresDeStop = {
  endMs: number;
  durationSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  keystrokes: number;
  clicks: number;
  lunchSeconds: number;
  breakSeconds: number;
  breakEvents: unknown[];
};

/**
 * Lo que escribe Stop.
 *
 * Si esta página condujo la sesión (la arrancó, o la adoptó con la fila delante), sus
 * contadores son los buenos y se escriben todos, como siempre.
 *
 * Si NO —la pantalla acaba de montarse y solo tiene la miga de `localStorage`: el id y la hora
 * de arranque— sus contadores valen cero y su reloj cuenta desde el arranque hasta ahora,
 * incluido cualquier tramo en que nadie latió. Escribirlos borra la actividad que sí se grabó y
 * paga el hueco (D-098). En ese caso Stop **solo cierra**: `end_ms`, la duración y la actividad
 * se quedan como las dejó el último latido que sí llegó a la base.
 */
export function parcheDeStop(conduce: boolean, c: ContadoresDeStop): Record<string, unknown> {
  if (!conduce) return { isLive: false, liveNote: null };
  return { ...c, liveNote: null, isLive: false };
}

// ---- 4. El paro del corte pregunta antes -------------------------------------------------

/**
 * Parar por el corte de las 18:30, preguntando antes (D-248 lo dejó a medias).
 *
 * La regla no cambia: solo un «sí» explícito libra del paro; sin respuesta, se para. Lo que
 * cambia es CUÁNDO se da por «sin respuesta». Antes, una pantalla montada después del corte se
 * paraba en su primer efecto, con la respuesta todavía sin pedir (`null`), y a un exento —el
 * dueño— le paraba el reloj cada vez que volvía a «Registrar tiempo» pasadas las 18:30. Ahora
 * se pregunta y se espera esa respuesta; `null` después de preguntar sigue parando.
 *
 * Tras la espera se vuelve a mirar si sigue corriendo: entre medias pudo pulsarse Stop.
 * Devuelve si paró.
 */
export async function pararPorCorteSiToca(args: {
  exentoConocido: boolean | null;
  consultar: () => Promise<boolean | null>;
  sigueCorriendo: () => boolean;
  parar: () => void;
}): Promise<boolean> {
  if (args.exentoConocido === true) return false;
  const exento = args.exentoConocido ?? (await args.consultar());
  if (exento === true) return false;
  if (!args.sigueCorriendo()) return false;
  args.parar();
  return true;
}
