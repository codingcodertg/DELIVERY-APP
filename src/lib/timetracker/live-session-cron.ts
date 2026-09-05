import { CRON_CLOSE_NOTE, huerfanasDe, type SesionViva } from "./live-session";

/**
 * Parte B de D-195: cerrar las sesiones huérfanas desde un cron, no solo al abrir la pantalla.
 *
 * El guardián de huérfanas de `(timetracker)/page.tsx` solo corre cuando alguien abre el
 * cronómetro. Una sesión de quien se fue sin parar seguía `is_live` para siempre y salía en
 * "Trabajando ahora"; el repo lo pagó dos veces (25,75 h en D-098, 10,42 h de una noche). Esto
 * aplica LA MISMA regla (`huerfanasDe`: más de LATIDO_MAX_MS sin latido → cierre en el último
 * latido) contra PostgREST con la llave de servicio, y lo llama el cron.
 *
 * Habla con PostgREST por `fetch`, como los crons de fichaje, así que necesita el perfil de
 * esquema en cada llamada: sin `Accept-Profile: timetracker`, `sessions` se buscaría en
 * `public`, que no la tiene, y el cron no haría nada en silencio (ver lib/clockin/rest.ts).
 *
 * `fetchImpl` se inyecta para poder probarlo con datos sintéticos, sin red.
 */
export const TIMETRACKER_REST_HEADERS = {
  "Accept-Profile": "timetracker",
  "Content-Profile": "timetracker",
} as const;

export function timetrackerRestHeaders(key: string, extra?: Record<string, string>) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...TIMETRACKER_REST_HEADERS,
    ...(extra ?? {}),
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type CierreHuerfanas = {
  ok: boolean;
  /** Sesiones `is_live` encontradas. */
  vivas: number;
  /** De esas, cuántas llevaban más de LATIDO_MAX_MS sin latido. */
  huerfanas: number;
  /** Cuántas se cerraron de verdad (PATCH con 2xx). */
  cerradas: number;
  /** Ids cuyo PATCH falló; quedan para la próxima pasada. */
  fallidas: string[];
};

type Row = { id: string; start_ms: number | string | null; end_ms: number | string | null };

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function cerrarSesionesHuerfanas(opts: {
  url: string;
  key: string;
  now?: number;
  fetchImpl?: FetchLike;
}): Promise<CierreHuerfanas> {
  const { url, key } = opts;
  const now = opts.now ?? Date.now();
  const f: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const H = timetrackerRestHeaders(key);

  const r = await f(`${url}/rest/v1/sessions?select=id,start_ms,end_ms&is_live=eq.true`, { headers: H, cache: "no-store" });
  if (!r.ok) return { ok: false, vivas: 0, huerfanas: 0, cerradas: 0, fallidas: [] };
  const raw = await r.json();
  const rows = (Array.isArray(raw) ? raw : []) as Row[];
  const vivas: SesionViva[] = rows
    .filter((x) => x && typeof x.id === "string")
    .map((x) => ({ id: x.id, startMs: num(x.start_ms), endMs: num(x.end_ms) }));

  const huerfanas = huerfanasDe(vivas, now);
  let cerradas = 0;
  const fallidas: string[] = [];
  for (const { sesion, cierre } of huerfanas) {
    // `is_live=eq.true` también en el PATCH: si la persona la paró entre el SELECT y aquí, o
    // la cerró la pantalla, el filtro no casa y no se pisa nada. Idempotente por construcción.
    const res = await f(`${url}/rest/v1/sessions?id=eq.${encodeURIComponent(sesion.id)}&is_live=eq.true`, {
      method: "PATCH",
      headers: { ...H, Prefer: "return=minimal" },
      // `live_note` deja dicho que la cerró el cron (D-NEXT): la pantalla solo reabre una sesión
      // con esta marca, y solo si su reloj local nunca se detuvo. Un Stop escribe null.
      body: JSON.stringify({ is_live: false, end_ms: cierre.endMs, duration_seconds: cierre.durationSeconds, live_note: CRON_CLOSE_NOTE }),
    });
    if (res.ok) cerradas++; else fallidas.push(sesion.id);
  }
  return { ok: true, vivas: vivas.length, huerfanas: huerfanas.length, cerradas, fallidas };
}
