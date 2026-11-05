import { destinoDelAvisoDeAyuda } from "@/lib/help-thread";
import { destinoDelAvisoDeSolicitud } from "@/lib/solicitud-de-asignacion";
import { enlaceSeguro } from "@/lib/customers/avisos-de-solicitud";

/**
 * A dónde lleva un aviso de la campana al pulsarlo (D-NEXT). Lo usan las dos campanas: la de Entregas y la de Clientes.
 *
 * 1. Su `link` (243), si es una ruta interna.
 * 2. Los avisos de ayuda, a la conversación (D-311); las solicitudes de asignación, a la bandeja o a su orden (D-560).
 * 3. Los de una orden, a la orden.
 */
export function destinoDelAviso(n: { kind: string; delivery_id: string | null; link?: string | null }): string | null {
  return enlaceSeguro(n.link)
    ?? destinoDelAvisoDeAyuda(n.kind)
    ?? destinoDelAvisoDeSolicitud(n.kind, n.delivery_id)
    ?? (n.delivery_id ? `/?order=${n.delivery_id}` : null);
}
