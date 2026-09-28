import { isStoreToStore, type OrderTypeRules } from "@/lib/required";
import { tipoDeClienteDeLaOrden } from "@/lib/customer-type";
import { zonaDeLaRecogida } from "@/lib/zonas";
import type { Delivery, NamedLocation } from "@/lib/types";

/**
 * Las dos columnas PROPIAS de la tabla del plan que salen de la orden pero que Órdenes no tiene (D-NEXT). El dueño,
 * 2026-09-28, sobre la tabla del plan publicado: «quiero que haya una columna solo para el id, lueg osi es builder, inter
 * tienda o vventa al mostrador, luego la ciudad donde se recoje, y el invoice number».
 *
 * Aquí no se decide nada nuevo: cada una LEE la regla que ya decide eso en otra parte, para que el plan no pueda
 * contradecir al motor ni a la ficha.
 */

/** Builder, Intertienda o Venta al mostrador. `null`: la orden aún no tiene tipo de orden, y no se sabe. */
export type ClaseDeOrden = "builder" | "counter_sale" | "intertienda";

/**
 * La clase de una orden: Intertienda si su tipo de orden va de tienda a tienda (`isStoreToStore`, las reglas de Ajustes);
 * y si va a un cliente, builder o mostrador con la MISMA función con que el motor decide a quién da prioridad
 * (`tipoDeClienteDeLaOrden`, D-316/D-337: el tipo guardado en la orden, y si no, el de su cuenta).
 */
export function claseDeLaOrden(d: Pick<Partial<Delivery>, "order_type" | "account" | "customer_type">, reglas: OrderTypeRules): ClaseDeOrden | null {
  const cliente = tipoDeClienteDeLaOrden(d, reglas);
  if (cliente) return cliente;
  // Sin tipo de orden, `isStoreToStore` dice que no: queda `null`, no se inventa.
  return isStoreToStore(d.order_type, reglas) ? "intertienda" : null;
}

const TEXTO_DE_CLASE: Record<ClaseDeOrden, [string, string]> = {
  builder: ["Builder", "Builder"],
  intertienda: ["Intertienda", "Intertienda"],
  counter_sale: ["Counter sale", "Venta al mostrador"],
};

export interface ContextoDelPlan {
  reglas: OrderTypeRules;
  /** Las tiendas de Ajustes (`settings.stores`), para saber en qué ciudad está la tienda donde se recoge. */
  tiendas: readonly Pick<NamedLocation, "name" | "address" | "lat" | "lng">[];
  /** Las ciudades que cierran una dirección escrita sin comas (D-423): las mismas que usa el resto del Gestor. */
  conocidas: readonly string[];
  es: boolean;
}

/**
 * El texto de una columna propia del plan en una orden, o `undefined` si la columna no es de estas dos (entonces la pinta
 * la celda de Órdenes). La ciudad de recogida es `zonaDeLaRecogida` (D-427): la tienda de `pickup_name`, y si no está o no
 * tiene punto, la de `store` — la misma tienda que «Planificar el día» usa como origen.
 */
export function celdaPropiaDelPlan(clave: string, d: Pick<Partial<Delivery>, "order_type" | "account" | "customer_type" | "pickup_name" | "store">, ctx: ContextoDelPlan): string | undefined {
  if (clave === "pl_clase") {
    const c = claseDeLaOrden(d, ctx.reglas);
    return c ? TEXTO_DE_CLASE[c][ctx.es ? 1 : 0] : "—";
  }
  if (clave === "pl_ciudad_recogida") return zonaDeLaRecogida(d, ctx.tiendas, ctx.conocidas) || "—";
  return undefined;
}
