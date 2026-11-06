import { ErrorDeTracksolid, llamaTracksolid, type ConfigDeTracksolid, type FetchFn } from "./api";
import { camionDesdeJimi, type CamionDeTracksolid, type EquipoCrudo } from "./camiones";
import { tokenDeTracksolid, type AlmacenDeToken } from "./token";

// ============================================================
// Las últimas posiciones de los camiones, con caché (D-900). Solo servidor.
//
// Varias pantallas abiertas preguntan cada minuto; a TrackSolid se le pregunta como mucho una vez cada
// ~30 s. La caché tiene dos pisos: la memoria de la instancia (gratis, pero cada invocación serverless
// puede caer en otra) y la base (`tracksolid_state`, 257), que comparten todas.
//
// Si TrackSolid falla o no hay token ahora mismo, se sirve lo último que se leyó, marcado `atrasado`:
// un mapa con la posición de hace dos minutos vale más que un mapa sin camiones.
// ============================================================

export type PosicionDeCamion = Omit<CamionDeTracksolid, "choferId" | "chofer" | "tienda">;
export type LecturaDePosiciones = { camiones: PosicionDeCamion[]; leidoEn: number };

export interface AlmacenDePosiciones extends AlmacenDeToken {
  leePosiciones(): Promise<LecturaDePosiciones | null>;
  guardaPosiciones(l: LecturaDePosiciones): Promise<void>;
}

/** Cuánto vale una lectura antes de volver a preguntarle a TrackSolid. */
export const CACHE_DE_POSICIONES_MS = 30_000;

/** La memoria de la instancia. Un objeto, para que las pruebas pasen el suyo. */
export type MemoriaDePosiciones = { ultima: LecturaDePosiciones | null };
const memoriaDeLaInstancia: MemoriaDePosiciones = { ultima: null };

export type DepsDePosiciones = {
  config: ConfigDeTracksolid;
  almacen: AlmacenDePosiciones;
  fetch: FetchFn;
  ahora?: () => number;
  espera?: (ms: number) => Promise<void>;
  memoria?: MemoriaDePosiciones;
};

export type ResultadoDePosiciones = LecturaDePosiciones & {
  /** No se pudo leer ahora: esto es lo último que se tenía. */
  atrasado: boolean;
};

/** `null` solo si TrackSolid no contesta y nunca se había leído nada. */
export async function posicionesDeCamiones(deps: DepsDePosiciones): Promise<ResultadoDePosiciones | null> {
  const ahora = deps.ahora ?? Date.now;
  const memoria = deps.memoria ?? memoriaDeLaInstancia;
  const fresca = (l: LecturaDePosiciones | null) => !!l && ahora() - l.leidoEn < CACHE_DE_POSICIONES_MS;

  if (memoria.ultima && fresca(memoria.ultima)) return { ...memoria.ultima, atrasado: false };
  const guardada = await deps.almacen.leePosiciones();
  if (guardada && (!memoria.ultima || guardada.leidoEn > memoria.ultima.leidoEn)) memoria.ultima = guardada;
  if (memoria.ultima && fresca(memoria.ultima)) return { ...memoria.ultima, atrasado: false };

  const loUltimo = () => (memoria.ultima ? { ...memoria.ultima, atrasado: true } : null);
  const lee = (token: string) => llamaTracksolid<EquipoCrudo[]>(deps.config, {
    method: "jimi.user.device.location.list", access_token: token, target: deps.config.cuenta,
  }, { fetch: deps.fetch, ahora: () => new Date(ahora()) });

  try {
    let token = await tokenDeTracksolid(deps);
    if (!token) return loUltimo();
    let crudos: EquipoCrudo[];
    try {
      crudos = await lee(token);
    } catch (e) {
      // El token guardado ya no vale (lo revocaron, o caducó antes de lo dicho): se tira y se pide otro, UNA vez.
      if (!(e instanceof ErrorDeTracksolid && e.esTokenInvalido)) throw e;
      await deps.almacen.guardaToken(null);
      token = await tokenDeTracksolid(deps);
      if (!token) return loUltimo();
      crudos = await lee(token);
    }
    const lectura: LecturaDePosiciones = {
      camiones: (Array.isArray(crudos) ? crudos : []).flatMap((e) => camionDesdeJimi(e) ?? []),
      leidoEn: ahora(),
    };
    memoria.ultima = lectura;
    await deps.almacen.guardaPosiciones(lectura).catch(() => { /* la memoria ya la tiene */ });
    return { ...lectura, atrasado: false };
  } catch (e) {
    // Solo el código: el mensaje de un error de red podría citar la petición.
    console.warn("[tracksolid] no se pudieron leer las posiciones:", e instanceof ErrorDeTracksolid ? e.codigo : "error");
    return loUltimo();
  }
}
