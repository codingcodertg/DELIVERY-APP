import type { Hallazgo } from "./detectores";

// ============================================================
// Topes del monitoreo (320): que un atacante no pueda llenar la bandeja del dueño ni el panel.
// Todo aquí es PURO. `monitor.ts` lee la cuota de la última hora y aplica estas decisiones.
//
// Lo que se TOPA es el envío de avisos, nunca el guardado: cada alerta se guarda siempre.
//  · Correos: 5 por hora para alertas del servidor y 2 por hora aparte para fallos de login (los reporta el navegador,
//    así que no pueden gastar la cuota de las alertas verificadas). Severidad 5 siempre sale por correo.
//  · SMS (solo severidad 5): 2 por hora y 2 por corrida del cron.
//  · Las alertas se atienden por gravedad, de mayor a menor, para que la cuota le toque primero a lo grave.
//  · Identificadores por IP: como mucho 3 avisos de fallos contra cuentas distintas por IP y hora. El resto se guarda
//    marcado como agrupado (sin aviso) y las cuentas se listan en una alerta resumen de la IP.
// ============================================================

export const TOPE_CORREOS_HORA = 5;
export const TOPE_CORREOS_LOGIN_HORA = 2;
export const TOPE_SMS_HORA = 2;
export const TOPE_SMS_POR_CORRIDA = 2;
export const TOPE_IDENTIFICADORES_POR_IP_HORA = 3;

/** Detectores cuyas señales llegan del navegador (fallos de login). Tienen su propia cuota de correos. */
export const DETECTORES_DE_LOGIN: readonly string[] = ["login-fallido-identificador", "login-fallido-ip", "login-fallido-ip-agrupado"];

export type OrigenAviso = "login" | "servidor";

export function origenDe(detector: string): OrigenAviso {
  return DETECTORES_DE_LOGIN.includes(detector) ? "login" : "servidor";
}

export interface CuotaHora {
  /** Correos de alertas del servidor ya enviados en la última hora. */
  correos: number;
  /** Correos de fallos de login ya enviados en la última hora (cuota aparte). */
  correosLogin: number;
  /** SMS ya enviados en la última hora (un mensaje por teléfono). */
  sms: number;
  /** ¿Ya salió el correo-resumen de esta hora? */
  resumen: boolean;
  /** Alertas de la última hora cuyo aviso se omitió por el tope. */
  omitidos: number;
}

