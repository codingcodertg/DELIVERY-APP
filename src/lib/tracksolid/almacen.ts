import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AlmacenDePosiciones, LecturaDePosiciones } from "./posiciones";
import type { TokenGuardado } from "./token";

// ============================================================
// Donde vive el estado de TrackSolid en la base (257): el token y la última lectura de posiciones.
//
// Una sola fila (`id = 1`) en `tracksolid_state`, sin ninguna política: solo la llave de servicio la lee.
// El token es una credencial — con él se lee dónde está cada camión —, así que no sale nunca de aquí.
//
// Cliente propio y NO `createAdminClient`: aquel corta las escrituras en modo enseñanza (D-626), y un
// token que no se pudiera guardar se volvería a pedir en cada llamada, que es justo lo que Jimi castiga
// con 1006. Esto no es un dato de la empresa que alguien practique: es fontanería.
// ============================================================

/** La base no tiene (todavía) la 257, o no hay llave de servicio: la función se esconde. */
export class AlmacenNoDisponible extends Error {
  constructor(detalle: string) { super(`tracksolid: almacén no disponible (${detalle})`); this.name = "AlmacenNoDisponible"; }
}

export function clienteDeServicioDeTracksolid(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) throw new AlmacenNoDisponible("sin llave de servicio");
  return createClient(url, llave, { auth: { autoRefreshToken: false, persistSession: false } });
}

type Fila = { access_token: string | null; refresh_token: string | null; token_expires_at: string | null; positions: unknown; positions_at: string | null };

export function almacenEnSupabase(db: SupabaseClient): AlmacenDePosiciones {
  const tabla = () => db.from("tracksolid_state");
  const fila = async (columnas: string): Promise<Partial<Fila> | null> => {
    const { data, error } = await tabla().select(columnas).eq("id", 1).maybeSingle();
    if (error) throw new AlmacenNoDisponible(error.code ?? "lectura");
    return data as Partial<Fila> | null;
  };
  return {
    async leeToken() {
      const f = await fila("access_token, refresh_token, token_expires_at");
      if (!f?.access_token || !f.token_expires_at) return null;
      return { accessToken: f.access_token, refreshToken: f.refresh_token ?? null, caducaEn: new Date(f.token_expires_at).getTime() };
    },
    async guardaToken(t: TokenGuardado | null) {
      const { error } = await tabla().update({
        access_token: t?.accessToken ?? null, refresh_token: t?.refreshToken ?? null,
        token_expires_at: t ? new Date(t.caducaEn).toISOString() : null,
      }).eq("id", 1);
      if (error) throw new AlmacenNoDisponible(error.code ?? "escritura");
    },
    async reservaPeticion(ahoraMs: number, ventanaMs: number) {
      // Un solo UPDATE condicional: de dos invocaciones a la vez, Postgres deja pasar una.
      const corte = new Date(ahoraMs - ventanaMs).toISOString();
      const { data, error } = await tabla().update({ token_requested_at: new Date(ahoraMs).toISOString() })
        .eq("id", 1).or(`token_requested_at.is.null,token_requested_at.lt.${corte}`).select("id");
      if (error) throw new AlmacenNoDisponible(error.code ?? "reserva");
      return (data ?? []).length > 0;
    },
    async leePosiciones() {
      const f = await fila("positions, positions_at");
      if (!f?.positions_at || !Array.isArray(f.positions)) return null;
      return { camiones: f.positions as LecturaDePosiciones["camiones"], leidoEn: new Date(f.positions_at).getTime() };
    },
    async guardaPosiciones(l: LecturaDePosiciones) {
      const { error } = await tabla().update({ positions: l.camiones, positions_at: new Date(l.leidoEn).toISOString() }).eq("id", 1);
      if (error) throw new AlmacenNoDisponible(error.code ?? "escritura");
    },
  };
}
