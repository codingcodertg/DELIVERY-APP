import type { NamedLocation } from "./types";

/**
 * D-801 (2026-11-02): ¿auto-aprueban TODAS las tiendas que esta persona ve? Decide el chip de entrada de Órdenes para
 * gerente y vendedor («Pendiente» o «Programadas») y si el chip «Pendiente» se enseña.
 *
 * Antes se miraban TODAS las tiendas de Ajustes: con una sola que no auto-aprueba (McAllen), un vendedor de Pharr
 * —que auto-aprueba y por eso nunca tiene pendientes— entraba en «Pendiente» y veía la lista vacía. El dueño: «Melecio
 * no puede ver nada en órdenes, le aparece vacío». Medido en la base: 249 órdenes de Pharr en 60 días, 0 pendientes.
 *
 * Las tiendas que ve: `visible_stores` del perfil (la regla de `tiendas_visibles()` en la base) y, sin ellas, su
 * `store`; admin, chofer y almacén ven todas. Sin tiendas en Ajustes, false (no hay nada que auto-apruebe).
 */
export function todasLasMiasAutoAprueban(
  stores: readonly Pick<NamedLocation, "name" | "auto_approve">[],
  yo: { role?: string | null; store?: string | null; visible_stores?: readonly string[] | null } | null | undefined,
): boolean {
  if (stores.length === 0) return false;
  const nombres = tiendasQueVe(yo);
  const mias = nombres === null ? stores : stores.filter((s) => nombres.includes(s.name.trim().toLowerCase()));
  if (mias.length === 0) return stores.every((s) => !!s.auto_approve);
  return mias.every((s) => !!s.auto_approve);
}

/** En minúsculas y sin espacios, como `tiendas_visibles()`; null = todas. */
export function tiendasQueVe(yo: { role?: string | null; store?: string | null; visible_stores?: readonly string[] | null } | null | undefined): string[] | null {
  if (!yo) return null;
  if (yo.role === "admin" || yo.role === "driver" || yo.role === "warehouse") return null;
  const lista = (yo.visible_stores ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (lista.length > 0) return lista;
  const propia = (yo.store ?? "").trim().toLowerCase();
  return propia ? [propia] : null;
}
