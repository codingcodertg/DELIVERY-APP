import { telefonoEstandar } from "@/lib/recruiting/formato";

// ============================================================
// RingCentral de los choferes (puro, sin I/O). Lo usan el sincronizador (sync.ts), las rutas /api/ringcentral/* y la
// pantalla. Aquí viven las reglas: qué extensiones son de usuario, cómo se lee una llamada, desde cuándo se pide, qué
// URL de grabación se puede seguir con el token, qué filtros acepta la lista y cuánto falta para volver a sincronizar.
// ============================================================

const DIA_MS = 24 * 60 * 60 * 1000;

/** La primera lectura de una extensión mira hacia atrás este número de días. */
export const DIAS_PRIMERA_VEZ = 30;
/** Cada lectura vuelve este margen antes del cursor: una llamada que RingCentral publica tarde no se pierde. */
export const MARGEN_MS = 2 * 60 * 60 * 1000;
export const MAX_PAGINAS = 30;
export const TAMANO_PAGINA = 100;
/** Grabaciones que se bajan por corrida (el cron corre cada 10 minutos). */
export const MAX_GRABACIONES = 6;
/** Tras tantos intentos fallidos una grabación deja de intentarse (sigue pendiente, pero no tapa a las demás). */
export const MAX_INTENTOS_GRABACION = 5;
/** Espera mínima entre dos sincronizaciones pedidas a mano. */
export const ESPERA_SINCRONIZAR_SEG = 120;
export const TAMANO_LISTA = 100;
export const MAX_TAMANO_LISTA = 500;

/** El código que se guarda cuando RingCentral niega el permiso ReadCompanyCallLog (403). */
export const SIN_PERMISO = "sin_permiso";
export const LIMITE_DE_RC = "limite";
export const ERROR_DE_LISTADO = "listado";

/** Una extensión de RingCentral tal como la pide la pantalla de choferes. */
export interface ExtensionDeRc {
  id: string;
  numero: string;
  nombre: string;
}

/** Solo las extensiones de usuario (`type: "User"`): las colas de llamadas, los IVR y los faxes no son choferes. */
export function extensionesDeLaRespuesta(records: readonly unknown[]): ExtensionDeRc[] {
  const salida: ExtensionDeRc[] = [];
  for (const r of records) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (o.type !== "User") continue;
    const id = o.id != null ? String(o.id) : "";
    const numero = o.extensionNumber != null ? String(o.extensionNumber) : "";
    if (!id || !numero) continue;
    salida.push({ id, numero, nombre: typeof o.name === "string" ? o.name.trim() : "" });
  }
  return salida;
}

/** Un registro del call log de RingCentral (vista Detailed). Solo los campos que usamos. */
export interface RegistroDeLlamadaDeChofer {
  id: string | number;
  startTime: string;
  duration?: number | null;
  direction?: string | null;
  result?: string | null;
  from?: { phoneNumber?: string | null; name?: string | null } | null;
  to?: { phoneNumber?: string | null; name?: string | null } | null;
  recording?: { id?: string | number; contentUri?: string | null } | null;
}

/** La fila que se guarda en `public.rc_driver_calls` (sin id, created_at ni los datos de grabación ya bajada). */
export interface FilaDeLlamadaDeChofer {
  rc_call_id: string;
  rc_extension_id: string;
  direction: "in" | "out";
  started_at: string;
  duration_s: number | null;
  from_number: string | null;
  from_name: string | null;
  to_number: string | null;
  to_name: string | null;
  result: string | null;
  recording_uri: string | null;
  recording_pending: boolean;
}

const texto = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/** La fila de una llamada de la extensión, o null si la dirección o la fecha no se entienden (no se guarda a medias). */
export function filaDeLlamadaDeChofer(registro: RegistroDeLlamadaDeChofer, extensionId: string): FilaDeLlamadaDeChofer | null {
  const direccion = registro.direction === "Inbound" ? "in" : registro.direction === "Outbound" ? "out" : null;
  if (!direccion) return null;
  if (registro.startTime == null || Number.isNaN(Date.parse(registro.startTime))) return null;
  const id = registro.id != null ? String(registro.id) : "";
  if (!id) return null;
  const uri = texto(registro.recording?.contentUri);
  return {
    rc_call_id: id,
    rc_extension_id: extensionId,
    direction: direccion,
    started_at: registro.startTime,
    duration_s: typeof registro.duration === "number" ? Math.round(registro.duration) : null,
    from_number: texto(registro.from?.phoneNumber),
    from_name: texto(registro.from?.name),
    to_number: texto(registro.to?.phoneNumber),
    to_name: texto(registro.to?.name),
    result: texto(registro.result),
    recording_uri: uri,
    recording_pending: !!uri,
  };
}

/** Desde cuándo pedir el call log de una extensión: el cursor menos el margen, o 30 días si nunca se leyó. */
export function ventanaDeLectura(cursor: string | null | undefined, ahora: Date): Date {
  const t = cursor ? Date.parse(cursor) : Number.NaN;
  return Number.isNaN(t) ? new Date(ahora.getTime() - DIAS_PRIMERA_VEZ * DIA_MS) : new Date(t - MARGEN_MS);
}

/**
 * La URL de una grabación, solo si se puede seguir CON EL TOKEN: https y un host de ringcentral.com (o un subdominio).
 * Cualquier otra cosa (http, otro dominio, usuario y clave en la URL) devuelve null y no se pide nada.
 */
