import { hayClienteDetras, orderTypeRule, type OrderTypeRules } from "./required";
import { normalizaLugar, origenEsDestino } from "./order-endpoints";
import { alActivar, primerDiaDelPasoB } from "./relevo";
import { mismaTiendaOGrupo } from "./store-group";
import type { Delivery, NamedLocation } from "./types";

/**
 * INTERTIENDA CUSTOMER (migración 346).
 *
 * Una orden de cliente VENDIDA por la tienda Y (`store`, «Vendido desde») pero recogida en la tienda X (`pickup_name`)
 * no puede ir de X directo al cliente. Tiene que hacerse en dos pasos ligados: el paso A es X → Y y el paso B es Y →
 * cliente, y el B no se recoge hasta que el A esté entregado. Eso es un RELEVO (`relevo.ts`) cuya tienda de relevo es la
 * que vende; la única diferencia con un relevo normal es que se activa solo, en cuanto la orden se aprueba, y que la
 * tarifa de entrega se queda en el paso B (el del cliente).
 *
 * Este archivo es la regla sin pantalla: cuándo una orden pasa por la tienda que vende, cuándo hay que partirla, cómo se
 * llama cada paso y qué se escribe. `activar_intertienda_cliente` (346) hace lo mismo en la base.
 */

export type Bilingue = { en: string; es: string };

const buscaTienda = (nombre: string | null | undefined, tiendas: readonly NamedLocation[]): NamedLocation | undefined => {
  const n = normalizaLugar(nombre);
  return n ? tiendas.find((t) => normalizaLugar(t.name) === n) : undefined;
};

/** ¿Esta orden, tal como está, tiene que pasar por la tienda que la vende? `null` = no. */
export function pasaPorLaTiendaQueVende(
  d: Pick<Delivery, "order_type" | "store" | "pickup_name" | "delivery_name" | "delivery_address" | "relay_step" | "order_suffix">,
  reglas: OrderTypeRules | undefined,
  tiendas: readonly NamedLocation[],
): { origen: NamedLocation; tienda: NamedLocation } | null {
  if (!hayClienteDetras(d.order_type, reglas)) return null;
  if (d.relay_step != null) return null;
  if (d.order_suffix) return null;
  const origen = buscaTienda(d.pickup_name, tiendas);
  const tienda = buscaTienda(d.store, tiendas);
  if (!origen || !tienda) return null;
  if (mismaTiendaOGrupo(d.pickup_name, d.store, tiendas)) return null;
  if (normalizaLugar(d.delivery_name) === normalizaLugar(tienda.name)) return null;
  if (normalizaLugar(tienda.address) && normalizaLugar(d.delivery_address) === normalizaLugar(tienda.address)) return null;
  return { origen, tienda };
}

/** Las etapas en las que la orden se parte sola en A y B (aprobada y sin recoger). Antes (borrador, pendiente) solo se anuncia. */
export const ETAPAS_PARA_PARTIR: readonly string[] = ["approved", "fulfilling", "ready"];

/** ¿Hay que partirla YA? = pasa por la tienda que vende, está en una etapa de `ETAPAS_PARA_PARTIR` y no tiene hermanas. */
export function hayQuePartirla(
  d: Delivery,
  hermanas: readonly Pick<Delivery, "id">[],
  reglas: OrderTypeRules | undefined,
  tiendas: readonly NamedLocation[],
): boolean {
  if (!ETAPAS_PARA_PARTIR.includes(d.stage)) return false;
  if (hermanas.some((h) => h.id !== d.id)) return false;
  return pasaPorLaTiendaQueVende(d, reglas, tiendas) !== null;
}

/** ¿Este paso de relevo es de una Intertienda Customer? = el relevo pasa por la tienda que vende. */
export function esIntertiendaCliente(d: Pick<Delivery, "relay_step" | "store" | "pickup_name" | "delivery_name">): boolean {
  const tienda = normalizaLugar(d.store);
  if (!tienda) return false;
  if (d.relay_step === 1) return normalizaLugar(d.delivery_name) === tienda;
  if (d.relay_step != null && d.relay_step >= 2) return normalizaLugar(d.pickup_name) === tienda;
  return false;
}

export type SubtipoDeIntertienda = "stock" | "customer";
export const TEXTO_DEL_SUBTIPO: Record<SubtipoDeIntertienda, Bilingue> = {
  stock: { en: "Intertienda Stock", es: "Intertienda Stock" },
  customer: { en: "Intertienda Customer", es: "Intertienda Customer" },
};

