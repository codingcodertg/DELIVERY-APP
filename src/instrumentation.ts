// El gancho de Next para las fallas del SERVIDOR (2026-11-25). Next llama a `onRequestError` con cada error que sale de
// una ruta /api, de una acción de servidor, de un cron o de un render. Así se cubren todos esos sitios desde un solo
// punto, sin tocar cada fichero (ver `conRegistroDeFallas` en src/lib/fallas/servidor.ts para el envoltorio por función).
// Un error que ya pasó por el envoltorio no se cuenta dos veces (la marca del propio error).

import type { OrigenDeServidor } from "@/lib/fallas/servidor";

type Contexto = { routePath: string; routeType: "render" | "route" | "action" | "middleware" };

/** Qué origen le toca a una falla según por dónde salió. */
export function origenDeLaFalla(contexto: Contexto): OrigenDeServidor {
  if (contexto.routeType === "action") return "accion";
  if (contexto.routePath.startsWith("/api/cron")) return "cron";
  if (contexto.routePath.startsWith("/api")) return "api";
  return "servidor";
}

export async function onRequestError(
  error: unknown,
  peticion: Readonly<{ path: string; method: string }>,
  contexto: Readonly<Contexto>,
): Promise<void> {
  // El gancho corre en Node y en el borde; la base de la anotación solo se usa en Node.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { registrarFallaDelServidor, yaRegistrada, marcarRegistrada } = await import("@/lib/fallas/servidor");
    if (yaRegistrada(error)) return;
    marcarRegistrada(error);
    await registrarFallaDelServidor({
      origen: origenDeLaFalla(contexto),
      ruta: contexto.routePath || peticion.path || "/",
      componente: `${contexto.routeType} ${peticion.method}`,
      app: null,
      error,
    });
  } catch {
    // Anotar no puede tumbar nada: el error original ya lo gestiona Next.
  }
}
