import { igualesEnTiempoConstante } from "@/lib/comparar-secreto";

/**
 * Puerta de las rutas programadas (cron) de clock-in y de los demás crons.
 *
 * SOLO `Authorization: Bearer <CRON_SECRET>`: es lo que manda Vercel Cron y lo que mandan los workflows de GitHub
 * (`.github/workflows/*.yml`). El antiguo `?key=<CRON_SECRET>` se QUITÓ: un secreto en la URL acaba en cada log de
 * acceso, proxy y cabecera Referer por el camino.
 *
 * La comparación es en tiempo constante (SHA-256 + `timingSafeEqual`), para que el tiempo de respuesta no revele
 * cuántos caracteres del secreto coinciden.
 *
 * Falla cerrado: sin CRON_SECRET nadie entra. Lo contrario (`if (secret && key !== secret)`) se lee casi igual y deja
 * la ruta abierta en cuanto falta la variable.
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return igualesEnTiempoConstante(header, `Bearer ${secret}`);
}
