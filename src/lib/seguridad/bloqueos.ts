// ============================================================
// La lista de IPs bloqueadas, en memoria, para el middleware (320).
//
// Corre en el borde (edge), así que NO importa nada de Node ni `server-only`. La lista se trae de `sec_blocks` con
// `fetch` y se guarda 60 s por instancia: una petición normal no paga una consulta. Si la consulta falla, se conserva la
// lista anterior (sin los vencidos) y no se bloquea nada que no se conozca: fail-open.
// ============================================================

export interface BloqueoActivo {
  alcance: string;
  valor: string;
  hasta: string;
}

export type CargaBloqueos = () => Promise<BloqueoActivo[]>;

export const TTL_BLOQUEOS_MS = 60_000;

/** Cache de bloqueos con su propio reloj (inyectable para las pruebas). */
export function creaCacheDeBloqueos(
  carga: CargaBloqueos,
  opts: { ttlMs?: number; ahora?: () => number } = {},
) {
  const ttl = opts.ttlMs ?? TTL_BLOQUEOS_MS;
  const ahora = opts.ahora ?? (() => Date.now());
  let lista: BloqueoActivo[] = [];
  let cargadoEn = Number.NEGATIVE_INFINITY;
  let enCurso: Promise<void> | null = null;

  async function refresca(): Promise<void> {
    try {
      lista = await carga();
    } catch {
      // Se conserva la lista anterior: los que ya vencieron se descartan al comprobar (ver `ipBloqueada`).
    }
    cargadoEn = ahora();
  }

  return {
    /** ¿Esta IP tiene un bloqueo vigente ahora mismo? Nunca lanza: ante cualquier duda, `false`. */
    async ipBloqueada(ip: string | null | undefined): Promise<boolean> {
      try {
        if (!ip) return false;
        if (ahora() - cargadoEn >= ttl) {
          enCurso ??= refresca().finally(() => { enCurso = null; });
          await enCurso;
        }
        const t = ahora();
        return lista.some((b) => b.alcance === "ip" && b.valor === ip && Date.parse(b.hasta) > t);
      } catch {
        return false;
      }
    },
  };
}

/** Lee los bloqueos de IP vigentes de `sec_blocks` con la llave de servicio (REST, sin SDK: vale en el borde). */
export async function cargaBloqueosActivos(fetchImpl: typeof fetch = fetch): Promise<BloqueoActivo[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !llave) throw new Error("sin URL o llave de servicio para leer los bloqueos");
  const ahoraIso = new Date().toISOString();
  const res = await fetchImpl(
    `${url}/rest/v1/sec_blocks?select=alcance,valor,hasta&alcance=eq.ip&hasta=gt.${encodeURIComponent(ahoraIso)}`,
    { headers: { apikey: llave, Authorization: `Bearer ${llave}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`sec_blocks respondió ${res.status}`);
  const filas = (await res.json()) as BloqueoActivo[];
  return Array.isArray(filas) ? filas : [];
}

/** El cache que usa el middleware. Un solo objeto por instancia del borde. */
export const bloqueosDeIp = creaCacheDeBloqueos(() => cargaBloqueosActivos());
