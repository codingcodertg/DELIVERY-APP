import type { Delivery, NamedLocation, Profile } from "@/lib/types";
import { withinRetention } from "@/lib/utils";
import { facturaPendiente } from "@/lib/documento-pendiente";
import { orderTypeRule, type OrderTypeRules } from "@/lib/required";
import { ventasVeLaOrden } from "@/lib/visibilidad-ventas";

/**
 * Qué órdenes salen en la pantalla de Órdenes, y cuáles además en la pestaña de factura pendiente
 * (D-313).
 *
 * El dueño: *«invoice pending must be visible for office too»*. No salía, y la causa no era el
 * permiso: la pestaña cuenta sobre lo que la persona ve, y lo que office ve está cortado por la
 * ventana de retención de D-239 —de ayer en adelante, lo viejo solo buscando—. Las 18 órdenes con
 * documento pendiente estaban **todas entregadas**, o sea fuera de esa ventana, así que para office
 * la cuenta era 0 y la pestaña ni se pintaba. El admin la veía porque está exento de la ventana.
 *
 * **Un documento pendiente es trabajo vivo, no historial**, así que se exime de la ventana — pero
 * solo **dentro de su pestaña**. La vista normal sigue con la retención de siempre: si la exención
 * valiera para toda la tabla, a office se le llenaría la lista de entregadas de agosto, que es
 * justo lo que D-239 vino a quitar.
 *
 * Los cortes por **rol** no se relajan: ventas sigue viendo lo suyo (`ventasVeLaOrden`) y nunca una
 * anulada, y almacén sigue sin ver lo anterior a la aprobación. Una factura pendiente no es una
 * llave para ver órdenes de otro.
 */

export type ContextoDeLista = {
  me: Pick<Profile, "id" | "role" | "store"> | null | undefined;
  /** El sandbox de enseñanza no tiene cortes de ningún tipo. */
  teaching: boolean;
  /** Admin y logística ven el historial entero (D-239). */
  veTodoElHistorial: boolean;
  /** Lo tecleado en el buscador, tal cual. */
  busqueda: string;
  /** `YYYY-MM-DD`: lo más atrás que ventas puede *buscar*. */
  sueloDeVentas: string;
  reglas: OrderTypeRules;
  tiendas: NamedLocation[];
};

/** ¿Puede esta persona ver esta orden, por su rol? No mira fechas. */
export function leTocaPorRol(d: Delivery, ctx: ContextoDeLista): boolean {
  const { me, teaching, veTodoElHistorial } = ctx;
  if (teaching || veTodoElHistorial) return true;
  if (me?.role === "sales") {
    if (!ventasVeLaOrden({
      miId: me.id,
      miTienda: me.store,
      orden: d,
      regla: orderTypeRule(d.order_type, ctx.reglas),
      tiendas: ctx.tiendas,
    })) return false;
    // Una anulada desaparece para ventas, y eso no lo abre ninguna pestaña.
    if (d.stage === "canceled") return false;
  }
  if (me?.role === "warehouse" && !["approved", "fulfilling", "ready", "picked_up", "delivered"].includes(d.stage)) return false;
  return true;
}

/**
 * ¿Pasa el corte de fechas?
 *
 * Son dos cortes distintos y por eso no se mezclan: **navegando** manda la retención (de ayer en
 * adelante), y **buscando** no hay retención ninguna —buscar es cómo se llega al historial— salvo el
 * tope de 30 días de ventas.
 *
 * `pendientesEntran` es la exención de D-313: con ella, una orden con documento pendiente pasa los
 * dos cortes. Es lo que hace que la pestaña enseñe una entregada de hace un mes a la que le falta la
 * factura, **y** que a ventas no le tape su propio tope al buscar dentro de ella.
 */
export function pasaLaVentana(d: Delivery, ctx: ContextoDeLista, pendientesEntran: boolean): boolean {
  const { teaching, veTodoElHistorial, me, busqueda, sueloDeVentas, reglas } = ctx;
  if (teaching || veTodoElHistorial) return true;
  if (pendientesEntran && facturaPendiente(d, reglas)) return true;
  if (!busqueda.trim()) return withinRetention(d);
  if (me?.role === "sales" && d.delivery_date && d.delivery_date < sueloDeVentas) return false;
  return true;
}

/** ¿Coincide con lo buscado? Sin búsqueda, todo coincide. */
export function coincideConLaBusqueda(d: Delivery, busqueda: string): boolean {
  const needle = busqueda.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    d.order_code, d.order_no, d.account, d.so_num, d.po2, d.invoice_num, d.store,
    d.delivery_address, d.contact, d.assigned_driver, d.delivery_name, d.pickup_name,
  ].map((x) => String(x ?? "").toLowerCase()).join(" ");
  return hay.includes(needle);
}

/**
 * Las dos listas de la pantalla.
 *
 * `visibles` es la de siempre —y de ella salen «Todas» y las cuentas por etapa—; `conPendientes` es
 * la misma más las que solo se caían por la ventana y tienen documento pendiente, y es la que cuenta
 * y llena la pestaña. Se devuelven juntas para que **nadie las calcule por su cuenta**: dos listas
 * parecidas escritas en dos sitios acaban discrepando, y la pestaña diría un número y enseñaría otro.
 */
export function ordenesVisibles(deliveries: readonly Delivery[], ctx: ContextoDeLista): {
  visibles: Delivery[];
  conPendientes: Delivery[];
} {
  const visibles: Delivery[] = [];
  const conPendientes: Delivery[] = [];
  for (const d of deliveries) {
    if (!leTocaPorRol(d, ctx) || !coincideConLaBusqueda(d, ctx.busqueda)) continue;
    const normal = pasaLaVentana(d, ctx, false);
    if (normal) visibles.push(d);
    if (normal || pasaLaVentana(d, ctx, true)) conPendientes.push(d);
  }
  return { visibles, conPendientes };
}
