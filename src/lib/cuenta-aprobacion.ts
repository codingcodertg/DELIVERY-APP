import type { AccountRecord } from "@/lib/types";

/**
 * Cuentas que SIEMPRE pasan por oficina (D-NEXT).
 *
 * El dueño: «ya que se den de alta los clientes, estos clientes siempre van a requerir aprobación
 * de oficina». Es una marca por cuenta —`requires_approval`— que gana a la aprobación automática
 * de la tienda: la orden nace `pending` y la aprueba alguien, aunque la tienda esté configurada
 * para aprobar sola.
 *
 * La regla vive aquí, en funciones puras, porque la aplican DOS sitios que tienen que decir lo
 * mismo: la pantalla que crea la orden y el guard de la base (migración 123). Si cada uno la
 * escribiera por su cuenta, el botón diría «Crear orden (aprobada)» y la base la dejaría pendiente,
 * o al revés.
 */

/** Cómo se compara el nombre de una cuenta: sin espacios de sobra y sin distinguir mayúsculas. */
const clave = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * ¿Esta cuenta está marcada como «siempre con aprobación»?
 *
 * Una orden sin cuenta, o con una cuenta que no está en Ajustes, **no** pide aprobación por esta
 * vía: lo que decide es la marca, no el desconocimiento. Lo que no se sabe no se inventa.
 */
export function cuentaRequiereAprobacion(
  cuentas: AccountRecord[] | null | undefined,
  nombre: string | null | undefined,
): boolean {
  const k = clave(nombre);
  if (!k) return false;
  return (cuentas ?? []).some((c) => clave(c.name) === k && !!c.requires_approval);
}

/** Lo que decide si una orden NUEVA nace aprobada en vez de pendiente. */
export type QuienCrea = {
  /** Gerente de oficina u Office: sus órdenes nacen aprobadas (D-279). */
  creaComoOficina: boolean;
  /** La tienda desde la que se vende aprueba sola (`auto_approve` en Ajustes). */
  tiendaAutoAprueba: boolean;
  /** La cuenta de la orden está marcada como «siempre con aprobación» (D-NEXT). */
  cuentaPideAprobacion: boolean;
  /** Intertienda sin PO: eso ya iba a pendiente antes de esta regla. */
  intertiendaSinPo: boolean;
};

/**
 * ¿Nace aprobada?
 *
 * La marca de la cuenta **manda sobre todo lo demás**, que es lo que pidió el dueño: ni la tienda
 * que aprueba sola ni que la cree la propia oficina saltan ese paso. Una Intertienda sin PO sigue
 * yendo a pendiente, como antes.
 */
export function naceAprobada(q: QuienCrea): boolean {
  if (q.cuentaPideAprobacion) return false;
  if (q.intertiendaSinPo) return false;
  return q.creaComoOficina || q.tiendaAutoAprueba;
}
