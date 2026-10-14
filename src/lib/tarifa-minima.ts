import type { NamedLocation, UserRole } from "@/lib/types";
import { orderTypeRule, type OrderTypeRules } from "@/lib/required";
import { normalizaTienda } from "@/lib/visibilidad-tienda";

/**
 * La tarifa mínima que un vendedor puede cobrar en una tienda (D-546).
 *
 * El dueño, el 2026-10-14: *«En mcallen los vendedores no usan descuento de cobro como excepcion. La
 * tarifa es 100 minimo. Tenemos que quitarles esa opcion de descuento»*. Es un dato **de la tienda**
 * (`settings.stores[*].tarifa_minima_ventas`, como los choferes dedicados de D-544), no un nombre de
 * tienda escrito en el código: otra tienda que quiera lo mismo se configura en Datos → Tiendas.
 *
 * Con mínimo puesto, y solo para el rol `sales`: el botón «Descuento» (D-303/D-317) no se ofrece, y una
 * tarifa por debajo del mínimo —o vacía— no se envía. Oficina, gerente y admin siguen como estaban:
 * ellos son la excepción que el dueño sí quiere que exista.
 */

/** El valor guardado, leído: un número finito y mayor que cero, o nulo («sin mínimo»). Texto y basura → nulo. */
export function leeTarifaMinima(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** El mínimo de la tienda «Sold From» de la orden, por nombre normalizado. Nulo si no tiene. */
export function tarifaMinimaDeTienda(tienda: string | null | undefined, tiendas: NamedLocation[]): number | null {
  const clave = normalizaTienda(tienda);
  if (!clave) return null;
  const t = tiendas.find((s) => normalizaTienda(s.name) === clave);
  return leeTarifaMinima(t?.tarifa_minima_ventas);
}

/** El mínimo que le aplica a ESTA persona en esta orden: solo a ventas. Nulo = sin límite. */
export function tarifaMinimaQueAplica(rol: UserRole | null | undefined, tienda: string | null | undefined, tiendas: NamedLocation[]): number | null {
  if (rol !== "sales") return null;
  return tarifaMinimaDeTienda(tienda, tiendas);
}

/** ¿Se le ofrece el botón «Descuento»? No, cuando le aplica un mínimo. */
export function ofreceDescuento(rol: UserRole | null | undefined, tienda: string | null | undefined, tiendas: NamedLocation[]): boolean {
  return tarifaMinimaQueAplica(rol, tienda, tiendas) == null;
}

/**
 * ¿Este tipo de orden cobra tarifa al cliente? La misma regla que `missingFields` (required.ts): solo
 * los tipos con `docRef` de factura piden «Costo de Entrega cobrado». Intertienda, Transfer o Proveedor
 * (`any`, `po`, `none`, `hidden`) no cobran, y ahí el mínimo no tiene nada que decir. Sin tipo
 * todavía, tampoco: lo que falta entonces es el tipo, y eso ya lo pide su propio aviso.
 */
export function cobraTarifa(tipo: string | null | undefined, reglas?: OrderTypeRules): boolean {
  if (!(tipo ?? "").trim()) return false;
  return (orderTypeRule(tipo, reglas).docRef ?? "invoice") === "invoice";
}

export interface BloqueoTarifaMinima { tienda: string; minimo: number }

/**
 * Lo que para el envío: un vendedor, en una tienda con mínimo, en un tipo que cobra, con una tarifa
 * vacía o por debajo. Vacía también para: si no, dejarla en blanco y pulsar «continuar de todos modos»
 * en el aviso de campos vacíos sería la forma de saltarse el mínimo.
 */
export function bloqueoPorTarifaMinima(a: {
  rol: UserRole | null | undefined;
  tienda: string | null | undefined;
  tiendas: NamedLocation[];
  tipo: string | null | undefined;
  reglas?: OrderTypeRules;
  tarifa: number | null | undefined;
}): BloqueoTarifaMinima | null {
  const minimo = tarifaMinimaQueAplica(a.rol, a.tienda, a.tiendas);
  if (minimo == null) return null;
  if (!cobraTarifa(a.tipo, a.reglas)) return null;
  const tarifa = a.tarifa == null || (a.tarifa as unknown) === "" ? null : Number(a.tarifa);
  if (tarifa != null && Number.isFinite(tarifa) && tarifa >= minimo) return null;
  return { tienda: (a.tienda ?? "").trim(), minimo };
}

/** El mensaje, en los dos idiomas. */
export function textoTarifaMinima(b: BloqueoTarifaMinima): { en: string; es: string } {
  const monto = `$${b.minimo}`;
  return {
    en: `The minimum delivery fee at ${b.tienda} is ${monto}.`,
    es: `La tarifa mínima en ${b.tienda} es ${monto}.`,
  };
}