export function urlDeGrabacionSegura(uri: string, base: string): URL | null {
  let u: URL;
  try {
    u = new URL(uri, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host !== "ringcentral.com" && !host.endsWith(".ringcentral.com")) return null;
  return u;
}

/** La extensión del fichero según su tipo (el de la respuesta de RingCentral). */
export function extensionDeGrabacion(tipo: string): string {
  const t = tipo.split(";")[0].trim().toLowerCase();
  if (t === "audio/wav" || t === "audio/x-wav" || t === "audio/wave") return "wav";
  if (t === "audio/mp4" || t === "audio/x-m4a" || t === "audio/m4a") return "m4a";
  if (t === "audio/mpeg" || t === "audio/mp3") return "mp3";
  return "bin";
}

/** La ruta en el bucket: `<extensión>/<llamada>.<ext>`. Los ids solo llevan letras, cifras, guion y guion bajo. */
export function rutaDeGrabacion(extensionId: string, rcCallId: string, tipo: string): string {
  const seguro = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${seguro(extensionId)}/${seguro(rcCallId)}.${extensionDeGrabacion(tipo)}`;
}

/** «m:ss», o «—» si no hay duración. */
export function duracionDeLlamada(segundos: number | null | undefined): string {
  if (segundos == null || Number.isNaN(segundos)) return "—";
  const m = Math.floor(segundos / 60);
  const s = String(Math.floor(segundos % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

/** El número de la otra parte, como se ve en la pantalla («(956) 555-0101»). Vacío si no hay. */
export function numeroLegible(numero: string | null | undefined): string {
  return telefonoEstandar(numero ?? "");
}

/** Lo que se muestra de una extensión: su nombre, o «Ext. 101» si RingCentral no trae nombre. */
export function nombreVisible(nombre: string | null | undefined, numero: string): string {
  const n = (nombre ?? "").trim();
  return n || `Ext. ${numero}`;
}

/** Lo que se acepta de la pantalla al guardar los choferes: una lista de {id, numero, nombre}, sin repetidos. */
export interface ChoferSolicitado {
  id: string;
  numero: string;
  nombre: string;
}

export function choferesDeLaSolicitud(cuerpo: unknown): ChoferSolicitado[] | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const lista = (cuerpo as Record<string, unknown>).choferes;
  if (!Array.isArray(lista) || lista.length > 500) return null;
  const vistos = new Set<string>();
  const salida: ChoferSolicitado[] = [];
  for (const e of lista) {
    if (!e || typeof e !== "object") return null;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(o.id)) return null;
    if (typeof o.numero !== "string" || !/^[0-9*#]{1,20}$/.test(o.numero)) return null;
    const nombre = typeof o.nombre === "string" ? o.nombre.trim() : "";
    if (nombre.length > 200) return null;
    if (vistos.has(o.id)) continue;
    vistos.add(o.id);
    salida.push({ id: o.id, numero: o.numero, nombre });
  }
  return salida;
}

/** Los filtros de la lista de llamadas. Las fechas llegan como instantes ISO (las pone el navegador en su hora local). */
export interface FiltrosDeLlamadas {
  extension: string | null;
  desde: string | null;
  hasta: string | null;
  direccion: "in" | "out" | null;
  conGrabacion: boolean;
  pagina: number;
  tamano: number;
}

const iso = (v: string | null): string | null => {
  if (!v) return null;
  return Number.isNaN(Date.parse(v)) || v.length > 40 ? null : v;
};

/** Lee los filtros de la URL. Null si alguno trae algo que no se entiende (la ruta responde 400). */
export function filtrosDeLlamadas(params: URLSearchParams): FiltrosDeLlamadas | null {
  const ext = params.get("extension") || null;
  if (ext && !/^[A-Za-z0-9_-]{1,40}$/.test(ext)) return null;
  const desde = params.get("desde") ? iso(params.get("desde")) : null;
  const hasta = params.get("hasta") ? iso(params.get("hasta")) : null;
  if (params.get("desde") && !desde) return null;
  if (params.get("hasta") && !hasta) return null;
  const dir = params.get("direccion");
  if (dir && dir !== "in" && dir !== "out") return null;
  const pagina = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const tamano = Math.min(MAX_TAMANO_LISTA, Math.max(1, Number.parseInt(params.get("tamano") ?? `${TAMANO_LISTA}`, 10) || TAMANO_LISTA));
  return {
    extension: ext,
    desde,
    hasta,
    direccion: (dir as "in" | "out" | null) ?? null,
    conGrabacion: params.get("grabacion") === "1",
    pagina,
    tamano,
  };
}

/** Segundos que faltan para poder volver a sincronizar a mano (0 si ya se puede). */
export function esperaRestante(ultimaIso: string | null | undefined, ahora: Date, minSeg: number): number {
  if (!ultimaIso) return 0;
  const t = Date.parse(ultimaIso);
  if (Number.isNaN(t)) return 0;
  const faltan = minSeg - (ahora.getTime() - t) / 1000;
  return faltan > 0 ? Math.ceil(faltan) : 0;
}

/** ¿Alguna extensión de chofer tiene el último error «sin permiso»? Así la pantalla enseña el aviso del permiso. */
export function hayFaltaDePermiso(estados: readonly { last_error_code: string | null }[]): boolean {
  return estados.some((e) => e.last_error_code === SIN_PERMISO);
}
