import type { Delivery, NamedLocation, Stage } from "./types";
import { conflictosDeSitio, isStoreToStore, orderTypeRule, type MissingField, type OrderTypeRules } from "./required";
import { normalizaLugar, origenEsDestino } from "./order-endpoints";

/**
 * Por dónde pasa una orden tienda-a-tienda antes de ir a su propio sitio (D-276).
 *
 * El dueño, sobre D-267: «en Intertienda el destino no puede ser la misma que la tienda "vendido
 * desde"». La regla existía y bloqueaba al enviar desde el modal, pero había caminos que la dejaban
 * atrás. Aquí viven los que decidían **qué se escribe** sin mirarla, sacados del modal para que las
 * pruebas los recorran con el código de verdad:
 *
 * - `borradorInicial`, lo que rellena una orden nueva. Para el gerente y contabilidad abría una
 *   Intertienda con su tienda de destino **y** de origen: el tipo vaciaba el origen y el relleno de
 *   la tienda lo volvía a poner.
 * - `aplicaTipo`, cambiar el tipo con las dos puntas ya puestas.
 * - `escrituraQueNoVaANingunSitio`, la guarda de los proveedores de datos: ninguna escritura mete en
 *   envío o aprobación una orden que va a su propio sitio, venga de la pantalla que venga.
 */

type Borrador = Partial<Delivery>;

/** Lo que el modal sabe de quién crea la orden y de Ajustes. */
export type ContextoDelUsuario = {
  rol: string;
  miTienda: string | null | undefined;
  tipos: string[];
  tiendas: NamedLocation[];
  reglas: OrderTypeRules;
};

/** Sin tienda de origen. Si la recogida era esa tienda —se rellena al elegirla—, también sin recogida. */
function sinOrigen(d: Borrador): Borrador {
  const recogidaDeLaTienda = !!normalizaLugar(d.store) && normalizaLugar(d.pickup_name) === normalizaLugar(d.store);
  return { ...d, store: "", ...(recogidaDeLaTienda ? { pickup_name: "", pickup_address: "" } : {}) };
}

/** Sin sitio de recogida: en un tipo que recibe, es el origen lo que se vacía (D-NEXT). */
function sinRecogida(d: Borrador): Borrador {
  return { ...d, pickup_name: "", pickup_address: "" };
}

function sinDestino(d: Borrador): Borrador {
  return { ...d, delivery_name: "", delivery_address: "" };
}

/**
 * Aplicar un tipo de orden (antes `withTypeDefaults`, dentro del modal).
 *
 * **Un tipo «que recibe» (`homeIsDestination`, hoy solo Intertienda) cambia de forma en D-NEXT.** El
 * dueño: *«el store sold from debería quedar freeze… el store destination es el mismo store sold from,
 * y el pickup es el dropdown que se elige qué tienda es»*. O sea: la tienda del usuario **vende y
 * recibe** —las dos puntas quedan puestas en su tienda— y lo único que se elige es **de qué tienda
 * viene el material**, que es la recogida. Antes era al revés: se vaciaba «Vendido desde» para que
 * eligiera ahí el origen, y por eso una Intertienda acababa con el destino en la tienda de al lado.
 *
 * En los demás tipos, el origen por defecto sigue siendo su tienda.
 *
 * **Desde D-276, un tipo tienda-a-tienda nunca queda con el origen en el destino.** Si con las dos
 * puntas puestas chocan, se vacía la que el tipo deja elegir: la **recogida** en un tipo que recibe
 * (que es donde vive el origen desde D-NEXT), el destino en los demás.
 */
export function aplicaTipo(p: Borrador, tipo: string, c: ContextoDelUsuario): Borrador {
  const rule = orderTypeRule(tipo, c.reglas);
  const next: Borrador = { ...p, order_type: tipo };
  if (rule.homeIsDestination && c.miTienda) {
    const home = c.tiendas.find((s) => s.name === c.miTienda);
    // Su tienda vende y recibe; lo que se elige es la recogida (D-NEXT).
    next.store = c.miTienda;
    next.delivery_name = c.miTienda;
    next.delivery_address = home?.address ?? p.delivery_address ?? "";
    // La recogida no puede ser ella misma, y NO se vacía aquí: el colapso de D-276 de abajo ya lo
    // hace, porque con el origen en la recogida esa orden es exactamente «va a su propio sitio».
    // Vaciarla también aquí era código que ningún mutante podía matar.
  } else if (!p.store && c.miTienda) {
    next.store = c.miTienda; // normal direction: Sold From is the rep's store
  }
  if (rule.storeToStore === true && origenEsDestino(next, rule, c.tiendas)) {
    return rule.homeIsDestination ? sinRecogida(next) : sinDestino(next);
  }
  return next;
}

/**
 * Lo que rellena una orden nueva al abrirla (antes, un efecto del modal). Gerente y contabilidad
 * empiezan en Intertienda; el resto, en Customer; y el origen es la tienda del usuario **salvo que eso
 * la deje yendo a su propio sitio**.
 */
