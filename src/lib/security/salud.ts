import { mensajeDeError } from "@/lib/mensaje-de-error";

/**
 * «Salud del sistema» de Central Hub Monitoring (D-1012). Lógica PURA (sin red ni React): nombres legibles de las
 * sentencias que más escriben, lectura del texto Prometheus de la Metrics API de Supabase, ritmos, y el semáforo con
 * su «qué hacer». Los umbrales son constantes con nombre para poder ajustarlos sin buscar números sueltos.
 *
 * Por qué existe: Supabase avisó «Your project is running out of Disk IO Budget» (12 nov). El presupuesto exacto de
 * Disk IO solo lo enseña el panel de Supabase; aquí se ven las métricas reales más cercanas (disco del servidor, vía la
 * Metrics API) y nuestro propio indicador: cuánto escribe cada cosa por hora (pg_stat_statements desde su reinicio).
 */

export type Nivel = "verde" | "amarillo" | "rojo" | "gris";

export interface Veredicto {
  id: string;
  titulo: string;
  nivel: Nivel;
  valor: string;
  queHacer: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Umbrales
// ---------------------------------------------------------------------------------------------------------------

/** Disco del servidor ocupado (fracción del tiempo con E/S en curso). Arriba de esto, el presupuesto de Disk IO se gasta. */
export const DISCO_OCUPADO_AMARILLO = 0.2;
export const DISCO_OCUPADO_ROJO = 0.5;
/** Escrituras a la base por hora (llamadas que escriben WAL, todas juntas) desde el último reinicio de estadísticas. */
export const ESCRITURAS_HORA_AMARILLO = 3_000;
export const ESCRITURAS_HORA_ROJO = 8_000;
/** MB de WAL por hora: lo que de verdad pesa en el disco. */
export const WAL_MB_HORA_AMARILLO = 15;
export const WAL_MB_HORA_ROJO = 40;
/** Publicaciones (deploys) a producción en 24 h: cada una recarga a todos los que tienen la app abierta. */
export const DEPLOYS_DIA_AMARILLO = 6;
export const DEPLOYS_DIA_ROJO = 10;
/** Crecimiento de archivos por mes (GB). */
export const ARCHIVOS_GB_MES_AMARILLO = 1;
export const ARCHIVOS_GB_MES_ROJO = 3;
/** Tamaño de la base (GB). El plan Pro incluye 8 GB. */
export const BASE_GB_AMARILLO = 4;
export const BASE_GB_ROJO = 7;
/** Conexiones en uso contra el máximo. */
export const CONEXIONES_AMARILLO = 0.6;
export const CONEXIONES_ROJO = 0.85;
/** Aciertos de caché (%): por debajo, la base lee de disco. */
export const CACHE_AMARILLO = 99;
export const CACHE_ROJO = 95;

export const GB = 1024 ** 3;
export const MB = 1024 ** 2;

// ---------------------------------------------------------------------------------------------------------------
// Nombres legibles de las sentencias
// ---------------------------------------------------------------------------------------------------------------

const ETIQUETAS: [RegExp, string][] = [
  [/timetracker"?\."?sessions/i, "Time Tracker · sesiones (cronómetro)"],
  [/timetracker"?\."?screenshots/i, "Time Tracker · capturas"],
  [/refresh_tokens/i, "Inicio de sesión · tokens"],
  [/auth.*users|"users" as users/i, "Inicio de sesión · usuarios"],
  [/pg_publication_tables|realtime/i, "Realtime (pantallas en vivo)"],
  [/storage\.objects|"objects"/i, "Archivos (storage)"],
  [/driver_locations/i, "GPS de choferes"],
  [/order_events/i, "Historial de órdenes"],
  [/notifications/i, "Notificaciones"],
  [/security_device|security_touch_device/i, "Latido de dispositivos (Monitoring)"],
  [/app_last_seen/i, "Uso por app"],
  [/deliveries/i, "Órdenes de entrega"],
  [/warehouse_report/i, "Merma / reportes de almacén"],
  [/rate_limits|check_rate_limit/i, "Límite de intentos"],
  [/sales_history|erp\./i, "ERP"],
];

export function etiquetaDeConsulta(consulta: string): string {
  for (const [re, nombre] of ETIQUETAS) if (re.test(consulta)) return nombre;
  const corta = consulta.replace(/\s+/g, " ").trim();
  return corta.length > 60 ? `${corta.slice(0, 57)}…` : corta;
}

// ---------------------------------------------------------------------------------------------------------------
// Ritmos
// ---------------------------------------------------------------------------------------------------------------

/** Horas desde el reinicio de estadísticas (mínimo 1 minuto para no dividir entre casi cero). */
export function horasDesde(desdeIso: string | null | undefined, ahora: Date = new Date()): number | null {
  if (!desdeIso) return null;
  const ms = ahora.getTime() - Date.parse(desdeIso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(ms, 60_000) / 3_600_000;
}

export function porHora(total: number, horas: number | null): number | null {
  return horas && horas > 0 ? total / horas : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Metrics API de Supabase (texto Prometheus)
// ---------------------------------------------------------------------------------------------------------------

export interface MuestraDeDisco {
  /** Momento de la lectura (ms). */
  t: number;
  /** Segundos acumulados con E/S en curso, sumando los discos reales. */
  ioSegundos: number;
  leidosBytes: number;
  escritosBytes: number;
}

/** Discos virtuales que no cuentan (loop, ram, particiones de un disco ya sumado no aplican aquí). */
const DISCO_IGNORADO = /^(loop|ram|sr|zram)/;

/** Suma una métrica `node_disk_*` por dispositivo real del texto Prometheus. */
function sumaMetrica(texto: string, nombre: string): number | null {
  let total = 0;
  let vista = false;
  const re = new RegExp(`^${nombre}\\{([^}]*)\\}\\s+([0-9.eE+-]+)`, "gm");
  for (const m of texto.matchAll(re)) {
    const disp = /device="([^"]+)"/.exec(m[1])?.[1] ?? "";
    if (DISCO_IGNORADO.test(disp)) continue;
    const v = Number(m[2]);
    if (Number.isFinite(v)) { total += v; vista = true; }
  }
  return vista ? total : null;
}

export function muestraDeDisco(textoPrometheus: string, t: number): MuestraDeDisco | null {
  const io = sumaMetrica(textoPrometheus, "node_disk_io_time_seconds_total");
  const leidos = sumaMetrica(textoPrometheus, "node_disk_read_bytes_total");
  const escritos = sumaMetrica(textoPrometheus, "node_disk_written_bytes_total");
  if (io === null && leidos === null && escritos === null) return null;
  return { t, ioSegundos: io ?? 0, leidosBytes: leidos ?? 0, escritosBytes: escritos ?? 0 };
}

export interface RitmoDeDisco {
  /** Fracción del tiempo con el disco ocupado entre las dos muestras (0–1). */
  ocupado: number;
  leidosMBs: number;
  escritosMBs: number;
  segundos: number;
}

/** Ritmo entre dos muestras (la anterior y la nueva). Null si no hay dos muestras útiles. */
export function ritmoDeDisco(antes: MuestraDeDisco | null, ahora: MuestraDeDisco | null): RitmoDeDisco | null {
  if (!antes || !ahora) return null;
  const s = (ahora.t - antes.t) / 1000;
  if (s < 30) return null;
  const dIo = ahora.ioSegundos - antes.ioSegundos;
  const dR = ahora.leidosBytes - antes.leidosBytes;
  const dW = ahora.escritosBytes - antes.escritosBytes;
  if (dIo < 0 || dR < 0 || dW < 0) return null; // reinicio del servidor entre muestras
  return { ocupado: Math.min(1, dIo / s), leidosMBs: dR / MB / s, escritosMBs: dW / MB / s, segundos: s };
}

// ---------------------------------------------------------------------------------------------------------------
// Semáforo
// ---------------------------------------------------------------------------------------------------------------

export function nivelPorUmbral(v: number | null | undefined, amarillo: number, rojo: number): Nivel {
  if (v === null || v === undefined || !Number.isFinite(v)) return "gris";
  return v >= rojo ? "rojo" : v >= amarillo ? "amarillo" : "verde";
}

/** Al revés: valores ALTOS son buenos (caché). */
export function nivelPorPiso(v: number | null | undefined, amarillo: number, rojo: number): Nivel {
  if (v === null || v === undefined || !Number.isFinite(v)) return "gris";
  return v < rojo ? "rojo" : v < amarillo ? "amarillo" : "verde";
}

const fmt1 = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 1 });
const fmt0 = (n: number) => Math.round(n).toLocaleString("es-MX");