/** "customer" si es un paso de Intertienda Customer o una orden que va a pasar por la tienda que vende; "stock" si es una orden tienda-a-tienda cuyo destino es la tienda que la pide (regla `storeToStore` y `homeIsDestination`) y no es un paso de relevo de cliente; `null` en lo demás. */
export function subtipoDeIntertienda(d: Delivery, reglas: OrderTypeRules | undefined, tiendas: readonly NamedLocation[]): SubtipoDeIntertienda | null {
  if (esIntertiendaCliente(d) || pasaPorLaTiendaQueVende(d, reglas, tiendas) !== null) return "customer";
  if (d.relay_step != null) return null;
  const regla = orderTypeRule(d.order_type, reglas);
  if (regla.homeIsDestination === true && origenEsDestino(d, regla, [...tiendas])) return "stock";
  return null;
}

/** «A: RDZ McAllen → RDZ Pharr · B: RDZ Pharr → cliente» (en) / (es «cliente»). `destino` = nombre del cliente o su dirección; vacío → "customer"/"cliente". */
export function textoDeLosPasos(origen: string, tienda: string, destino: string | null | undefined): Bilingue {
  const d = (destino ?? "").trim();
  return {
    en: `A: ${origen} → ${tienda} · B: ${tienda} → ${d || "customer"}`,
    es: `A: ${origen} → ${tienda} · B: ${tienda} → ${d || "cliente"}`,
  };
}

/**
 * Lo que se escribe al partirla, en TypeScript (el demo y las pruebas); `activar_intertienda_cliente` hace lo mismo en la base.
 * Igual que `alActivar` de relevo.ts con la tienda de relevo = la tienda que vende y el día del paso b =
 * `primerDiaDelPasoB(madre.delivery_date, hoy)`, con UNA diferencia: la tarifa de entrega (`delivery_fee`) se queda en el
 * paso B (el del cliente) y el paso A queda sin tarifa. `null` si `pasaPorLaTiendaQueVende` dice que no.
 */
export function alPartir(
  madre: Delivery,
  reglas: OrderTypeRules | undefined,
  tiendas: readonly NamedLocation[],
  a: { id: string; ahora: string; creador: string | null; hoy: string },
): { madre: Partial<Delivery>; paso: Delivery } | null {
  const hit = pasaPorLaTiendaQueVende(madre, reglas, tiendas);
  if (!hit) return null;
  // `alActivar` rechaza como tienda de relevo la que figura como `store` (su guarda «fuera»). Aquí la tienda de relevo ES
  // la que vende, así que la llamada va con `store` vacío y el `store` de verdad se devuelve al paso después.
  const r = alActivar({ ...madre, store: "" }, hit.tienda, primerDiaDelPasoB(madre.delivery_date, a.hoy), a);
  if (!r) return null;
  return {
    madre: { ...r.madre, delivery_fee: null },
    paso: { ...r.paso, store: madre.store, delivery_fee: madre.delivery_fee ?? null },
  };
}

/**
 * El botón «Customer» del formulario de una orden nueva (B2): pasa la orden de tienda a tienda a «cliente». `yaConTipoDeCliente`
 * es el borrador con el tipo de cliente ya puesto (lo hace el mismo camino que el selector). Encima se queda la tienda de
 * origen que la persona ya había elegido (`pickup_name`, o la «Vendido desde» si no hay recogida) como recogida, con su
 * dirección, y la tienda que vende pasa a ser la suya (`miTienda`), si la tiene. Lo que no se elige no se toca.
 */
export function pasaACliente(
  antes: Partial<Delivery>,
  yaConTipoDeCliente: Partial<Delivery>,
  miTienda: string | null | undefined,
  tiendas: readonly NamedLocation[] = [],
): Partial<Delivery> {
  const recogida = (antes.pickup_name ?? "").trim();
  const nombre = recogida || (antes.store ?? "").trim();
  const direccion = recogida ? (antes.pickup_address ?? null) : (tiendas.find((t) => t.name === nombre)?.address ?? null);
  return {
    ...yaConTipoDeCliente,
    ...(nombre ? { pickup_name: nombre, pickup_address: direccion } : {}),
    ...(miTienda?.trim() ? { store: miTienda.trim() } : {}),
  };
}
