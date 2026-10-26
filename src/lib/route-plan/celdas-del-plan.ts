import { isStoreToStore, type OrderTypeRules } from "@/lib/required";
import { tipoDeClienteDeLaOrden } from "@/lib/customer-type";
import { zonaDeLaRecogida } from "@/lib/zonas";
import { ciudadDeEntrega } from "@/lib/ciudad-de-entrega";
import type { Delivery, NamedLocation } from "@/lib/types";

/**
 * Las dos columnas PROPIAS de la tabla del plan que salen de la orden pero que Órdenes no tiene (D-434). El dueño,
 * 2026-09-28, sobre la tabla del plan publicado: «quiero que haya una columna solo para el id, lueg osi es builder, inter
 * tienda o vventa al mostrador, luego la ciudad donde se recoje, y el invoice number».
 *
 * D-435 sumó una tercera, la ciudad de entrega: «lo unico que hizo falta es ciudad de entregfa».
 *
 * Aquí no se decide nada nuevo: cada una LEE la regla que ya decide eso en otra parte, para que el plan no pueda
 * contradecir al motor ni a la ficha.
 */

/**
 * La clase de la FILA de una parada en la tabla del plan (D-435): la recogida en verde muy suave, la entrega en amarillo
 * (los tintes, en `globals.css`, con su par oscuro). El dueño, 2026-09-28: «quiero que en esa misma table las pickup toda la
 * row este highlited pero bien suave de verde y las deliveries de amarillo para poder identificarlas mejor».
 */
export function claseDeLaFilaDelPlan(kind: "P" | "D"): "fila-plan-recoger" | "" {
  // D-NEXT: la entrega ya no lleva tinte. El dueño, 2026-10-26: «Pickups are one color, deliveries dont have a color».
  return kind === "P" ? "fila-plan-recoger" : "";
}

/** Builder, Intertienda, Venta al mostrador o Proveedor. `null`: la orden aún no tiene tipo de orden, y no se sabe. */
export type ClaseDeOrden = "builder" | "counter_sale" | "intertienda" | "proveedor";

/**
 * La clase de una orden: Intertienda si su tipo de orden va de tienda a tienda (`isStoreToStore`, las reglas de Ajustes);
 * y si va a un cliente, builder o mostrador con la MISMA función con que el motor decide a quién da prioridad
 * (`tipoDeClienteDeLaOrden`, D-316/D-337: el tipo guardado en la orden, y si no, el de su cuenta).
 */
export function claseDeLaOrden(d: Pick<Partial<Delivery>, "order_type" | "account" | "customer_type">, reglas: OrderTypeRules): ClaseDeOrden | null {
  const cliente = tipoDeClienteDeLaOrden(d, reglas);
  if (cliente) return cliente;
  if (isStoreToStore(d.order_type, reglas)) return "intertienda";
  // Ni cliente ni tienda-a-tienda, pero CON tipo: es una salida a alguien que no es cliente nuestro ni
  // una de nuestras tiendas — hoy, un proveedor (D-511). Se deduce de las banderas, no del nombre del
  // tipo, para que valga igual si mañana se llama de otra forma. Sin tipo de orden sigue siendo `null`:
  // no se inventa.
  if (String(d.order_type ?? "").trim()) return "proveedor";
  return null;
}

const TEXTO_DE_CLASE: Record<ClaseDeOrden, [string, string]> = {
  builder: ["Builder", "Builder"],
  intertienda: ["Intertienda", "Intertienda"],
  counter_sale: ["Counter sale", "Venta al mostrador"],
  proveedor: ["Supplier", "Proveedor"],
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
 * El texto de una columna propia del plan en una orden, o `undefined` si la columna no es de estas (entonces la pinta
 * la celda de Órdenes). La ciudad de recogida es `zonaDeLaRecogida` (D-427): la tienda de `pickup_name`, y si no está o no
 * tiene punto, la de `store` — la misma tienda que «Planificar el día» usa como origen.
 */
export function celdaPropiaDelPlan(clave: string, d: Pick<Partial<Delivery>, "order_type" | "account" | "customer_type" | "pickup_name" | "store" | "delivery_address">, ctx: ContextoDelPlan): string | undefined {
  if (clave === "pl_clase") {
    const c = claseDeLaOrden(d, ctx.reglas);
    return c ? TEXTO_DE_CLASE[c][ctx.es ? 1 : 0] : "—";
  }
  if (clave === "pl_ciudad_recogida") return zonaDeLaRecogida(d, ctx.tiendas, ctx.conocidas) || "—";
  // D-435: la MISMA ciudad que la columna «Ciudad de entrega» de «Sin asignar» (D-408), con las mismas ciudades conocidas
  // (D-423). En una recogida no llega aquí: la tabla la deja vacía (`seVeEnLaRecogida`).
  if (clave === "pl_ciudad_entrega") return ciudadDeEntrega(d.delivery_address, ctx.conocidas) || "—";
  return undefined;
}
