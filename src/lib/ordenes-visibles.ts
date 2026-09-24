import type { Delivery, NamedLocation, Profile } from "@/lib/types";
import { withinRetention } from "@/lib/utils";
import { facturaPendiente } from "@/lib/documento-pendiente";
import { orderTypeRule, type OrderTypeRules } from "@/lib/required";
import { ventasVeLaOrden } from "@/lib/visibilidad-ventas";
import { esDeMisTiendas } from "@/lib/almacen";
import { facturasDeLaOrden } from "@/lib/agregar-material";
import { vaAAtrasadas } from "@/lib/atrasadas";

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
 *
 * **Y almacén, además, solo sus tiendas.** El dueño: *«warehouse should only see what they are in
 * charge of»*. Hasta hoy eso lo hacía **solo su propia cola** (`warehouse/page.tsx`), así que en el
 * tablero de Órdenes veía las de todas las tiendas. Es el mismo corte, en la otra pantalla, con la
 * misma función — no una copia.
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
  /** Las tiendas de almacén de quien mira (`tiendasDeAlmacen`), normalizadas. Vacío = sin acotar. */
  tiendasDeAlmacen: string[];
};

/** ¿Puede esta persona ver esta orden, por su rol? No mira fechas. */
export function leTocaPorRol(d: Delivery, ctx: ContextoDeLista): boolean {
  const { me, teaching } = ctx;
  // Ver todo el historial (D-350) abre la VENTANA, no el corte por rol: una vendedora con la capacidad ve
  // todas las suyas y las de su tienda, de siempre — no las de otro. Antes «ver todo» saltaba también
  // este corte, y era indiferente porque solo lo tenían admin y logística, que no tienen corte.
  if (teaching) return true;
  if (me?.role === "sales") {
    // Desde el cambio de hoy, esto ya no mira la tienda: ventas ve LO SUYO en cualquier tienda.
    if (!ventasVeLaOrden({ miId: me.id, orden: d })) return false;
    // Una anulada desaparece para ventas, y eso no lo abre ninguna pestaña.
    if (d.stage === "canceled") return false;
  }
  if (me?.role === "warehouse") {
    if (!["approved", "fulfilling", "ready", "picked_up", "delivered"].includes(d.stage)) return false;
    // Sin tienda asignada no se acota: quien no tiene tienda vería CERO órdenes, y eso se lee como
    // una app rota en vez de como una configuración que falta.
    if (ctx.tiendasDeAlmacen.length > 0
      && !esDeMisTiendas(d, orderTypeRule(d.order_type, ctx.reglas), ctx.tiendasDeAlmacen)) return false;
  }
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
    // Las facturas AÑADIDAS después también se buscan (D-339): quien teclea un número no sabe
    // si fue la primera o la segunda, y no encontrarla se lee como que la orden no existe.
    d.order_code, d.order_no, d.account, d.so_num, d.po2, ...facturasDeLaOrden(d), d.store,
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
 *
 * `atrasadas` (D-NEXT) es la tercera, por la misma razón: la pastilla «Outdated» cuenta y lista de
 * ella. Es lo que `visibles` ya no lleva —las abiertas con fecha anterior a ayer, `vaAAtrasadas`—,
 * con los mismos cortes por rol y la misma ventana, así que cada persona ve en «Outdated» solo las
 * atrasadas que ya podía ver.
 */
export function ordenesVisibles(deliveries: readonly Delivery[], ctx: ContextoDeLista): {
  visibles: Delivery[];
  conPendientes: Delivery[];
  atrasadas: Delivery[];
} {
  const visibles: Delivery[] = [];
  const conPendientes: Delivery[] = [];
  const atrasadas: Delivery[] = [];
  const buscando = !!ctx.busqueda.trim();
  for (const d of deliveries) {
    // Los cortes por ROL y la búsqueda valen igual para las tres listas: «Outdated» enseña las
    // atrasadas que esta persona ya podía ver, no una llave para ver las de otro.
    if (!leTocaPorRol(d, ctx) || !coincideConLaBusqueda(d, ctx.busqueda)) continue;
    const normal = pasaLaVentana(d, ctx, false);
    // «Outdated» (D-NEXT): la atrasada abierta anterior a ayer sale de la lista normal y va a la
    // suya. Buscando, se queda también en la normal: buscar es el camino a todo (D-374), y una
    // factura que no sale al teclearla se lee como que la orden no existe.
    const atrasada = vaAAtrasadas(d);
    if (normal && atrasada) atrasadas.push(d);
    if (normal && (!atrasada || buscando)) visibles.push(d);
    if (normal || pasaLaVentana(d, ctx, true)) conPendientes.push(d);
  }
  return { visibles, conPendientes, atrasadas };
}
