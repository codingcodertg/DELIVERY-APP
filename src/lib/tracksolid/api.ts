import { firma, marcaDeTiempo } from "./firma";

// ============================================================
// Las llamadas al Open API de TrackSolid Pro (D-900). Solo servidor.
//
// Un solo POST con formulario a `/route/rest`; el `method` dice qué se pide. Aquí no hay caché ni
// reintentos: eso lo deciden `token.ts` y `posiciones.ts`. Lo que sí hay es una regla: **nada de lo
// que sale de aquí lleva las llaves** — ni los errores, que solo cargan el código y el mensaje de Jimi.
// ============================================================

/** Nodo de EE. UU. Los otros (HK, EU) son otra cuenta; la de la empresa vive aquí. */
export const URL_DE_TRACKSOLID = "https://us-open.tracksolidpro.com/route/rest";

/** Token inválido o caducado: se tira el guardado y se pide otro. */
export const CODIGO_TOKEN_INVALIDO = 1004;
/** «Demasiadas llamadas»: 1005 por IP, 1006 por frecuencia (el token admite una petición por minuto). */
export const CODIGOS_DE_FRECUENCIA = [1005, 1006];

export type ConfigDeTracksolid = { appKey: string; appSecret: string; cuenta: string; claveMd5: string };

export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ json: () => Promise<unknown> }>;

/** Las cuatro variables, o `null` si falta alguna: sin ellas la función se esconde, no falla. */
export function configDeTracksolid(env: Record<string, string | undefined> = process.env): ConfigDeTracksolid | null {
  const appKey = env.TRACKSOLID_APP_KEY?.trim(), appSecret = env.TRACKSOLID_APP_SECRET?.trim();
  const cuenta = env.TRACKSOLID_ACCOUNT?.trim(), claveMd5 = env.TRACKSOLID_PASSWORD_MD5?.trim();
  if (!appKey || !appSecret || !cuenta || !claveMd5) return null;
  return { appKey, appSecret, cuenta, claveMd5: claveMd5.toLowerCase() };
}

/** Un fallo de TrackSolid. `codigo` es el de Jimi (o -2 si ni siquiera contestó JSON). Nunca lleva llaves. */
export class ErrorDeTracksolid extends Error {
  constructor(public codigo: number, mensaje: string) {
    super(`TrackSolid ${codigo}: ${mensaje}`);
    this.name = "ErrorDeTracksolid";
  }
  get esDeFrecuencia() { return CODIGOS_DE_FRECUENCIA.includes(this.codigo); }
  get esTokenInvalido() { return this.codigo === CODIGO_TOKEN_INVALIDO; }
}

/** El cuerpo firmado de una llamada. Aparte para poder probarlo sin red. */
export function cuerpoFirmado(config: ConfigDeTracksolid, parametros: Record<string, string>, ahora: Date = new Date()): Record<string, string> {
  const q: Record<string, string> = { ...parametros, timestamp: marcaDeTiempo(ahora), app_key: config.appKey, sign_method: "md5", v: "1.0", format: "json" };
  q.sign = firma(q, config.appSecret);
  return q;
}

/** Llama y devuelve `result`; cualquier `code` distinto de 0 es un `ErrorDeTracksolid`. */
export async function llamaTracksolid<T>(config: ConfigDeTracksolid, parametros: Record<string, string>, deps: { fetch: FetchFn; ahora?: () => Date }): Promise<T> {
  const cuerpo = cuerpoFirmado(config, parametros, deps.ahora?.() ?? new Date());
  type Respuesta = { code?: number; message?: string; result?: T } | null;
  const json = await (async (): Promise<Respuesta> => {
    try {
      const r = await deps.fetch(URL_DE_TRACKSOLID, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(cuerpo).toString(),
        signal: AbortSignal.timeout(12_000),
      });
      return (await r.json()) as Respuesta;
    } catch {
      // Sin el error original a proposito: el de fetch puede citar la peticion.
      throw new ErrorDeTracksolid(-2, "no response");
    }
  })();
  if (!json || json.code !== 0) throw new ErrorDeTracksolid(Number(json?.code ?? -2), String(json?.message ?? "bad response").slice(0, 200));
  return json.result as T;
}
