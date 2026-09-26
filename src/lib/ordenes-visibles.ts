import type { Delivery, NamedLocation, Profile, UserRole } from "@/lib/types";
import { retentionFloorISO, todayISO } from "@/lib/utils";
import { orderTypeRule, type OrderTypeRules } from "@/lib/required";
import { ventasVeLaOrden } from "@/lib/visibilidad-ventas";
import { esDeMisTiendas } from "@/lib/almacen";
import { facturasDeLaOrden } from "@/lib/agregar-material";
import { vaAAtrasadas } from "@/lib/atrasadas";
import { alcanceDelPanel, esDelAlcance, type AlcanceDelPanel } from "@/lib/panel-por-tienda";

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
 * > **Revertido por D-NEXT (2026-09-26).** El dueño: *«invoice pending solo muestra yesterday, today y
 * > tomorrow y future»*. La pestaña ya no se exime de la ventana: lleva ayer, hoy, lo que viene y lo
 * > que no tiene fecha, **para todos los roles, admin y logística incluidos**
 * > (`pasaLaVentanaDePendientes`). Lo de arriba queda como historia de por qué existió la exención.
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
    // Esto no mira la tienda (D-374): decide solo «es suya». La tienda la corta aparte
    // `alcanceDeLaLista` (D-405): ventas ve lo suyo, y desde entonces solo en su tienda y su grupo.
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
 * ¿Cae la orden dentro de lo que Órdenes enseña a quien no es admin ni logística (D-392)?
 * Ayer, hoy y todo lo futuro; sin fecha, siempre (se está programando).
 *
 * El dueño, 2026-09-25: *«ONLY LOGISTICS AND admin CAN SEE DAYS BEFORE YESTERDAY»*. Es el suelo de
 * la ventana de D-239 (`retentionFloorISO`) **sin las dos puertas que se le habían abierto**:
 *
 * - la **atrasada abierta**, que `withinRetention` deja pasar tenga la fecha que tenga (D-374), y que
 *   D-384 mandaba a la pastilla «Outdated»;
 * - la **búsqueda**, que desde D-239 no tenía ventana («buscar es cómo se llega al historial»).
 *
 * **No se toca `withinRetention`**: la usan la Cola de almacén (`warehouse/page.tsx`) y la pantalla
 * del chofer (`driver/page.tsx`), y allí las atrasadas abiertas siguen saliendo. El pedido era de
 * Órdenes.
 */
export function enLaVentanaDeOrdenes(
  d: { delivery_date?: string | null },
  hoy: string = todayISO(),
): boolean {
  if (!d.delivery_date) return true;
  return d.delivery_date.slice(0, 10) >= retentionFloorISO(hoy);
}

/**
 * ¿Pasa el corte de fechas?
 *
 * Admin y logística (y quien tenga `history` marcado a mano, D-350): sin corte. Los demás:
 * `enLaVentanaDeOrdenes`, **navegando y buscando**, que desde D-392 es el mismo corte. Antes buscar
 * no tenía ventana y ventas tenía un tope propio de 30 días; con el suelo en ayer ese tope ya no
 * decidía nada y se quitó.
 *
 * Aquí vivía también la exención de D-313 (`pendientesEntran`: una orden con documento pendiente
 * pasaba el corte, dentro de su pestaña). **D-NEXT la quitó**: «Factura pendiente» tiene ahora su
 * propio corte, `pasaLaVentanaDePendientes`, más estrecho que este y no más ancho.
 */
export function pasaLaVentana(d: Delivery, ctx: ContextoDeLista): boolean {
  const { teaching, veTodoElHistorial } = ctx;
  if (teaching || veTodoElHistorial) return true;
  return enLaVentanaDeOrdenes(d);
}