export function borradorInicial(p: Borrador, c: ContextoDelUsuario): Borrador {
  const defaultType = (c.rol === "manager" || c.rol === "accounting") && c.tipos.includes("Intertienda") ? "Intertienda" : "Customer";
  let next = p;
  if (!p.order_type && c.tipos.includes(defaultType)) next = aplicaTipo(next, defaultType, c);
  if (!next.store && c.miTienda) {
    const st = c.tiendas.find((s) => s.name === c.miTienda);
    const conTienda: Borrador = { ...next, store: c.miTienda, pickup_name: c.miTienda, pickup_address: st?.address ?? next.pickup_address };
    if (!origenEsDestino(conTienda, orderTypeRule(next.order_type, c.reglas), c.tiendas)) next = conTienda;
  }
  return next;
}

/** La re-entrega (antes, dentro del modal): una copia ya aprobada de la orden de origen, enlazada a ella. */
export function borradorDeReentrega(src: Delivery, a: { cargo: string; motivo: string }): Borrador {
  return {
    // sales/customer data carries over
    order_type: src.order_type, store: src.store, account: src.account,
    po2: src.po2, so_num: src.so_num, invoice_num: src.invoice_num,
    est_pallets: src.est_pallets, delivery_date: src.delivery_date,
    delivery_windows: src.delivery_windows, pickup_address: src.pickup_address,
    pickup_duration: src.pickup_duration, delivery_duration: src.delivery_duration,
    delivery_address: src.delivery_address, contact: src.contact,
    delivery_phone: src.delivery_phone, delivery_notes: src.delivery_notes,
    route_miles: src.route_miles, route_duration: src.route_duration,
    route_provider: src.route_provider, route_traffic: src.route_traffic,
    // warehouse redoes these
    actual_pallets: null, assigned_driver: src.assigned_driver,
    // The additional charge (if any) for redoing the delivery becomes the new
    // order's delivery fee — blank/empty means a free re-delivery ($0).
    delivery_fee: a.cargo.trim() === "" ? 0 : Number(a.cargo),
    // re-delivery linkage
    stage: "approved", redelivery_of: src.id, redelivery_reason: a.motivo.trim(),
  };
}

/** Las etapas en las que una orden se da por enviada o aprobada. */
const ENVIO_O_APROBACION: ReadonlySet<Stage> = new Set<Stage>(["pending", "approved"]);

/** Los campos de los que depende la regla. */
const CAMPOS_DE_SITIO = ["order_type", "store", "pickup_address", "delivery_name", "delivery_address"] as const;

/**
 * La guarda de escritura: los choques que impiden esta escritura, o ninguno. La llaman `addDelivery`,
 * `updateDelivery` y `setStage` de los dos proveedores de datos, que es por donde pasa **toda**
 * escritura de una orden desde el cliente: el modal, aprobar o enviar desde la lista, la re-entrega.
 *
 * - **Crear** una orden ya pendiente o ya aprobada (crear y enviar, la re-entrega).
 * - **Pasar** a pendiente o aprobada, desde cualquier otra etapa.
 * - **Editar** los campos de sitio de una orden que no es borrador, **si la edición crea el choque**.
 *
 * Lo que **no** para, a propósito: un borrador, que D-267 deja guardar y bloquea al enviar; una orden
 * vieja que ya tenía el choque y sigue su camino —el chofer la recoge, se le cambia la fecha—, que se
 * ve y se corrige, pero no vuelve a enviarse ni aprobarse así; y **el resto de una carga dividida**, que
 * el modal crea en `ready` a mitad de la recogida: pararlo dejaría al chofer con la carga a medias.
 */
export function escrituraQueNoVaANingunSitio(
  antes: Delivery | undefined,
  cambio: Borrador,
  reglas: OrderTypeRules,
  tiendas: NamedLocation[],
): MissingField[] {
  const despues: Borrador = { ...(antes ?? {}), ...cambio };
  const etapa = despues.stage ?? "draft";
  if (!antes) return ENVIO_O_APROBACION.has(etapa) ? conflictosDeSitio(despues, reglas, tiendas) : [];
  if (cambio.stage !== undefined && cambio.stage !== antes.stage && ENVIO_O_APROBACION.has(cambio.stage)) {
    return conflictosDeSitio(despues, reglas, tiendas);
  }
  const tocaSitio = CAMPOS_DE_SITIO.some((k) => k in cambio);
  if (etapa !== "draft" && tocaSitio && conflictosDeSitio(antes, reglas, tiendas).length === 0) {
    return conflictosDeSitio(despues, reglas, tiendas);
  }
  return [];
}

/** El aviso de la guarda, en el idioma de la persona. */
export function avisoNoVaANingunSitio(choques: MissingField[], lang: "en" | "es"): string {
  const lista = choques.map((m) => `• ${lang === "es" ? m.es : m.en}`).join("\n");
  return lang === "es"
    ? `No se guardó: la orden va a su propio sitio.\n\n${lista}`
    : `Not saved: the order goes nowhere.\n\n${lista}`;
}
