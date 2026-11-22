// ============================================================
// El boleto de un cron que sale de la base (D-1129, migración 342).
//
// pg_cron llama a `public.llama_cron(ruta)`, que guarda un token al azar en `cron_tickets` y hace el GET con
// `Authorization: Bearer boleto:<token>`. Aquí se comprueba: el token existe, es PARA ESTA RUTA, tiene menos de 3
// minutos, y se borra al usarlo (un solo uso). La tabla solo la escriben postgres y service_role, así que nadie de fuera
// puede fabricar un boleto. No sustituye a `cronAuthorized` (el CRON_SECRET de Vercel y GitHub): es la otra puerta.
// ============================================================

export const PREFIJO_DEL_BOLETO = "Bearer boleto:";
export const VIDA_DEL_BOLETO_MS = 3 * 60_000;

/** El token que trae la petición, o null si no trae boleto (o no tiene forma de boleto). */
export function boletoDe(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith(PREFIJO_DEL_BOLETO)) return null;
  const t = h.slice(PREFIJO_DEL_BOLETO.length).trim();
  return /^[a-f0-9]{32,128}$/.test(t) ? t : null;
}

/** Lo mínimo de la base que hace falta, para poder probarlo sin Supabase. */
export interface BaseDeBoletos {
  /** Borra el boleto (token + ruta, creado desde `desde`) y dice cuántos borró. */
  gastaBoleto: (token: string, ruta: string, desde: string) => Promise<number>;
}

/** ¿La petición trae un boleto válido para esta ruta? Lo gasta al comprobarlo. Ante cualquier error, no. */
export async function boletoValido(req: Request, ruta: string, base: BaseDeBoletos, ahora: Date = new Date()): Promise<boolean> {
  const token = boletoDe(req);
  if (!token) return false;
  try {
    return (await base.gastaBoleto(token, ruta, new Date(ahora.getTime() - VIDA_DEL_BOLETO_MS).toISOString())) === 1;
  } catch {
    return false;
  }
}
