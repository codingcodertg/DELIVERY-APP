import "server-only";
import { registraEvento, type EventoSec } from "@/lib/seguridad/registro";

// ============================================================
// Rechazos del limitador, sin inundar la base (320, revisión): en vez de una fila por petición rechazada, cada instancia
// acumula los rechazos por bucket y escribe UNA fila por bucket como mucho cada minuto, con `meta.hits` = los rechazos
// acumulados desde la última escritura. Así el conteo se conserva (el detector suma `hits`) y el costo queda acotado.
// Al pasar del tope de memoria, se desalojan los buckets más viejos ESCRIBIENDO antes sus rechazos pendientes.
// Límite conocido: lo acumulado en buckets que siguen vivos se pierde si la instancia se apaga.
// ============================================================

export const CADA_MS_RECHAZOS = 60_000;
const MAX_BUCKETS = 2_000;

type Evento = Omit<EventoSec, "categoria" | "meta">;
type Escribe = (e: EventoSec) => unknown;
type Pendiente = { n: number; ultima: number; evento: Evento };
const pendientes = new Map<string, Pendiente>();

/** Desaloja los buckets más viejos hasta dejar sitio, escribiendo primero los rechazos que aún no salieron. */
function desalojaViejos(escribe: Escribe, hueco: number): void {
  const sobra = pendientes.size - MAX_BUCKETS + hueco;
  if (sobra <= 0) return;
  const viejos = [...pendientes].sort((a, b) => a[1].ultima - b[1].ultima).slice(0, sobra);
  for (const [clave, p] of viejos) {
    if (p.n > 0) void escribe({ ...p.evento, categoria: "ratelimit", meta: { hits: p.n } });
    pendientes.delete(clave);
  }
}

/** Cuenta un rechazo del bucket `clave` y, si ya pasó el minuto, escribe la fila con los rechazos acumulados. */
export function anotaRechazo(
  clave: string,
  evento: Evento,
  ahora: number = Date.now(),
  escribe: Escribe = (e) => registraEvento(e),
): boolean {
  if (!pendientes.has(clave)) desalojaViejos(escribe, 1);
  const p = pendientes.get(clave) ?? { n: 0, ultima: 0, evento };
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

/** Solo para las pruebas: vacía la memoria sin escribir nada. */
export function vaciaRechazosParaPruebas(): void {
  pendientes.clear();
}

/** La clave de acumulación: bucket e IP juntos, para que dos IPs nunca compartan rechazos (un bloqueo caería en la IP equivocada). */
export function claveDeRechazo(bucket: string, ip: string): string {
  return `${bucket}|${ip}`;
}
