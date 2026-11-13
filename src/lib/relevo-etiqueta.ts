/**
 * Cómo se NOMBRA un paso de una transferencia por relevo (D-898, migración 256). Sin dependencias, porque lo usan
 * `orderLabel` (lib/utils) y `codeLabel` (lib/order-code), que son la base de todo lo que pinta un número de orden.
 *
 * El dueño, 2026-11-05: una intertienda McAllen → Brownsville que Julio lleva de McAllen a Weslaco y, más tarde, Max de
 * Weslaco a Brownsville. La orden ya se partía en 1111a / 1111b (las cargas, D-452); cuando lo que pasa es ESTO quiere un
 * marcador propio: «Tr-1111-a» (paso a de la transferencia) y «Tr-1111-b».
 *
 * Un paso de relevo es una carga hermana (misma `order_no`, letra en `order_suffix`) que además lleva `relay_step`
 * (1 = a, 2 = b…). Sin `relay_step` es una carga partida de las de siempre y se sigue nombrando «1111a».
 */

export const PREFIJO_DE_RELEVO = "Tr";

export type ConRelevo = { relay_step?: number | null; order_suffix?: string | null };

/** ¿Es un paso de una transferencia por relevo? */
export const esPasoDeRelevo = (d: ConRelevo | null | undefined): boolean => !!d && d.relay_step != null && d.relay_step > 0;

/** La letra de un paso: 1 → a, 2 → b… */
export const letraDelPaso = (paso: number): string => String.fromCharCode(96 + paso);

/** «Tr-1111-a». `numero` es lo que hoy nombra la orden en ese sitio (su código, o su factura). */
export const etiquetaDeRelevo = (numero: string | number, letra: string): string => `${PREFIJO_DE_RELEVO}-${numero}-${letra}`;

/**
 * El número con su letra, como se enseña: «1111a» para una carga partida, «Tr-1111-a» para un paso de relevo, «1111» si
 * no hay letra. Es la ÚNICA regla de formato; `orderLabel`, `codeLabel` y las etiquetas con factura la llaman.
 */
export function numeroConLetra(numero: string | number, d: ConRelevo): string {
  const letra = d.order_suffix ?? (esPasoDeRelevo(d) ? letraDelPaso(d.relay_step as number) : "");
  return esPasoDeRelevo(d) && letra ? etiquetaDeRelevo(numero, letra) : `${numero}${letra}`;
}

/** Lo que dice la pastilla. */
export const PASTILLA_DE_RELEVO = { en: "Transfer", es: "Transferencia" } as const;

/** Texto extra para los buscadores: «tr-1111-a», para que buscar la etiqueta entera (o «tr») encuentre el paso. */
export function textoDeRelevoParaBuscar(d: { order_code?: string | null; order_no?: number | null; order_suffix?: string | null; relay_step?: number | null; invoice_num?: string | null }): string {
  if (!esPasoDeRelevo(d)) return "";
  const letra = d.order_suffix ?? letraDelPaso(d.relay_step as number);
  return [d.order_code, d.order_no, d.invoice_num].filter((x) => x != null && String(x).trim() !== "").map((x) => etiquetaDeRelevo(String(x).trim(), letra)).concat(PASTILLA_DE_RELEVO.en, PASTILLA_DE_RELEVO.es).join(" ").toLowerCase();
}

/** El error de la base, dicho en claro. Los de la 256 llevan su código delante (`RELEVO_…`). `null` si no es de estos. */
export function mensajeDelRelevo(mensaje: string | null | undefined, lang: "en" | "es"): string | null {
  const m = mensaje ?? "";
  const es = lang === "es";
  if (/RELEVO_ORDEN_DESHACER/.test(m)) return es ? "No se puede deshacer esta entrega: el siguiente paso de la transferencia ya se recogió." : "This delivery can't be undone: the next transfer step was already picked up.";
  if (/RELEVO_ORDEN/.test(m)) return es ? "Todavía no: el paso anterior de la transferencia no se ha entregado en la tienda de relevo. Este paso solo se puede recoger después." : "Not yet: the previous transfer step has not been delivered at the relay store. This step can only be picked up after that.";
  if (/RELEVO_FORBIDDEN/.test(m)) return es ? "Solo quien planifica rutas (o un admin) puede activar o deshacer un relevo." : "Only route planners (or an admin) can set up or undo a relay transfer.";
  if (/RELEVO_YA_SALIO/.test(m)) return es ? "El relevo ya no se puede deshacer: el primer paso ya se recogió." : "The relay can no longer be undone: the first step was already picked up.";
  if (/RELEVO_FIJO/.test(m)) return es ? "Es un paso de una transferencia por relevo: no se parte, no se borra y no se le cambian las tiendas. Deshaz el relevo primero." : "This is a relay transfer step: it can't be split, deleted or have its stores changed. Undo the relay first.";
  // 302 (D-1018): al reprogramar, un paso no puede quedar antes que el anterior ni después que el siguiente.
  if (/RELEVO_FECHA: move the next/.test(m)) return es ? "Primero mueve el paso siguiente de la transferencia: quedaría programado antes que este." : "Move the next transfer step first: it would be scheduled before this one.";
  if (/RELEVO_FECHA: this transfer step cannot be scheduled before/.test(m)) return es ? "No se puede: este paso de la transferencia quedaría antes que el paso anterior (o el anterior no tiene día)." : "Not allowed: this transfer step would be scheduled before the previous step (or the previous one has no date).";
  if (/RELEVO_FECHA/.test(m)) return es ? "El día del paso b no puede ser anterior a hoy ni al día del paso a." : "Step b's day can't be before today or before step a's day.";
  if (/RELEVO_TIENDA/.test(m)) return es ? "La tienda de relevo tiene que ser una tienda de Ajustes distinta del origen y del destino." : "The relay store must be a store from Settings other than the origin and the destination.";
  if (/RELEVO_NO_APLICA|RELEVO_STAGE/.test(m)) return es ? "Esta orden no admite un relevo: tiene que ser de tienda a tienda, estar aprobada, sin recoger y sin partir en cargas." : "This order can't take a relay: it must be store-to-store, approved, not picked up and not split into loads.";
  return null;
}
