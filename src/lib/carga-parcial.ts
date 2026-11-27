// Carga parcial al recoger, en UNA escritura (migración 357, `public.carga_parcial`).
//
// Antes el chofer partía la orden en DOS escrituras: creaba el resto y después cambiaba la original. Si la segunda
// fallaba quedaban pallets duplicados, y un reintento volvía a partir. La función de la base hace las dos cosas en una
// transacción y es idempotente por `clave`: este módulo solo llama a la función y decide qué clave usar.

export interface ErrorDeRpc {
  code?: string | null;
  message?: string | null;
}

export type ResultadoCargaParcial =
  | { estado: "ok"; restoId: string }
  /** La 357 todavía no está aplicada en la base: quien llama usa el camino de antes. */
  | { estado: "sin-funcion" }
  /** `reintentable` = no llegó respuesta de la base (sin red): la clave se conserva para reintentar sin partir dos veces. */
  | { estado: "error"; mensaje: string; reintentable: boolean };

export interface ArgsCargaParcial {
  orden: string;
  pallets: number;
  clave: string;
  /** Solo los campos de la recogida (GPS y chofer). La base rechaza cualquier otro. */
  cambios: Record<string, unknown>;
  nota: string;
  notaResto: string;
}

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: ErrorDeRpc | null }>;

/** PostgREST no encuentra la función (la 357 sin aplicar). */
export function esFuncionSinAplicar(e: ErrorDeRpc | null | undefined): boolean {
  if (!e) return false;
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");
}

/**
 * La clave de UN intento. Se genera una vez y se reusa en cada reintento de la misma orden y el mismo recuento; si
 * cambia cualquiera de los dos (el chofer corrige la cifra), es otro intento y se genera otra.
 */
export function claveDeIntento(
  previa: { clave: string; orden: string; pallets: number } | null,
  orden: string,
  pallets: number,
  nueva: () => string,
): { clave: string; orden: string; pallets: number } {
  if (previa && previa.orden === orden && previa.pallets === pallets) return previa;
  return { clave: nueva(), orden, pallets };
}

/** Llama a `carga_parcial` y traduce el resultado. Nunca lanza. */
export async function llamarCargaParcial(
  rpc: Rpc,
  a: ArgsCargaParcial,
  traduce: (mensaje: string) => string,
): Promise<ResultadoCargaParcial> {
  let res: { data: unknown; error: ErrorDeRpc | null };
  try {
    res = await rpc("carga_parcial", {
      p_orden: a.orden,
      p_pallets_cargados: a.pallets,
      p_clave: a.clave,
      p_cambios: a.cambios,
      p_nota: a.nota,
      p_nota_resto: a.notaResto,
    });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : "";
    return { estado: "error", mensaje: traduce(mensaje), reintentable: true };
  }
  if (res.error) {
    if (esFuncionSinAplicar(res.error)) return { estado: "sin-funcion" };
    // Sin código de Postgres es un fallo de transporte: no sabemos si la base llegó a escribir, así que se reintenta con la misma clave.
    return { estado: "error", mensaje: traduce(res.error.message ?? ""), reintentable: !res.error.code };
  }
  if (typeof res.data !== "string" || !res.data) {
    return { estado: "error", mensaje: traduce(""), reintentable: false };
  }
  return { estado: "ok", restoId: res.data };
}