/** Cuenta la cuota a partir de `sec_alerts.accion` de la última hora (las filas sin acción no cuentan). */
export function cuotaDeLaHora(acciones: readonly unknown[]): CuotaHora {
  const cuota: CuotaHora = { correos: 0, correosLogin: 0, sms: 0, resumen: false, omitidos: 0 };
  for (const a of acciones) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const avisos = o.avisos as { correo?: unknown; sms?: unknown; origen?: unknown } | undefined;
    if (avisos?.correo === true) {
      // Las filas antiguas no traen origen: cuentan como alertas del servidor.
      if (avisos.origen === "login") cuota.correosLogin += 1;
      else cuota.correos += 1;
    }
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

/**
 * Decide los avisos de UNA alerta. No cambia la cuota: quien llama la suma.
 * Solo severidad ≥4 avisa. Severidad 5 manda correo SIEMPRE (no cuenta para el tope); el SMS es solo para 5 y respeta
 * el tope por hora (`cuota.sms`) y el de la corrida (`smsRestantesCorrida`).
 */
export function decideAviso(
  severidad: number,
  cuota: CuotaHora,
  canales: { correo: boolean; telefonos: number },
  smsRestantesCorrida: number,
  origen: OrigenAviso,
): DecisionAviso {
  const d: DecisionAviso = { correo: false, sms: 0, omitido: null };
  if (severidad < 4) return d;
  if (canales.correo) {
    if (severidad >= 5) d.correo = true;
    else if (origen === "login") {
      if (cuota.correosLogin < TOPE_CORREOS_LOGIN_HORA) d.correo = true;
      else d.omitido = "correo";
    } else if (cuota.correos < TOPE_CORREOS_HORA) d.correo = true;
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

/** Las alertas de mayor severidad primero (el orden es estable: a igual severidad, se mantiene). */
export function ordenaPorGravedad<T extends { severidad: number }>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => b.severidad - a.severidad);
}

/**
 * ¿Toca el correo-resumen de la hora? Sí si hubo alertas omitidas (en esta corrida o antes en la hora) y aún no salió.
 * `omitidosAhora` son las que esta corrida omitió.
 */
export function necesitaResumen(cuota: CuotaHora, omitidosAhora: number): boolean {
  return !cuota.resumen && cuota.omitidos + omitidosAhora > 0;
}

/**
 * Marca los fallos contra cuentas distintas por IP: a partir de `tope` por IP y hora, cada alerta se GUARDA igual pero
 * marcada como agrupada (sin aviso). `agrupados` cuenta esas por IP y `hashes` guarda sus identificadores, para la alerta resumen.
 * `previasPorIp` son las alertas de identificador que la IP ya abrió en la última hora.
 */
export function marcaPorIp(
  hallazgos: readonly Hallazgo[],
  previasPorIp: ReadonlyMap<string, number>,
  tope: number = TOPE_IDENTIFICADORES_POR_IP_HORA,
): { marcados: { h: Hallazgo; agrupada: boolean }[]; agrupados: Map<string, number>; hashes: Map<string, string[]> } {
  const cuenta = new Map(previasPorIp);
  const marcados: { h: Hallazgo; agrupada: boolean }[] = [];
  const agrupados = new Map<string, number>();
  const hashes = new Map<string, string[]>();
  for (const h of hallazgos) {
    if (h.detector !== "login-fallido-identificador" || !h.ip) {
      marcados.push({ h, agrupada: false });
      continue;
    }
    const n = cuenta.get(h.ip) ?? 0;
    if (n >= tope) {
      agrupados.set(h.ip, (agrupados.get(h.ip) ?? 0) + 1);
      const lista = hashes.get(h.ip) ?? [];
      if (lista.length < 50) lista.push(h.sujeto.replace(/^identificador:/, ""));
      hashes.set(h.ip, lista);
      marcados.push({ h, agrupada: true });
      continue;
    }
    cuenta.set(h.ip, n + 1);
    marcados.push({ h, agrupada: false });
  }
  return { marcados, agrupados, hashes };
}

/**
 * Si la lectura de la cuota llegó a su tope, no se puede saber cuánto salió: se da la cuota por agotada (cerrado para
 * todo lo que no sea severidad 5, que sigue saliendo por correo siempre).
 */
export function cuotaAgotada(c: CuotaHora): CuotaHora {
  return {
    ...c,
    correos: Math.max(c.correos, TOPE_CORREOS_HORA),
    correosLogin: Math.max(c.correosLogin, TOPE_CORREOS_LOGIN_HORA),
    sms: Math.max(c.sms, TOPE_SMS_HORA),
  };
}

/**
 * Suma las cuentas agrupadas de esta corrida a la fila resumen de la IP de la última hora: el contador crece y los
 * identificadores se acumulan (como mucho 50). Sin fila previa, arranca desde cero.
 */
export function combinaResumenIp(
  previa: { contador?: unknown; hashes?: unknown } | null,
  nuevas: number,
  hashesNuevos: readonly string[],
): { contador: number; hashes: string[] } {
  // Solo suman las cuentas que no estaban ya en el resumen: la misma cuenta en dos corridas no infla el contador.
  const hashesPrevios = Array.isArray(previa?.hashes) ? (previa?.hashes as string[]) : [];
  const ya = new Set(hashesPrevios);
  const deVerdadNuevos = [...new Set(hashesNuevos)].filter((h) => !ya.has(h));
  const sinHash = Math.max(0, nuevas - hashesNuevos.length);
  const contador = (Number(previa?.contador) || 0) + deVerdadNuevos.length + sinHash;
  return { contador, hashes: [...hashesPrevios, ...deVerdadNuevos].slice(0, 50) };
}
