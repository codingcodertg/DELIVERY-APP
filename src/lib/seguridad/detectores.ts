import { formateadorDeFecha } from "@/lib/formateador";

// ============================================================
// Los detectores del monitoreo de seguridad (320). Funciones PURAS: reciben filas ya leídas y devuelven hallazgos.
// No tocan la base ni la red; por eso se prueban como una tabla. Quien los llama (`monitor.ts`) lee las filas.
//
// Todos fallan hacia el lado de no molestar: con pocas filas no hay hallazgo, y un dato que falta no cuenta como
// ataque. Los textos de `resumen` van en español (se guardan así en `sec_alerts`).
// ============================================================

/** Una fila de `sec_events` tal como la lee el monitor. */
export interface EventoLeido {
  ts: string;
  categoria: string;
  severidad: number;
  usuario_id: string | null;
  rol: string | null;
  ip: string | null;
  ip_pais: string | null;
  metodo: string | null;
  ruta: string | null;
  estado: number | null;
  objetivo_tipo: string | null;
  objetivo_id: string | null;
  filas: number | null;
  meta: Record<string, unknown> | null;
}

/** Un cambio de rol tal como queda en `security_events` (kind = role_changed; detail = «antes → después»). */
export interface CambioDeRol {
  ts: string;
  actor_id: string | null;
  target_id: string | null;
  detail: string | null;
}

export type Severidad = 1 | 2 | 3 | 4 | 5;

export interface Hallazgo {
  detector: string;
  severidad: Severidad;
  /** Clave del asunto. La deduplicación de una hora compara detector + sujeto. */
  sujeto: string;
  usuario_id: string | null;
  ip: string | null;
  resumen: string;
  /**
   * Propone bloquear la IP 30 min. SOLO para señales que verifica el servidor (límite de peticiones en las rutas), nunca
   * para fallos de login, que reporta el navegador. La decisión final la toma `decideBloqueoIp`.
   */
  proponeBloqueoIp?: boolean;
}

export const UMBRALES = {
  loginsPorIdentificador: 10,
  ventanaLoginMin: 10,
  loginsPorIp: 20,
  exportFilasPorHora: 500,
  exportesPorHora: 5,
  ventanaExportMin: 60,
  apiDenegadasPorUsuario: 30,
  ventanaApiMin: 10,
  ratelimitPorIp: 50,
  ventanaRatelimitMin: 10,
  latidoCronMin: 15,
  /** Horario normal de «entrar como», en hora de Texas (CT): de 6:00 a 21:00. Fuera de ahí, se avisa. */
  horaInicioCT: 6,
  horaFinCT: 21,
  /** Cuánto dura un bloqueo automático de IP. */
  bloqueoIpMin: 30,
  /** Un país nuevo se mide contra los últimos 30 días. */
  diasHistorialPais: 30,
  /** Si una IP tuvo sesiones válidas de tantas personas distintas en la ventana, se toma por red compartida (tienda). */
  personasParaRedCompartida: 2,
} as const;

const MIN = 60_000;

function haceMenosDe(ts: string, ahora: number, minutos: number): boolean {
  const t = Date.parse(ts);
  return Number.isFinite(t) && ahora - t <= minutos * MIN && t <= ahora + MIN;
}

