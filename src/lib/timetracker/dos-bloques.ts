// Solicitud de «Agregar tiempo» en DOS bloques (mañana + después de comer), en UNA sola solicitud.
//
// Pedido de Francis (gerente): no quiere hacer dos entradas por el mismo día, una antes y otra
// después de comer. Una solicitud guarda el primer bloque en fromTime/toTime (como siempre) y el
// segundo en payload.secondBlock. Al aprobarla se crean dos sesiones, y el hueco de la comida
// queda fuera: no se paga.
//
// Todo lo de aquí es puro (sin React ni Supabase) para poder probarlo directamente. Las horas
// son HH:MM exactas al minuto: aquí no se redondea nada.

import { DAY_MIN, rangesOverlap, type OccupiedRange } from "./timeOverlap";

export interface Bloque { fromTime: string; toTime: string }

export type ErrorDeBloques = "enterTimes" | "endAfterStart" | "order" | "future" | "overlap";

/** "HH:MM" (o "HH:MM:SS") a minutos desde medianoche. null si no es una hora real. */
export function minutosDeHora(hora: unknown): number | null {
  if (typeof hora !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hora.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Minutos de un bloque. Un fin anterior al inicio cuenta como cruce de medianoche (igual que
 * el resto de la app). Un bloque sin horas válidas vale 0. */
export function minutosDeBloque(b: Bloque): number {
  const s = minutosDeHora(b.fromTime);
  const e = minutosDeHora(b.toTime);
  if (s == null || e == null) return 0;
  return e >= s ? e - s : e + DAY_MIN - s;
}

/** Total de minutos de todos los bloques. */
export function minutosTotales(bloques: Bloque[]): number {
  return bloques.reduce((acc, b) => acc + minutosDeBloque(b), 0);
}

/** Horas totales, sin redondear (2 h 10 min = 2.1666...). Para mostrar, redondear a 2 decimales en la vista. */
export function horasTotales(bloques: Bloque[]): number {
  return minutosTotales(bloques) / 60;
}

/** Los bloques de una solicitud guardada. Vacío si no tiene horas (solicitud de solo horas).
 * Una solicitud antigua de un solo bloque da un elemento; una de dos, dos. */
export function bloquesDeSolicitud(p: Record<string, unknown>): Bloque[] {
  if (typeof p.fromTime !== "string" || typeof p.toTime !== "string" || !p.fromTime || !p.toTime) return [];
  const bloques: Bloque[] = [{ fromTime: p.fromTime, toTime: p.toTime }];
  const b2 = p.secondBlock as { fromTime?: unknown; toTime?: unknown } | null | undefined;
  if (b2 && typeof b2.fromTime === "string" && typeof b2.toTime === "string" && b2.fromTime && b2.toTime) {
    bloques.push({ fromTime: b2.fromTime, toTime: b2.toTime });
  }
  return bloques;
}

/** Los bloques como rangos ocupados (minutos), para compararlos con lo ya fichado y con otras solicitudes. */
export function rangosDeBloques(bloques: Bloque[]): OccupiedRange[] {
  return bloques.map((b) => {
    const startMin = minutosDeHora(b.fromTime) ?? 0;
    let endMin = minutosDeHora(b.toTime) ?? 0;
    if (endMin < startMin) endMin = DAY_MIN;
    return { startMin, endMin };
  });
}

/** Valida la solicitud antes de enviarla. Orden de las reglas:
 *  1. cada bloque tiene inicio y fin válidos, y el fin es posterior al inicio (mismo día);
 *  2. el bloque de después de comer empieza cuando acaba el de la mañana o después (sin solaparse);
 *  3. ningún bloque está en el futuro (zona horaria de la app: `hoy` y `ahoraMin` vienen de ahí);
 *  4. ningún bloque choca con lo ya fichado o pedido ese día (`ocupados`).
 * Tocarse en el minuto (08:00-10:00 y 10:00-12:00) NO es solape, igual que en el resto. */
export function validarBloques(entrada: {
  bloques: Bloque[];
  fecha: string;
  hoy: string;
  ahoraMin: number;
  ocupados: OccupiedRange[];
}): { ok: true; minutos: number } | { ok: false; error: ErrorDeBloques } {
  const { bloques, fecha, hoy, ahoraMin, ocupados } = entrada;
  if (bloques.length === 0) return { ok: false, error: "enterTimes" };

  const rangos = rangosDeBloques(bloques);
  for (let i = 0; i < bloques.length; i++) {
    const b = bloques[i];
    const s = minutosDeHora(b.fromTime);
    const e = minutosDeHora(b.toTime);
    if (s == null || e == null) return { ok: false, error: "enterTimes" };
    if (e <= s) return { ok: false, error: "endAfterStart" };
  }

  if (bloques.length === 2 && rangos[1].startMin < rangos[0].endMin) {
    return { ok: false, error: "order" };
  }

  const enElFuturo = fecha > hoy || (fecha === hoy && rangos.some((r) => r.endMin > ahoraMin));
  if (enElFuturo) return { ok: false, error: "future" };

  if (rangos.some((r) => ocupados.some((o) => rangesOverlap(r.startMin, r.endMin, o.startMin, o.endMin)))) {
    return { ok: false, error: "overlap" };
  }

  return { ok: true, minutos: minutosTotales(bloques) };
}

/** Versión para aprobar: ¿choca alguno de los bloques con lo ocupado, o los bloques entre sí?
 * (Al aprobar no se valida el futuro ni el orden: ya se validó al enviar.) */
export function bloquesChocan(bloques: Bloque[], ocupados: OccupiedRange[]): boolean {
  const rangos = rangosDeBloques(bloques);
  for (let i = 0; i < rangos.length; i++) {
    const r = rangos[i];
    if (ocupados.some((o) => rangesOverlap(r.startMin, r.endMin, o.startMin, o.endMin))) return true;
    for (let j = 0; j < i; j++) {
      if (rangesOverlap(r.startMin, r.endMin, rangos[j].startMin, rangos[j].endMin)) return true;
    }
  }
  return false;
}