/** Sin lectura: la tarjeta no dice si va bien o mal. Nunca se pinta como sana. */
export const SIN_LECTURA = "Sin lectura: esto no dice si va bien o mal.";

/** Tarjeta sin datos: gris, con la razón en plano. */
export function sinDatos(motivo: string | null | undefined, por = "sin lectura"): string {
  return `No data — ${motivo ?? por}`;
}

export interface EntradaDeVeredictos {
  ritmoDisco: RitmoDeDisco | null;
  discoConfigurado: boolean;
  escriturasHora: number | null;
  walMBHora: number | null;
  principalEscritor: string | null;
  deploys24h: number | null;
  deploysFallidos24h: number | null;
  archivosGBMes: number | null;
  capturasGBMes: number | null;
  baseGB: number | null;
  conexiones: number | null;
  conexionesMax: number | null;
  cache: number | null;
  sinRls: number | null;
  definerAnon: number | null;
  compute: string | null;
  /** Por qué no hay datos de cada grupo (texto ya en español, sin jerga). Null = sin motivo conocido. */
  motivoBase?: string | null;
  motivoEscrituras?: string | null;
  motivoArchivos?: string | null;
  motivoRevision?: string | null;
  motivoDisco?: string | null;
  motivoVercel?: string | null;
  motivoCompute?: string | null;
}