/**
 * ¿Entra la orden en la pestaña «Factura pendiente» por su FECHA (D-NEXT)?
 *
 * El dueño, 2026-09-26: *«invoice pending solo muestra yesterday, today y tomorrow y future»*. Es la
 * ventana de Órdenes (`enLaVentanaDeOrdenes`: ayer, hoy, lo que viene, y **sin fecha, siempre**,
 * porque una orden sin fecha se está programando y es trabajo de ahora) **para todos los roles**:
 * el pedido no hace excepción, así que admin, logística y quien tenga `history` (D-350) tampoco ven
 * aquí pendientes de anteayer hacia atrás. En la lista normal ellos siguen viéndolas.
 *
 * Solo el **sandbox de enseñanza** se salta el corte, como se salta todos (sus datos no son de
 * nadie).
 *
 * Consecuencia sabida: las órdenes entregadas hace semanas sin factura dejan de salir en la pestaña.
 * Siguen sin factura en la base; se llega a ellas abriéndolas o buscando (con la ventana de cada uno).
 */
export function pasaLaVentanaDePendientes(d: Delivery, ctx: Pick<ContextoDeLista, "teaching">): boolean {
  if (ctx.teaching) return true;
  return enLaVentanaDeOrdenes(d);
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
 * la que cuenta y llena la pestaña «Factura pendiente»: desde D-NEXT, lo que la persona ve **de ayer
 * en adelante** (`pasaLaVentanaDePendientes`), para todos los roles; hasta entonces era la normal más
 * lo viejo con documento pendiente (la exención de D-313). Se devuelven juntas para que **nadie las calcule por su cuenta**: dos listas
 * parecidas escritas en dos sitios acaban discrepando, y la pestaña diría un número y enseñaría otro.
 *
 * `atrasadas` (D-384) es la tercera, por la misma razón: la pastilla «Outdated» cuenta y lista de
 * ella. Es **toda** atrasada abierta (`vaAAtrasadas`, ayer incluida desde D-404), con los mismos
 * cortes por rol y la misma ventana, así que cada persona ve en «Outdated» solo las atrasadas que ya
 * podía ver: admin y logística, todas; los demás, las de ayer. **Y desde D-NEXT están también en
 * `visibles`**: el dueño, 2026-09-26 por la tarde, *«outdated que también salga en all»*. D-404 las
 * había sacado de la lista normal esa misma mañana; ahora salen en los dos sitios.
 *
 * **`conPendientes` va además cortada por tienda (D-404).** El dueño, 2026-09-26: *«en invoice
 * pending estrictamente solo se pueden ver órdenes de tu tienda, no de otras»*. Admin y logística,
 * todas; el resto, su tienda y las de su grupo (D-293); sin tienda, ninguna. La regla de tiendas es
 * la del Panel (`alcanceDelPanel` / `esDelAlcance`, D-396), no una nueva. Se devuelve el alcance
 * para que la pantalla avise a quien no tiene tienda con el MISMO valor que ha cortado la lista.
 */
export function ordenesVisibles(deliveries: readonly Delivery[], ctx: ContextoDeLista): {
  visibles: Delivery[];
  conPendientes: Delivery[];
  atrasadas: Delivery[];
  alcancePendientes: AlcanceDelPanel;
  alcanceLista: AlcanceDelPanel;
} {
  const visibles: Delivery[] = [];
  const conPendientes: Delivery[] = [];
  const atrasadas: Delivery[] = [];
  const alcancePendientes = alcanceDePendientes(ctx);
  const alcanceLista = alcanceDeLaLista(ctx);
  for (const d of deliveries) {
    // Los cortes por ROL y la búsqueda valen igual para las tres listas: «Outdated» enseña las
    // atrasadas que esta persona ya podía ver, no una llave para ver las de otro.
    if (!leTocaPorRol(d, ctx) || !coincideConLaBusqueda(d, ctx.busqueda)) continue;
    // Y el corte por TIENDA de la lista (D-405), antes de repartir: vale para las tres listas, así
    // que número = filas en «Todas», en cada etapa, en «Outdated» y en «Factura pendiente».
    if (!esDelAlcance(d, alcanceLista, ctx.reglas)) continue;
    const normal = pasaLaVentana(d, ctx);
    // «Outdated» (D-384, D-404): TODA atrasada abierta —también la de ayer— va a la suya. Los días
    // que entran los decide `pasaLaVentana` (D-392): a quien no es admin ni logística ya le ha
    // cortado lo anterior a ayer, así que su «Outdated» son las de ayer.
    // Y se queda TAMBIÉN en la normal (D-NEXT, *«outdated que también salga en all»*): la lista
    // normal no mira si está atrasada. D-404 la sacaba de ahí, salvo buscando.
    if (normal && vaAAtrasadas(d)) atrasadas.push(d);
    if (normal) visibles.push(d);
    // «Factura pendiente» (D-NEXT): de ayer en adelante para TODOS, admin y logística incluidos —no
    // `normal`, que a ellos no les corta nada—. Y su corte por tienda (D-404).
    if (pasaLaVentanaDePendientes(d, ctx) && esDelAlcance(d, alcancePendientes, ctx.reglas)) conPendientes.push(d);
  }
  return { visibles, conPendientes, atrasadas, alcancePendientes, alcanceLista };
}

/**
 * Los roles cuya lista ENTERA de Órdenes va cortada por su tienda (D-405): sin buscar, buscando, en
 * el tablero, en las pastillas y en sus números. El dueño, 2026-09-26: *«y office manager, sales solo
 * pueden ver su propia tienda»*. Office (`accounting`) no está: no lo nombró, y a él solo se le
 * corta la búsqueda (ver `alcanceDeLaLista`).
 */
export const ROLES_LISTA_DE_SU_TIENDA: readonly UserRole[] = ["manager", "sales"];

/**
 * De qué tiendas es la lista de Órdenes para esta persona, AHORA (D-405).
 *
 * El dueño, 2026-09-26: *«solo pueden buscar en el search bar, solo puede buscar órdenes de ellos
 * mismos de su propia tienda»*, y el mismo día *«y office manager, sales solo pueden ver su propia
 * tienda»*. Por tanto:
 *
 * - **admin y logística**: todas, siempre (`alcanceDelPanel` ya lo dice así);
 * - **gerente y ventas**: su tienda y las de su grupo, siempre — busquen o no;
 * - **los demás** (office, almacén, cualquier otro rol): **solo buscando**. Sin buscar, su lista se
 *   queda como estaba (D-374, D-392, D-404);
 * - **sin tienda**, donde hay corte: ninguna, y la pantalla lo avisa con este valor (D-237, D-396).
 *
 * La regla de tiendas es la del Panel y la de «Factura pendiente» (`alcanceDelPanel` /
 * `esDelAlcance`, D-396/D-404), no una nueva: una Intertienda es de las dos tiendas que toca. El
 * sandbox de enseñanza no tiene cortes. Es **de pantalla**: la base (131) sigue mandando las demás.
 */
export function alcanceDeLaLista(ctx: Pick<ContextoDeLista, "me" | "teaching" | "tiendas" | "busqueda">): AlcanceDelPanel {
  if (ctx.teaching) return { tipo: "todas" };
  const siempre = !!ctx.me && ROLES_LISTA_DE_SU_TIENDA.includes(ctx.me.role);
  if (!siempre && !ctx.busqueda.trim()) return { tipo: "todas" };
  return alcanceDelPanel(ctx.me, ctx.tiendas);
}

/**
 * De qué tiendas es la pestaña «Factura pendiente» para esta persona (D-404). Es `alcanceDelPanel`:
 * admin y logística, todas; el resto, su tienda y las de su grupo; sin tienda, ninguna. El sandbox de
 * enseñanza no tiene cortes de ningún tipo, tampoco este.
 */
export function alcanceDePendientes(ctx: Pick<ContextoDeLista, "me" | "teaching" | "tiendas">): AlcanceDelPanel {
  if (ctx.teaching) return { tipo: "todas" };
  return alcanceDelPanel(ctx.me, ctx.tiendas);
}
