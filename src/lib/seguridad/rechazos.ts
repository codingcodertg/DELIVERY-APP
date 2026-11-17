import "server-only";
import { registraEvento, type EventoSec } from "@/lib/seguridad/registro";

// ============================================================
// Rechazos del limitador, sin inundar la base (320, revisión): en vez de una fila por petición rechazada, cada instancia
// acumula los rechazos por bucket y escribe UNA fila por bucket como mucho cada minuto, con `meta.hits` = los rechazos
// acumulados desde la última escritura. Así el conteo se conserva (el detector suma `hits`) y el costo queda acotado.
// Límite conocido: lo acumulado y no escrito se pierde si la instancia se apaga; y el tope de memoria vacía el mapa.
// ============================================================

export const CADA_MS_RECHAZOS = 60_000;
const MAX_BUCKETS = 2_000;

type Pendiente = { n: number; ultima: number };
const pendientes = new Map<string, Pendiente>();

/** Cuenta un rechazo del bucket `clave` y, si ya pasó el minuto, escribe la fila con los rechazos acumulados. */
export function anotaRechazo(
  clave: string,
  evento: Omit<EventoSec, "categoria" | "meta">,
  ahora: number = Date.now(),
  escribe: (e: EventoSec) => unknown = (e) => registraEvento(e),
): boolean {
  if (pendientes.size > MAX_BUCKETS) pendientes.clear();
  const p = pendientes.get(clave) ?? { n: 0, ultima: 0 };
  p.n += 1;
  if (ahora - p.ultima < CADA_MS_RECHAZOS) {
    pendientes.set(clave, p);
    return false;
  }
  const hits = p.n;
  p.n = 0;
  p.ultima = ahora;
  pendientes.set(clave, p);
  void escribe({ ...evento, categoria: "ratelimit", meta: { hits } });
  return true;
}

/** Solo para las pruebas: cuántos buckets hay en memoria. */
export function bucketsEnMemoria(): number {
  return pendientes.size;
}
