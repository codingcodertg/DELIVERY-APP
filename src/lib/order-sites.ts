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

/**
 * Sin tienda de origen. Si la recogida era esa tienda —se rellena al elegirla—, también sin recogida.
 *
 * Desde D-NEXT esto vale **también** para un tipo que recibe: ahí «Vendido desde» y la recogida las
 * escribe una sola elección, así que vaciar el origen se las lleva las dos, y no hay que vaciar una
 * punta que la persona no eligió.
 */
function sinOrigen(d: Borrador): Borrador {
  const recogidaDeLaTienda = !!normalizaLugar(d.store) && normalizaLugar(d.pickup_name) === normalizaLugar(d.store);
  return { ...d, store: "", ...(recogidaDeLaTienda ? { pickup_name: "", pickup_address: "" } : {}) };
}

function sinDestino(d: Borrador): Borrador {
  return { ...d, delivery_name: "", delivery_address: "" };
}

/**
 * Aplicar un tipo de orden (antes `withTypeDefaults`, dentro del modal).
 *
 * **Un tipo «que recibe» (`homeIsDestination`, hoy solo Intertienda) vuelve a cambiar de forma en
 * D-NEXT.** D-302 lo había dejado así: la tienda del usuario vendía y recibía, y lo que se elegía era
 * la recogida. Damaris, de office: *«INV 170059 dice sold from Edinburg y debe de ser Pharr; app tiene
 * que automáticamente poder sold from de la tienda de la cual estoy solicitando el material»*. Tenía
 * razón: «Vendido desde» decía la tienda que **pedía** el material.
 *
 * Ahora la tienda del usuario **solo recibe** —el destino queda congelado en ella— y lo que se elige es
 * **a qué tienda se le pide**, que escribe «Vendido desde» y la recogida a la vez.
 *
 * Quien no tiene tienda (admin, office sin tienda) elige las dos puntas, como quedó en D-302.
 *
 * En los demás tipos, el origen por defecto sigue siendo su tienda.
 *
 * **Desde D-276, un tipo tienda-a-tienda nunca queda con el origen en el destino.** Si con las dos
 * puntas puestas chocan, se vacía la que el tipo deja elegir: **el origen** en un tipo que recibe
 * (D-NEXT; hasta D-302 era la recogida, que es donde vivía entonces), el destino en los demás.
 */
export function aplicaTipo(p: Borrador, tipo: string, c: ContextoDelUsuario): Borrador {
  const rule = orderTypeRule(tipo, c.reglas);
  const next: Borrador = { ...p, order_type: tipo };
  // Un movimiento tienda-a-tienda no tiene cliente, así que no tiene contacto ni teléfono (D-309:
  // «remove account contact name and phone number from intertienda»). Se **limpian al cambiar de tipo**
  // y no solo se esconden: escondidos seguirían viajando a la base.
  //
  // **La cuenta vuelve, y es la tienda que recibe** (D-NEXT). Damaris, de office: «Account se debe de
  // llenar automáticamente con el nombre de mi tienda cuando es intertienda». Se pone abajo, cuando ya
  // se sabe cuál es el destino; aquí solo se vacía, para que un tipo de cliente no se deje la cuenta
  // del cliente anterior dentro de una Intertienda.
  //
  // Solo al cambiar de tipo: una orden ya guardada no se toca al abrirla.
  if (rule.storeToStore === true) {
    next.account = "";
    next.contact = "";
    next.delivery_phone = "";
  }
  // Y al SALIR de un tipo tienda-a-tienda se suelta la cuenta, porque la escribió la máquina con el
  // nombre de una tienda (D-NEXT): dejarla dentro de una orden de cliente diría que una tienda es el
  // cliente. Se mira de dónde viene, no lo que hay escrito: una cuenta tecleada a mano —que solo puede
  // venir de otro tipo de cliente— no se toca.
  if (rule.storeToStore !== true && orderTypeRule(p.order_type, c.reglas).storeToStore === true) {
    next.account = "";
  }
  if (rule.homeIsDestination && c.miTienda) {
    const home = c.tiendas.find((s) => s.name === c.miTienda);
    // Su tienda RECIBE, y lo que se elige es **a qué tienda se le pide el material** (D-NEXT). Esa
    // elección escribe «Vendido desde» y la recogida a la vez, así que las dos se vacían aquí para que
    // no quede la de nadie: D-302 ponía su tienda en `store` y por eso la orden decía que se vendía
    // desde la tienda que la estaba pidiendo.
    next.delivery_name = c.miTienda;
    next.delivery_address = home?.address ?? p.delivery_address ?? "";
    next.store = "";
    next.pickup_name = "";
    next.pickup_address = "";
  } else if (!p.store && c.miTienda) {
    next.store = c.miTienda; // normal direction: Sold From is the rep's store
  }
  // La cuenta, con el destino ya decidido (D-NEXT). Va después del bloque de arriba a propósito: en un
  // tipo que recibe el destino se acaba de poner, y en los demás tienda-a-tienda puede estar vacío
  // todavía — entonces la cuenta también, y la escribirá `eligeDestino` cuando se elija.
  if (rule.storeToStore === true) next.account = next.delivery_name ?? "";
  // **Desde D-NEXT la punta que el tipo deja elegir es el ORIGEN**, también en un tipo que recibe: si
  // con las dos puestas chocan, se vacía «Vendido desde» y su recogida, que es lo que la persona puede
  // cambiar. Hasta D-302 se vaciaba la recogida, porque allí el origen vivía ahí.
  if (rule.storeToStore === true && origenEsDestino(next, rule, c.tiendas)) {
    return rule.homeIsDestination ? sinOrigen(next) : sinDestino(next);
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
