import type { Hallazgo } from "./detectores";

// ============================================================
// Topes del monitoreo (320, revisión de seguridad): que un atacante no pueda llenar la bandeja del dueño ni el panel.
// Todo aquí es PURO. Quien lo usa (`monitor.ts`) lee las acciones de la última hora y aplica las decisiones.
//
//  · Avisos por hora, en total: como mucho TOPE_CORREOS_HORA alertas con correo y TOPE_SMS_HORA con SMS. Lo que pasa
//    del tope se cuenta, y se manda UN correo-resumen por hora («N alertas más, revisa el panel»).
//  · Identificadores por IP: una misma IP abre como mucho TOPE_IDENTIFICADORES_POR_IP_HORA alertas de fallos contra
//    cuentas distintas por hora. Las demás se agrupan en una sola alerta de la IP.
// ============================================================

export const TOPE_CORREOS_HORA = 5;
export const TOPE_SMS_HORA = 2;
export const TOPE_IDENTIFICADORES_POR_IP_HORA = 3;

export interface CuotaHora {
  /** Alertas que ya salieron por correo en la última hora. */
  correos: number;
  /** SMS que ya salieron en la última hora. */
  sms: number;
  /** ¿Ya salió el correo-resumen de esta hora? */
  resumen: boolean;
  /** Alertas de la última hora que se omitieron de los avisos por el tope. */
  omitidos: number;
}

/** Cuenta la cuota a partir de `sec_alerts.accion` de la última hora (las filas sin acción no cuentan). */
export function cuotaDeLaHora(acciones: readonly unknown[]): CuotaHora {
  const cuota: CuotaHora = { correos: 0, sms: 0, resumen: false, omitidos: 0 };
  for (const a of acciones) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const avisos = o.avisos as { correo?: unknown; sms?: unknown } | undefined;
    if (avisos?.correo === true) cuota.correos += 1;
    if (typeof avisos?.sms === "number") cuota.sms += avisos.sms;
    if (o.resumen_horario === true) cuota.resumen = true;
    if (o.omitido === "correo" || o.omitido === "sms") cuota.omitidos += 1;
  }
  return cuota;
}

export interface DecisionAviso {
  /** Mandar el correo de esta alerta (una vez, a toda la lista). */
  correo: boolean;
  /** Cuántos SMS (uno por teléfono) salen para esta alerta. */
  sms: number;
  /** Qué canal se omitió por el tope (para dejarlo en la acción de la alerta). */
  omitido: "correo" | "sms" | null;
}

/** Como mucho este número de SMS por CORRIDA del cron (además del tope por hora). */
export const TOPE_SMS_POR_CORRIDA = 2;

/**
 * Decide los avisos de UNA alerta. No cambia la cuota: quien llama la suma. Solo severidad ≥4 avisa; el SMS solo a 5.
 * Un SMS = un mensaje a un teléfono. Se respetan el tope de la hora (`cuota.sms`) y el de la corrida (`smsRestantesCorrida`).
 */
export function decideAviso(
  severidad: number,
  cuota: CuotaHora,
  canales: { correo: boolean; telefonos: number },
  smsRestantesCorrida: number,
): DecisionAviso {
  const d: DecisionAviso = { correo: false, sms: 0, omitido: null };
  if (severidad < 4) return d;
  if (canales.correo) {
    if (cuota.correos < TOPE_CORREOS_HORA) d.correo = true;
    else d.omitido = "correo";
  }
  if (severidad >= 5 && canales.telefonos > 0) {
    const quieren = canales.telefonos;
    const permitidos = Math.max(0, Math.min(quieren, TOPE_SMS_HORA - cuota.sms, smsRestantesCorrida));
    d.sms = permitidos;
    if (permitidos < quieren) d.omitido = d.omitido ?? "sms";
  }
  return d;
}

/**
 * ¿Toca el correo-resumen de la hora? Sí si hubo alertas omitidas (en esta corrida o antes en la hora) y aún no salió.
 * `omitidosAhora` son las que esta corrida omitió.
 */
export function necesitaResumen(cuota: CuotaHora, omitidosAhora: number): boolean {
  return !cuota.resumen && cuota.omitidos + omitidosAhora > 0;
}

/**
 * Agrupa los fallos contra cuentas distintas por IP: como mucho `tope` alertas de identificador por IP y hora. Las que
 * sobran no se insertan; se cuentan en `agrupados` (IP → cuántas cuentas más) para una sola alerta de la IP.
 * `previasPorIp` son las alertas de identificador que la IP ya abrió en la última hora.
 */
export function agrupaPorIp(
  hallazgos: readonly Hallazgo[],
  previasPorIp: ReadonlyMap<string, number>,
  tope: number = TOPE_IDENTIFICADORES_POR_IP_HORA,
): { insertar: Hallazgo[]; agrupados: Map<string, number> } {
  const cuenta = new Map(previasPorIp);
  const insertar: Hallazgo[] = [];
  const agrupados = new Map<string, number>();
  for (const h of hallazgos) {
    if (h.detector !== "login-fallido-identificador" || !h.ip) {
      insertar.push(h);
      continue;
    }
    const n = cuenta.get(h.ip) ?? 0;
    if (n >= tope) {
      agrupados.set(h.ip, (agrupados.get(h.ip) ?? 0) + 1);
      continue;
    }
    cuenta.set(h.ip, n + 1);
    insertar.push(h);
  }
  return { insertar, agrupados };
}
