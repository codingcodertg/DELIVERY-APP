import { isStoreToStore, type OrderTypeRules } from "./required";
import type { CustomerType, Delivery } from "./types";

/**
 * Builder o venta al mostrador, por orden (D-316).
 *
 * El dueño: «se marca en cada orden», con la cuenta como valor por defecto. El motor de rutas da
 * prioridad a los builders: van antes en la ruta y son los últimos en quedarse fuera.
 *
 * - Solo existe en las órdenes que van a un cliente. Un movimiento entre tiendas no es ni lo uno ni lo
 *   otro: `null`.
 * **Reemplazado en parte por D-NEXT:** ya no hay selector en la orden ni marca en la cuenta. El dueño: «en cuenta ahí se
 * selecciona venta al mostrador y todo lo demás son builders». «Venta al mostrador» es una opción FIJA del campo Cuenta
 * (`CUENTA_DE_MOSTRADOR`), no una cuenta guardada: medido el 2026-09-19, ninguna de las cuentas guardadas lo era. El tipo que
 * una orden YA tiene guardado se respeta; lo que no tiene tipo se lee con la regla nueva. Lo de abajo es la regla de D-316.
 *
 * - **El selector nunca nace vacío:** Builder si la cuenta guardada lo es; Mostrador en cualquier otro
 *   caso, también sin cuenta. Medido el 2026-09-18: 48 de las 82 órdenes a cliente de 90 días no tenían
 *   cuenta; si el valor por defecto dependiera de tenerla, casi ninguna lo tendría.
 */

export const TIPOS_DE_CLIENTE: { key: CustomerType; en: string; es: string }[] = [
  { key: "counter_sale", en: "Counter sale", es: "Mostrador" },
  { key: "builder", en: "Builder", es: "Builder" },
];

const esValido = (v: unknown): v is CustomerType => v === "builder" || v === "counter_sale";

/** ¿Este tipo de orden va a un cliente? Lo contrario de tienda-a-tienda; sin tipo todavía, no. */
export function esTipoDeCliente(orderType: string | null | undefined, reglas?: OrderTypeRules): boolean {
  return !!(orderType ?? "").trim() && !isStoreToStore(orderType, reglas);
}

/**
 * La opción fija del campo Cuenta para un cliente de paso (D-NEXT). Es vocabulario de la app, no un dato de nadie: se
 * guarda SIEMPRE esta misma cadena en `deliveries.account` —tabla y exportes enseñan `account` tal cual— y solo se traduce
 * al pintar el botón que la elige.
 */
export const CUENTA_DE_MOSTRADOR = "Venta al mostrador";
export const CUENTA_DE_MOSTRADOR_EN = "Counter sale";

const comparable = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** ¿Es la opción de mostrador? Sin importar mayúsculas ni espacios; en cualquiera de sus dos idiomas. */
export function esCuentaDeMostrador(cuenta: string | null | undefined): boolean {
  const c = comparable(cuenta);
  return c === comparable(CUENTA_DE_MOSTRADOR) || c === comparable(CUENTA_DE_MOSTRADOR_EN);
}

/** Lo que dice la cuenta: Mostrador solo si es la opción de mostrador; Builder todo lo demás, también sin cuenta. */
export function tipoDeClientePorDefecto(cuenta: string | null | undefined): CustomerType {
  return esCuentaDeMostrador(cuenta) ? "counter_sale" : "builder";
}

type OrdenConTipo = Pick<Partial<Delivery>, "order_type" | "account" | "customer_type">;

/** El tipo de cliente de una orden: el que ya tiene guardado, y si no, el de su cuenta. `null` si la orden
 *  no va a un cliente. */
export function tipoDeClienteDeLaOrden(d: OrdenConTipo, reglas: OrderTypeRules | undefined): CustomerType | null {
  if (!esTipoDeCliente(d.order_type, reglas)) return null;
  return esValido(d.customer_type) ? d.customer_type : tipoDeClientePorDefecto(d.account);
}

/**
 * ¿La base ya tiene la columna? Las migraciones de este proyecto se aplican DESPUÉS de fusionar, así que
 * hay una ventana en la que el código nuevo corre contra la base vieja. Mandar `customer_type` entonces
 * no fallaría solo ese campo: **fallaría el guardado de la orden entera**. Las órdenes se leen con
 * `select("*")`, de modo que si alguna trae la clave, la columna existe.
 *
 * Sin ninguna orden cargada no se puede saber y se contesta que no: el campo no se manda. Es el lado
 * seguro — se pierde una marca, no una orden.
 */
export function laBaseTieneCustomerType(ordenes: readonly object[]): boolean {
  return ordenes.some((o) => "customer_type" in o);
}

/** Lo que se añade al guardar la orden: el tipo de cliente, o nada si la base todavía no lo admite. */
export function parcheDeTipoDeCliente(
  d: OrdenConTipo, reglas: OrderTypeRules | undefined, ordenesCargadas: readonly object[],
): { customer_type?: CustomerType | null } {
  if (!laBaseTieneCustomerType(ordenesCargadas)) return {};
  return { customer_type: tipoDeClienteDeLaOrden(d, reglas) };
}
