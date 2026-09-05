/**
 * Poda de `public.driver_locations` (G-23, D-NEXT).
 *
 * `public.prune_driver_locations(keep_days)` existe desde la migración 043 y nadie la llamaba:
 * a ~170 filas/día/chofer la tabla crecía sin techo, con realtime encima. Esto la llama desde
 * el cron con la **clave de servicio** por PostgREST (`/rest/v1/rpc/...`), nunca con el cliente
 * de un usuario: la función es `security definer` y hoy puede estar ejecutable por cualquier
 * autenticado; revocar eso es una migración aparte (otra rama, con plan y aprobación), y este
 * llamador ya está bien para cuando se revoque.
 *
 * `keep_days` = 90 por defecto: conservador a propósito, porque no hay respaldo (F-3) y un borrado
 * no se deshace; el dueño puede bajarlo. Perfil de esquema `public` explícito: el resto del cron
 * habla con `clockin`/`timetracker`, y sin perfil PostgREST contestaría desde `public` igual, pero
 * que quede escrito y no heredado.
 *
 * `fetchImpl` se inyecta para probarlo con datos sintéticos, sin red.
 */
export const PRUNE_KEEP_DAYS = 90;
/**
 * Suelo (observación del auditor, hecha suya por el orquestador): con el secreto del cron
 * filtrado, `?keep_days=1` habría vaciado casi toda la tabla. Nada por debajo de 30 días, ni
 * por parámetro ni por código: la librería lo sube a 30 y la ruta responde 400 a un valor menor.
 */
export const PRUNE_KEEP_DAYS_MIN = 30;

export type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export type PrunePodaResult = { ok: true; keepDays: number; removed: number } | { ok: false; keepDays: number; status: number; error: string };

export async function pruneDriverLocations(opts: {
  url: string;
  key: string;
  keepDays?: number;
  fetchImpl?: FetchLike;
}): Promise<PrunePodaResult> {
  const keepDays = Math.max(PRUNE_KEEP_DAYS_MIN, Math.floor(opts.keepDays ?? PRUNE_KEEP_DAYS));
  const f: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const res = await f(`${opts.url}/rest/v1/rpc/prune_driver_locations`, {
    method: "POST",
    headers: {
      apikey: opts.key,
      Authorization: `Bearer ${opts.key}`,
      "Content-Type": "application/json",
      "Accept-Profile": "public",
      "Content-Profile": "public",
    },
    body: JSON.stringify({ keep_days: keepDays }),
  });
  if (!res.ok) {
    let error = "";
    try { error = await res.text(); } catch { error = ""; }
    return { ok: false, keepDays, status: res.status, error: error || `HTTP ${res.status}` };
  }
  const body = await res.json();
  const removed = typeof body === "number" ? body : Number(body) || 0;
  return { ok: true, keepDays, removed };
}