/** La hora (0–23) en Texas, para el horario de «entrar como». */
export function horaCT(ms: number): number {
  const h = formateadorDeFecha("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date(ms));
  return Number(h) % 24;
}

function horaYMinutoCT(ms: number): string {
  return formateadorDeFecha("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

/** Cuenta por clave, solo de las filas que tienen clave. */
function cuenta<T>(filas: T[], clave: (f: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of filas) {
    const k = clave(f);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const esFalloDeLogin = (e: EventoLeido) => e.categoria === "auth" && e.metodo === "login" && e.estado === 401;

/** ≥10 fallos de login contra el mismo identificador (hash) en 10 min. Sev 4. No propone bloqueo: no se puede ligar a una cuenta. */
export function detectaLoginsPorIdentificador(eventos: EventoLeido[], ahora: number): Hallazgo[] {
  const fallos = eventos.filter((e) => esFalloDeLogin(e) && e.objetivo_tipo === "identificador" && haceMenosDe(e.ts, ahora, UMBRALES.ventanaLoginMin));
  const porHash = cuenta(fallos, (e) => e.objetivo_id);
  const out: Hallazgo[] = [];
  for (const [hash, n] of porHash) {
    if (n < UMBRALES.loginsPorIdentificador) continue;
    // La IP que más fallos puso contra esta cuenta: así el tope por IP sabe a quién agrupar.
    const ipsDelGrupo = cuenta(fallos.filter((e) => e.objetivo_id === hash), (e) => e.ip);
    const ipPrincipal = [...ipsDelGrupo].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out.push({
      detector: "login-fallido-identificador",
      severidad: 4,
      sujeto: `identificador:${hash}`,
      usuario_id: null,
      ip: ipPrincipal,
      resumen: `${n} intentos fallidos contra la misma cuenta en ${UMBRALES.ventanaLoginMin} min (el nombre no se guarda; el hash es ${hash.slice(0, 12)}…).`,
    });
  }
  return out;
}

/** ≥20 fallos de login desde la misma IP en 10 min. Sev 4. SOLO alerta: los fallos de login los reporta el navegador, así que no pueden disparar un bloqueo. */
export function detectaLoginsPorIp(eventos: EventoLeido[], ahora: number): Hallazgo[] {
  const fallos = eventos.filter((e) => esFalloDeLogin(e) && haceMenosDe(e.ts, ahora, UMBRALES.ventanaLoginMin));
  const porIp = cuenta(fallos, (e) => e.ip);
  const out: Hallazgo[] = [];
  for (const [ip, n] of porIp) {
    if (n < UMBRALES.loginsPorIp) continue;
    out.push({
      detector: "login-fallido-ip",
      severidad: 4,
      sujeto: `ip:${ip}`,
      usuario_id: null,
      ip,
      resumen: `${n} intentos fallidos desde la misma IP en ${UMBRALES.ventanaLoginMin} min.`,
    });
  }
  return out;
}

/**
 * Entrada desde un país que esta persona no usó en los últimos 30 días. `historial` = para cada persona, los países
 * que ya tenía ANTES de la ventana actual. Si la persona no tiene ningún historial, no se avisa: su primera entrada
 * no es un cambio de país.
 */
export function detectaPaisNuevo(eventos: EventoLeido[], historial: Map<string, Set<string>>, ahora: number): Hallazgo[] {
  const recientes = eventos.filter((e) => e.categoria === "auth" && e.metodo === "sesion" && e.usuario_id && e.ip_pais && haceMenosDe(e.ts, ahora, 10));
  const vistos = new Set<string>();
  const out: Hallazgo[] = [];
  for (const e of recientes) {
    const paises = historial.get(e.usuario_id!);
    if (!paises || paises.size === 0 || paises.has(e.ip_pais!)) continue;
    const clave = `${e.usuario_id}|${e.ip_pais}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({
      detector: "pais-nuevo",
      severidad: 3,
      sujeto: `pais:${e.usuario_id}:${e.ip_pais}`,
      usuario_id: e.usuario_id,
      ip: e.ip,
      resumen: `Entrada desde ${e.ip_pais}, un país que esta cuenta no usaba en ${UMBRALES.diasHistorialPais} días.`,
    });
  }
  return out;
}

/** Exportaciones: más de 500 filas, o más de 5 exportaciones, de una misma persona en una hora. Sev 4. */
export function detectaExportaciones(eventos: EventoLeido[], ahora: number): Hallazgo[] {
  const exps = eventos.filter((e) => e.categoria === "export" && haceMenosDe(e.ts, ahora, UMBRALES.ventanaExportMin));
  const porPersona = new Map<string, { filas: number; veces: number; ip: string | null; usuario: string | null }>();
  for (const e of exps) {
    const clave = e.usuario_id ?? (e.ip ? `ip:${e.ip}` : null);
    if (!clave) continue;
    const acum = porPersona.get(clave) ?? { filas: 0, veces: 0, ip: e.ip, usuario: e.usuario_id };
    acum.filas += e.filas ?? 0;
    acum.veces += 1;
    porPersona.set(clave, acum);
  }
  const out: Hallazgo[] = [];
  for (const [clave, a] of porPersona) {
    if (a.filas > UMBRALES.exportFilasPorHora) {
      out.push({
        detector: "exportacion-volumen",
        severidad: 4,
        sujeto: `export-volumen:${clave}`,
        usuario_id: a.usuario,
        ip: a.ip,
        resumen: `${a.filas} filas exportadas en una hora (umbral ${UMBRALES.exportFilasPorHora}).`,
      });
    }
    if (a.veces > UMBRALES.exportesPorHora) {
      out.push({
        detector: "exportacion-frecuencia",
        severidad: 4,
        sujeto: `export-frecuencia:${clave}`,
        usuario_id: a.usuario,
        ip: a.ip,
        resumen: `${a.veces} exportaciones en una hora (umbral ${UMBRALES.exportesPorHora}).`,
      });
    }
  }
  return out;
}

/** Un cambio de rol que deja a la cuenta como admin. Sev 5. Lee `security_events`, donde escriben el servidor y el navegador. */
export function detectaNuevosAdmins(cambios: CambioDeRol[], ahora: number): Hallazgo[] {
  const out: Hallazgo[] = [];
  const vistos = new Set<string>();
  for (const c of cambios) {
    if (!haceMenosDe(c.ts, ahora, 10)) continue;
    if (!/→\s*admin\s*$/.test(c.detail ?? "")) continue;
    const objetivo = c.target_id ?? "desconocido";
    if (vistos.has(objetivo)) continue;
    vistos.add(objetivo);
    out.push({
      detector: "admin-nuevo",
      severidad: 5,
      sujeto: `admin:${objetivo}`,
      usuario_id: c.target_id,
      ip: null,
      resumen: "Se dio rol de admin a una cuenta. Revisa que lo hayas pedido tú.",
    });
  }
  return out;
}

/** «Entrar como» (impersonar) fuera de 6:00–21:00 hora de Texas. Sev 4. */
export function detectaImpersonacionFueraDeHorario(eventos: EventoLeido[], ahora: number): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const e of eventos) {
    if (e.categoria !== "impersonation" || e.meta?.kind !== "start") continue;
    if (!haceMenosDe(e.ts, ahora, UMBRALES.ventanaExportMin)) continue;
    const ms = Date.parse(e.ts);
    const h = horaCT(ms);
    if (h >= UMBRALES.horaInicioCT && h < UMBRALES.horaFinCT) continue;
    out.push({
      detector: "impersonacion-horario",
      severidad: 4,
      sujeto: `impersonacion:${e.usuario_id ?? "?"}:${e.ts}`,
      usuario_id: e.usuario_id,
      ip: e.ip,
      resumen: `Se entró como otra persona a las ${horaYMinutoCT(ms)} (hora de Texas), fuera de ${UMBRALES.horaInicioCT}:00–${UMBRALES.horaFinCT}:00.`,
    });
  }
  return out;
}

/** Más de 30 respuestas «prohibido» a una misma persona (o IP, si no hay sesión) en 10 min. Sev 3. */
export function detectaApiDenegadas(eventos: EventoLeido[], ahora: number): Hallazgo[] {
  const denegadas = eventos.filter((e) => e.categoria === "api_denied" && haceMenosDe(e.ts, ahora, UMBRALES.ventanaApiMin));
  const porClave = new Map<string, { n: number; usuario: string | null; ip: string | null }>();
  for (const e of denegadas) {
    const clave = e.usuario_id ?? (e.ip ? `ip:${e.ip}` : null);
    if (!clave) continue;
    const acum = porClave.get(clave) ?? { n: 0, usuario: e.usuario_id, ip: e.ip };
    acum.n += 1;
    porClave.set(clave, acum);
  }
  const out: Hallazgo[] = [];
  for (const [clave, a] of porClave) {
    if (a.n <= UMBRALES.apiDenegadasPorUsuario) continue;
    out.push({
      detector: "api-denegada",
      severidad: 3,
      sujeto: `api-denegada:${clave}`,
      usuario_id: a.usuario,
      ip: a.ip,
      resumen: `${a.n} peticiones denegadas en ${UMBRALES.ventanaApiMin} min (umbral ${UMBRALES.apiDenegadasPorUsuario}).`,
    });
  }
  return out;
}

/** ≥50 respuestas 429 desde una misma IP en 10 min. Sev 3. Señal verificada por el servidor: propone bloquear la IP (con su guardia). */
export function detectaRatelimitPorIp(eventos: EventoLeido[], ahora: number): Hallazgo[] {
  const rechazos = eventos.filter((e) => e.categoria === "ratelimit" && haceMenosDe(e.ts, ahora, UMBRALES.ventanaRatelimitMin));
  const porIp = cuenta(rechazos, (e) => e.ip);
  const out: Hallazgo[] = [];
  for (const [ip, n] of porIp) {
    if (n < UMBRALES.ratelimitPorIp) continue;
    out.push({
      detector: "ratelimit-ip",
      severidad: 3,
      sujeto: `ratelimit:${ip}`,
      usuario_id: null,
      ip,
      resumen: `${n} peticiones frenadas por el límite desde la misma IP en ${UMBRALES.ventanaRatelimitMin} min.`,
      proponeBloqueoIp: true,
    });
  }
  return out;
}

/** El cron del Time Tracker (cada 2 min) debe dejar latido. Si no hay ninguno en 15 min, avisa. Sev 3. */
export function detectaLatidoCron(eventos: EventoLeido[], ahora: number): Hallazgo[] {
  const latidos = eventos.some((e) => e.categoria === "cron" && e.ruta === "tt-cron" && haceMenosDe(e.ts, ahora, UMBRALES.latidoCronMin));
  if (latidos) return [];
  return [{
    detector: "latido-cron",
    severidad: 3,
    sujeto: "latido:tt-cron",
    usuario_id: null,
    ip: null,
    resumen: `No corrió el cron del Time Tracker en ${UMBRALES.latidoCronMin} min. Revisa el workflow tt-cron en GitHub.`,
  }];
}

/**
 * ¿Se puede bloquear esta IP sin cerrar a una persona de la empresa? No si:
 *  · un admin USÓ la IP en las últimas 24 h (`adminVisto24h`: dispositivos de admin con esa última IP, o sesiones de admin
 *    desde ella). La ventana es de 24 h a propósito: el rastro de sesiones se escribe como mucho una vez por hora y persona,
 *    así que una ventana de 30 min podía no ver a un admin que sí estaba ahí. Si no se pudo comprobar (null), no se bloquea;
 *  · la IP tuvo sesiones válidas de ≥2 personas distintas en los últimos 10 min: es una red compartida (tienda, oficina).
 * Devuelve el motivo para dejarlo en `sec_alerts.accion`.
 */
export function decideBloqueoIp(args: {
  ip: string;
  eventos: EventoLeido[];
  ahora: number;
  adminVisto24h: boolean | null;
}): { aplica: true } | { aplica: false; motivo: string } {
  const { ip, eventos, ahora, adminVisto24h } = args;
  if (adminVisto24h === null) return { aplica: false, motivo: "no se pudo comprobar si un admin usó esta IP; no se bloquea" };
  if (adminVisto24h) return { aplica: false, motivo: "un admin usó esta IP en las últimas 24 h" };
  const personas = new Set(
    eventos.filter((e) => e.categoria === "auth" && e.metodo === "sesion" && e.ip === ip && e.usuario_id && haceMenosDe(e.ts, ahora, 10)).map((e) => e.usuario_id),
  );
  if (personas.size >= UMBRALES.personasParaRedCompartida) {
    return { aplica: false, motivo: `red compartida: ${personas.size} personas entraron desde esta IP en los últimos 10 min` };
  }
  return { aplica: true };
}

/**
 * Quita de la lista los hallazgos que ya tienen una alerta ABIERTA de la última hora con el mismo detector y sujeto,
 * y los repetidos dentro de la misma tanda.
 */
export function sinDuplicar(hallazgos: Hallazgo[], abiertasRecientes: { detector: string; sujeto: string | null }[]): Hallazgo[] {
  const usados = new Set(abiertasRecientes.map((a) => `${a.detector}|${a.sujeto ?? ""}`));
  const out: Hallazgo[] = [];
  for (const h of hallazgos) {
    const clave = `${h.detector}|${h.sujeto}`;
    if (usados.has(clave)) continue;
    usados.add(clave);
    out.push(h);
  }
  return out;
}

/** Todos los detectores que leen `sec_events`, en un solo paso. */
export function ejecutaDetectores(args: {
  eventos: EventoLeido[];
  cambiosDeRol: CambioDeRol[];
  historialPais: Map<string, Set<string>>;
  ahora: number;
}): Hallazgo[] {
  const { eventos, cambiosDeRol, historialPais, ahora } = args;
  return [
    ...detectaLoginsPorIdentificador(eventos, ahora),
    ...detectaLoginsPorIp(eventos, ahora),
    ...detectaPaisNuevo(eventos, historialPais, ahora),
    ...detectaExportaciones(eventos, ahora),
    ...detectaNuevosAdmins(cambiosDeRol, ahora),
    ...detectaImpersonacionFueraDeHorario(eventos, ahora),
    ...detectaApiDenegadas(eventos, ahora),
    ...detectaRatelimitPorIp(eventos, ahora),
    ...detectaLatidoCron(eventos, ahora),
  ];
}