export function veredictos(e: EntradaDeVeredictos): Veredicto[] {
  const v: Veredicto[] = [];

  // 1. Disk IO (lo que mandó el correo de Supabase).
  if (e.ritmoDisco) {
    const n = nivelPorUmbral(e.ritmoDisco.ocupado, DISCO_OCUPADO_AMARILLO, DISCO_OCUPADO_ROJO);
    v.push({
      id: "disco", titulo: "Disk IO del servidor", nivel: n,
      valor: `${fmt0(e.ritmoDisco.ocupado * 100)} % ocupado · escribe ${fmt1(e.ritmoDisco.escritosMBs)} MB/s · lee ${fmt1(e.ritmoDisco.leidosMBs)} MB/s`,
      queHacer: n === "verde"
        ? "El disco va holgado. Sigue revisando el panel de Supabase si vuelve a llegar el aviso."
        : `El disco trabaja mucho${e.principalEscritor ? `; lo que más escribe es «${e.principalEscritor}»` : ""}. Baja esas escrituras o sube el tamaño del servidor (Compute) en Supabase.`,
    });
  } else {
    v.push({
      id: "disco", titulo: "Disk IO del servidor", nivel: "gris",
      valor: sinDatos(e.motivoDisco ?? (e.discoConfigurado ? "midiendo; vuelve a cargar en 1 minuto" : "la Metrics API no está configurada")),
      queHacer: "El presupuesto exacto de Disk IO solo sale en el panel de Supabase (Reports → Database → Disk IO). Mientras, guíate por «Escrituras por hora».",
    });
  }

  // 2. Escrituras por hora (nuestro indicador).
  {
    const n1 = nivelPorUmbral(e.escriturasHora, ESCRITURAS_HORA_AMARILLO, ESCRITURAS_HORA_ROJO);
    const n2 = nivelPorUmbral(e.walMBHora, WAL_MB_HORA_AMARILLO, WAL_MB_HORA_ROJO);
    const orden: Nivel[] = ["gris", "verde", "amarillo", "rojo"];
    const n = orden[Math.max(orden.indexOf(n1), orden.indexOf(n2))];
    v.push({
      id: "escrituras", titulo: "Escrituras a la base por hora", nivel: n,
      valor: e.escriturasHora === null ? sinDatos(e.motivoEscrituras, "sin estadísticas de la base") : `${fmt0(e.escriturasHora)} por hora · ${fmt1(e.walMBHora ?? 0)} MB/h`,
      queHacer: n === "gris" ? SIN_LECTURA
        : n === "verde" ? "Ritmo sano. Reinicia las estadísticas después de un cambio grande para medir el ritmo nuevo."
        : `Escribe de más${e.principalEscritor ? `: empieza por «${e.principalEscritor}»` : ""}. Que guarde menos seguido o en lote.`,
    });
  }

  // 3. Publicaciones.
  {
    const n = e.deploys24h === null ? "gris" : nivelPorUmbral(e.deploys24h, DEPLOYS_DIA_AMARILLO, DEPLOYS_DIA_ROJO);
    v.push({
      id: "deploys", titulo: "Publicaciones en 24 h", nivel: n,
      valor: e.deploys24h === null ? sinDatos(e.motivoVercel, "VERCEL_TOKEN no está configurado") : `${e.deploys24h}${e.deploysFallidos24h ? ` · ${e.deploysFallidos24h} fallidas` : ""}`,
      queHacer: n === "rojo" || n === "amarillo"
        ? "Cada publicación recarga a todos los que tienen la app abierta: junta cambios y publica menos veces al día."
        : n === "gris" ? SIN_LECTURA : "Bien: pocas publicaciones.",
    });
  }

  // 4. Archivos.
  {
    const n = nivelPorUmbral(e.archivosGBMes, ARCHIVOS_GB_MES_AMARILLO, ARCHIVOS_GB_MES_ROJO);
    v.push({
      id: "archivos", titulo: "Archivos: crecimiento", nivel: n,
      valor: e.archivosGBMes === null ? sinDatos(e.motivoArchivos, "sin datos de archivos") : `${fmt1(e.archivosGBMes)} GB en 30 días${e.capturasGBMes !== null ? ` (capturas de Time Tracker: ${fmt1(e.capturasGBMes)} GB)` : ""}`,
      queHacer: n === "gris" ? SIN_LECTURA
        : n === "verde" ? "Crecimiento normal."
        : `Las capturas de Time Tracker crecen ${fmt1(e.capturasGBMes ?? 0)} GB/mes: define cuántos días guardarlas y borra las viejas.`,
    });
  }

  // 5. Tamaño de la base.
  {
    const n = nivelPorUmbral(e.baseGB, BASE_GB_AMARILLO, BASE_GB_ROJO);
    v.push({
      id: "base", titulo: "Tamaño de la base", nivel: n,
      valor: e.baseGB === null ? sinDatos(e.motivoBase, "sin datos de la base") : `${fmt1(e.baseGB * 1024)} MB`,
      queHacer: n === "gris" ? SIN_LECTURA : n === "verde" ? "Muy por debajo de lo incluido." : "La base se acerca al límite del plan: revisa tablas grandes y bitácoras.",
    });
  }

  // 6. Conexiones y caché.
  {
    const frac = e.conexiones !== null && e.conexionesMax ? e.conexiones / e.conexionesMax : null;
    const n = nivelPorUmbral(frac, CONEXIONES_AMARILLO, CONEXIONES_ROJO);
    v.push({
      id: "conexiones", titulo: "Conexiones en uso", nivel: n,
      valor: frac === null ? sinDatos(e.motivoBase, "sin datos de la base") : `${e.conexiones} de ${e.conexionesMax}`,
      queHacer: n === "gris" ? SIN_LECTURA : n === "verde" ? "Holgado." : "Muchas conexiones abiertas: revisa procesos colgados o sube el tamaño del servidor.",
    });
    const nc = nivelPorPiso(e.cache, CACHE_AMARILLO, CACHE_ROJO);
    v.push({
      id: "cache", titulo: "Aciertos de caché", nivel: nc,
      valor: e.cache === null ? sinDatos(e.motivoBase, "sin datos de la base") : `${fmt1(e.cache)} %`,
      queHacer: nc === "gris" ? SIN_LECTURA : nc === "verde" ? "Casi todo se lee de memoria: bien." : "La base lee mucho de disco: faltan índices o el servidor tiene poca memoria.",
    });
  }

  // 7. Revisión rápida de seguridad.
  {
    const n: Nivel = e.sinRls === null ? "gris" : e.sinRls > 0 ? "rojo" : (e.definerAnon ?? 0) > 0 ? "amarillo" : "verde";
    v.push({
      id: "seguridad", titulo: "Revisión rápida de seguridad", nivel: n,
      valor: e.sinRls === null ? sinDatos(e.motivoRevision, "sin datos de la revisión") : `${e.sinRls} tablas sin RLS · ${e.definerAnon ?? 0} funciones que se llaman sin sesión`,
      queHacer: n === "gris" ? SIN_LECTURA
        : n === "verde" ? "Sin hallazgos en esta revisión rápida."
        : "Quita a «anon» el permiso de ejecutar las funciones internas y prende RLS donde falte.",
    });
  }

  // 8. Tamaño del servidor.
  v.push({
    id: "compute", titulo: "Tamaño del servidor (Compute)", nivel: e.compute ? "verde" : "gris",
    valor: e.compute ?? sinDatos(e.motivoCompute, "SUPABASE_ACCESS_TOKEN no está configurado"),
    queHacer: e.compute
      ? "Un servidor más grande trae más presupuesto de Disk IO, más memoria y más conexiones, a cambio de más costo al mes. Primero baja las escrituras; sube solo si el aviso sigue."
      : SIN_LECTURA,
  });

  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// Partes independientes: cada lectura tiene su propio tiempo máximo y su propio error. Una que falla no tumba las demás.
// ---------------------------------------------------------------------------------------------------------------

export interface Parte<T> {
  datos: T | null;
  /** Razón en español, lista para mostrar en la tarjeta. Null si la lectura salió bien. */
  error: string | null;
}

export class TiempoAgotado extends Error {
  constructor() { super("tiempo agotado"); this.name = "TiempoAgotado"; }
}

/** Fallo que ya viene con su frase en español (p. ej. «la Metrics API respondió 500»): se muestra tal cual. */
export class MotivoPlano extends Error {
  constructor(public readonly motivo: string) { super(motivo); this.name = "MotivoPlano"; }
}

/** Motivo en plano de un fallo: el tiempo agotado tiene su frase; los errores de la base pasan por mensajeDeError. */
export function motivoDeFallo(e: unknown, ms: number): string {
  if (e instanceof MotivoPlano) return e.motivo;
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (e instanceof TiempoAgotado || /tiempo agotado/i.test(m)) return `no respondió en ${Math.round(ms / 1000)} s`;
  return mensajeDeError(e, "es", "cargar");
}

/**
 * Corre UNA lectura con su tiempo máximo. Nunca lanza: devuelve datos o un motivo. Así una lectura que falla no
 * bloquea a las demás (la página las pide todas con Promise.all sobre esta función).
 */
export async function ejecutaParte<T>(trabajo: () => Promise<T>, ms: number): Promise<Parte<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const datos = await Promise.race([
      trabajo(),
      new Promise<never>((_, no) => { timer = setTimeout(() => no(new TiempoAgotado()), ms); }),
    ]);
    return { datos, error: null };
  } catch (e) {
    return { datos: null, error: motivoDeFallo(e, ms) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
