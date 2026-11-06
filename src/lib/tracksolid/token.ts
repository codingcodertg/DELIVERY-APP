import { ErrorDeTracksolid, llamaTracksolid, type ConfigDeTracksolid, type FetchFn } from "./api";

// ============================================================
// El token de TrackSolid, compartido entre invocaciones (D-NEXT). Solo servidor.
//
// Jimi deja pedir token **una vez por minuto** y cada uno dura unas 2 horas. La app es serverless: cada
// invocación nace sin memoria, así que el token vive en la base (`tracksolid_state`, 257, solo llave de
// servicio) con su caducidad. Reglas:
//   · si hay uno vigente, se usa — nunca se pide otro;
//   · antes de pedir se RESERVA el turno en la base (un UPDATE condicional): de dos invocaciones a la vez
//     pide una sola, y la otra espera a que la primera lo guarde;
//   · cerca de caducar se intenta el `refresh`; si falla, se sigue con el que hay hasta que caduque;
//   · 1005/1006 («demasiado seguido») no se reintenta: se vuelve a leer la base por si otra invocación ya
//     lo guardó y, si no, se contesta «ahora no» y quien llama sirve lo último que tenía.
// ============================================================

export type TokenGuardado = { accessToken: string; refreshToken: string | null; caducaEn: number };

/** Lo que el token necesita de la base. La de verdad está en `almacen.ts`; las pruebas usan una de memoria. */
export interface AlmacenDeToken {
  leeToken(): Promise<TokenGuardado | null>;
  guardaToken(t: TokenGuardado | null): Promise<void>;
  /** Reserva el turno de pedir token si nadie lo pidió en los últimos `ventanaMs`. Atómico. */
  reservaPeticion(ahoraMs: number, ventanaMs: number): Promise<boolean>;
}

/** Segundos que se le piden a Jimi (su máximo). */
export const DURACION_DEL_TOKEN_S = 7200;
/** Un token al que le queda menos que esto ya no se usa: evita que caduque a media llamada. */
export const MARGEN_DE_CADUCIDAD_MS = 2 * 60_000;
/** Con menos que esto por delante, se intenta renovar sin esperar a que caduque. */
export const RENOVAR_ANTES_MS = 15 * 60_000;
/** Jimi: una petición de token por minuto. Se deja un colchón. */
export const VENTANA_DE_PETICION_MS = 65_000;

type RespuestaDeToken = { accessToken?: string; refreshToken?: string; expiresIn?: number | string };

export type DepsDeToken = {
  config: ConfigDeTracksolid;
  almacen: AlmacenDeToken;
  fetch: FetchFn;
  ahora?: () => number;
  /** Espera entre relecturas cuando otra invocación está pidiendo el token. */
  espera?: (ms: number) => Promise<void>;
};

const aGuardar = (r: RespuestaDeToken | null | undefined, ahora: number): TokenGuardado | null =>
  r?.accessToken ? { accessToken: r.accessToken, refreshToken: r.refreshToken ?? null, caducaEn: ahora + (Number(r.expiresIn) || DURACION_DEL_TOKEN_S) * 1000 } : null;

export const tokenVigente = (t: TokenGuardado | null, ahora: number): t is TokenGuardado => !!t && t.caducaEn - MARGEN_DE_CADUCIDAD_MS > ahora;

/**
 * Un token que vale, o `null` si ahora mismo no se puede tener (otra invocación lo está pidiendo y no
 * llegó, o Jimi dijo «demasiado seguido»). No lanza por 1005/1006; lo demás (clave mala, red) sí.
 */
export async function tokenDeTracksolid(deps: DepsDeToken): Promise<string | null> {
  const ahora = deps.ahora ?? Date.now;
  const espera = deps.espera ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const guardado = await deps.almacen.leeToken();

  if (tokenVigente(guardado, ahora())) {
    // Cerca del final: renovar, si nadie más lo está haciendo. Si no sale, el actual aún vale.
    if (guardado.caducaEn - ahora() < RENOVAR_ANTES_MS && guardado.refreshToken && await deps.almacen.reservaPeticion(ahora(), VENTANA_DE_PETICION_MS)) {
      try {
        const r = await llamaTracksolid<RespuestaDeToken>(deps.config, {
          method: "jimi.oauth.token.refresh", access_token: guardado.accessToken, refresh_token: guardado.refreshToken, expires_in: String(DURACION_DEL_TOKEN_S),
        }, { fetch: deps.fetch, ahora: () => new Date(ahora()) });
        const nuevo = aGuardar(r, ahora());
        if (nuevo) { await deps.almacen.guardaToken(nuevo); return nuevo.accessToken; }
      } catch { /* se sigue con el que hay; al caducar se pide uno nuevo */ }
    }
    return guardado.accessToken;
  }

  // No hay token que valga. Solo UNA invocación lo pide; las demás esperan a que aparezca en la base.
  const relee = async () => {
    for (let i = 0; i < 3; i++) {
      await espera(700);
      const t = await deps.almacen.leeToken();
      if (tokenVigente(t, ahora())) return t.accessToken;
    }
    return null;
  };
  if (!(await deps.almacen.reservaPeticion(ahora(), VENTANA_DE_PETICION_MS))) return relee();
  try {
    const r = await llamaTracksolid<RespuestaDeToken>(deps.config, {
      method: "jimi.oauth.token.get", user_id: deps.config.cuenta, user_pwd_md5: deps.config.claveMd5, expires_in: String(DURACION_DEL_TOKEN_S),
    }, { fetch: deps.fetch, ahora: () => new Date(ahora()) });
    const nuevo = aGuardar(r, ahora());
    if (!nuevo) throw new ErrorDeTracksolid(-2, "token missing in response");
    await deps.almacen.guardaToken(nuevo);
    return nuevo.accessToken;
  } catch (e) {
    if (e instanceof ErrorDeTracksolid && e.esDeFrecuencia) return relee();
    throw e;
  }
}
