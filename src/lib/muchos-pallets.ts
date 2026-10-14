/**
 * Una orden de muchos pallets pide confirmación (D-541).
 *
 * El dueño, 2026-10-13: *«anything over 10 pallets ask the user are you sure this is this x amount because this order
 * will requiere multuple trips»*. Diez es lo que carga un camión hoy (`driver_capacity`: los cuatro choferes en 10).
 * Medido ese día: 5 de 578 órdenes de los últimos 60 días pasaban de 10 — la mayoría de las veces será un dedazo.
 *
 * Avisa, no bloquea: una orden de verdad grande existe, y se reparte en varios viajes.
 */
export const PALLETS_DE_UN_VIAJE = 10;

/** Los pallets a confirmar, o `null` si no hace falta preguntar. Vacío, no numérico o ≤ 10: nada. */
export function palletsAConfirmar(estPallets: number | string | null | undefined): number | null {
  const n = typeof estPallets === "string" ? Number(estPallets.trim()) : estPallets;
  if (n == null || !Number.isFinite(n)) return null;
  return n > PALLETS_DE_UN_VIAJE ? n : null;
}
