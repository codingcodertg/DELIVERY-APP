/**
 * «Juntar» dos Intertiendas con la misma factura (D-549).
 *
 * El dueño, 2026-10-14: «when intertienda has 2 of the same invoice order ask if you want to create a duplicate or to merge
 * the order», y después «entonces crea el merge option». El caso, de un chat que mandó: la tienda A le compra a la tienda B
 * con varias PO; B saca UNA factura para todas; A mete tres órdenes y B pone la misma factura en las tres; el almacén prepara
 * una sola carga pero tiene que hacer el proceso tres veces. Lo que se propuso en ese chat: «Invoice # already exists, would
 * you like to make a separate order (multiple trips) or join the orders for 1 trip».
 *
 * Lo de aquí es la regla, sin pantalla: cuándo se ofrece, quién puede, y qué se escribe en la orden que ya existía.
 *
 * **Solo al CREAR** una orden nueva (el botón «Crear» de la ficha). Al editar una orden que ya existe, o al escribir la
 * factura después desde la fila (D-310) o con «Agregar material» (D-339), sigue el aviso de siempre: juntar ahí significaría
 * anular la otra orden, que es otra decisión (y otra escritura que el guard no deja a todos).
 *
 * Nota D-557 (2026-10-15): esa «otra decisión» la tomó el dueño («si a todo»). Al escribir la factura en una Intertienda
 * que YA EXISTE (editándola en la ficha, desde la fila con «Factura pendiente», o con «Agregar material») y otra
 * Intertienda abierta ya la tiene, se ofrece «Juntar en #X»: una se queda con la PO y los pallets de las dos y la otra se
 * anula con el motivo «Juntada en #X». Las funciones de abajo del bloque «Juntar dos órdenes que ya existen».
 */
import { puedeAnular } from "./constants";
import { MOTIVO_OTRO } from "./cancel-reasons";
import { facturaComparable } from "./misma-factura";
import { orderTypeRule, type OrderTypeRules } from "./required";
import type { Delivery, Stage, UserRole } from "./types";
import { orderLabel, palletDuration } from "./utils";

/**
 * ¿Es una Intertienda? Por la REGLA del tipo, no por su nombre: de tienda a tienda (`storeToStore`) y con la tienda propia
 * como DESTINO (`homeIsDestination`, la que compra). Un «Transfer» (de tienda a tienda sin `homeIsDestination`) no cuenta.
 */
export function esIntertienda(tipo: string | null | undefined, reglas?: OrderTypeRules): boolean {
  const regla = orderTypeRule(tipo, reglas);
  return regla.storeToStore === true && regla.homeIsDestination === true;
}

/**
 * Las etapas en las que la otra orden todavía es UN viaje por hacer: ni recogida, ni entregada, ni anulada. Tampoco la
 * rechazada: no va a salir, y meterle pallets sería esconderlos en una orden muerta.
 */
export const ETAPAS_EN_LAS_QUE_SE_JUNTA: readonly string[] = ["draft", "pending", "approved", "fulfilling", "ready"];

const igual = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

type Nueva = Pick<Partial<Delivery>, "order_type" | "invoice_num" | "store" | "delivery_name">;

/**
 * La Intertienda abierta con la que se puede juntar la orden que se está creando, o `null`.
 *
 * - Las dos son Intertienda (por la regla del tipo).
 * - La misma factura (`facturaComparable`: sin espacios, sin «#», sin mayúsculas), en su factura o entre sus facturas
 *   agregadas (D-339).
 * - La misma tienda que vende (`store`): una factura es de UNA tienda, y si no casan es un error de dedo, no un viaje.
 * - El mismo destino (`delivery_name`) si las dos lo tienen: dos destinos no son un viaje.
 * - La otra sigue abierta (`ETAPAS_EN_LAS_QUE_SE_JUNTA`).
 *
 * Si hay varias, la más reciente (el `order_no` más alto), como `ordenConEsaFactura`.
 */
export function ofreceJuntar<T extends Delivery>(nueva: Nueva, existentes: readonly T[], reglas?: OrderTypeRules): T | null {
  const factura = facturaComparable(nueva.invoice_num);
  if (!factura || !esIntertienda(nueva.order_type, reglas)) return null;
  let mejor: T | null = null;
  for (const o of existentes) {
    if (!ETAPAS_EN_LAS_QUE_SE_JUNTA.includes(o.stage)) continue;
    if (!esIntertienda(o.order_type, reglas)) continue;
    const suyas = [o.invoice_num, ...(o.invoices_extra ?? [])].map(facturaComparable);
    if (!suyas.includes(factura)) continue;
    if (!igual(o.store, nueva.store)) continue;
    if ((o.delivery_name ?? "").trim() && (nueva.delivery_name ?? "").trim() && !igual(o.delivery_name, nueva.delivery_name)) continue;
    if (!mejor || (o.order_no ?? 0) > (mejor.order_no ?? 0)) mejor = o;
  }
  return mejor;
}

/**
 * ¿Le deja la base a este rol escribir la PO y los pallets de la otra orden, en su etapa, sin cambiarla de etapa? Es el
 * espejo del tramo «misma etapa» de `guard_delivery_stage` (169):
 *
 * - admin: siempre (sale antes del guard).
 * - gerente y oficina (`manager`, `accounting`): cualquier etapa.
 * - logística: borrador a lista.
 * - almacén: aprobada, preparando y lista (las de su cola).
 * - ventas y chofer: solo borrador y pendiente. En `approved` en adelante la base solo le deja a ventas poner la factura
 *   que falta (125) y agregar facturas y pallets a SU orden (138): la PO no. A ellos «Juntar» no se les ofrece en esas
 *   etapas, y la pregunta lo dice.
 */
export function puedeJuntarEn(rol: string | null | undefined, etapa: string | null | undefined): boolean {
  if (!etapa || !ETAPAS_EN_LAS_QUE_SE_JUNTA.includes(etapa)) return false;
  if (rol === "admin" || rol === "manager" || rol === "accounting" || rol === "logistics") return true;
  if (rol === "warehouse") return ["approved", "fulfilling", "ready"].includes(etapa);
  if (rol === "sales" || rol === "driver") return etapa === "draft" || etapa === "pending";
  return false;
}

/** Las PO de las dos órdenes, separadas por «, », sin repetir ninguna (ni por mayúsculas ni por espacios). */
export function unirPOs(existente: string | null | undefined, nueva: string | null | undefined): string | null {
  const todas: string[] = [];
  for (const trozo of [existente, nueva].flatMap((s) => (s ?? "").split(","))) {
    const po = trozo.trim();
    if (po && !todas.some((ya) => igual(ya, po))) todas.push(po);
  }
  return todas.length ? todas.join(", ") : null;
}

/**
 * Lo que se escribe en la orden que ya existía al juntar: la PO de la nueva sumada a la suya, sus pallets sumados, y las dos
 * duraciones recalculadas con el total (son `pallets × minutos por pallet`, como en la ficha). Nada más: ni fecha, ni
 * tienda, ni etapa. Sin pallets en ninguna de las dos, los pallets no se tocan.
 */
export function parcheAlJuntar(
  existente: Pick<Delivery, "po2" | "est_pallets">,
  nueva: Pick<Partial<Delivery>, "po2" | "est_pallets">,
  minutosPorPallet: { recoger: number; entregar: number },
): Partial<Delivery> {
  const parche: Partial<Delivery> = {};
  const po = unirPOs(existente.po2, nueva.po2);
  if (po !== (existente.po2 ?? null)) parche.po2 = po;
  const suyos = Number(existente.est_pallets) || 0;
  const mas = Number(nueva.est_pallets) || 0;
  if (mas > 0) {
    const total = suyos + mas;
    parche.est_pallets = total;
    parche.pickup_duration = palletDuration(total, minutosPorPallet.recoger);
    parche.delivery_duration = palletDuration(total, minutosPorPallet.entregar);
  }
  return parche;
}

/**
 * La nota que queda en el historial de la orden que recibe: qué PO, cuántos pallets, y por qué (la misma factura).
 *
 * Nota D-557: con `desde` (la etiqueta de la orden que se anula al juntar dos que ya existían) dice también cuál fue:
 * «Se juntó #Y (PO …, N pallets) — misma factura #F». Sin él, como en D-549 (la nueva no tenía número).
 */
export function notaAlJuntar(nueva: Pick<Partial<Delivery>, "po2" | "est_pallets" | "invoice_num">, lang: "en" | "es", desde?: string): string {
  const po = (nueva.po2 ?? "").trim() || (lang === "es" ? "sin PO" : "no PO");
  const pallets = Number(nueva.est_pallets) || 0;
  const factura = (nueva.invoice_num ?? "").trim();
  if (desde) {
    return lang === "es"
      ? `Se juntó #${desde} (PO ${po}, ${pallets} pallets) — misma factura #${factura}`
      : `#${desde} joined (PO ${po}, ${pallets} pallets) — same invoice #${factura}`;
  }
  return lang === "es"
    ? `Se juntó la PO ${po} (${pallets} pallets) — misma factura #${factura}`
    : `PO ${po} joined (${pallets} pallets) — same invoice #${factura}`;
}

// ---------------------------------------------------------------------------
// Juntar dos órdenes que ya existen (D-557, 2026-10-15)
// ---------------------------------------------------------------------------
//
// Lo que aprobó el dueño («si a todo», 2026-10-15): «when an invoice is put on an Intertienda that already has an open
// Intertienda with the same invoice, offer "Juntar en #X": that order gets CANCELED with reason "Juntada en #X", and its PO
// and pallets move to #X». El caso de su chat: la tienda B escribe la MISMA factura en tres órdenes que la tienda A ya creó.

/** Las facturas de una orden (la suya y las agregadas, D-339), comparables y sin vacías. */
const facturasDe = (o: Pick<Partial<Delivery>, "invoice_num" | "invoices_extra">): string[] =>
  [o.invoice_num, ...(o.invoices_extra ?? [])].map((f) => facturaComparable(f)).filter(Boolean);

/**
 * La factura que esta escritura le AÑADE a la orden, tal como se escribió, o `null`. Se pregunta solo entonces: guardar
 * otra cosa en una orden que ya tenía esa factura no vuelve a preguntar (ya se juntó, o ya se dejó aparte).
 */
export function facturaNuevaAlEditar(
  antes: Pick<Partial<Delivery>, "invoice_num" | "invoices_extra">,
  despues: Pick<Partial<Delivery>, "invoice_num" | "invoices_extra">,
): string | null {
  const yaTenia = facturasDe(antes);
  for (const f of [despues.invoice_num, ...(despues.invoices_extra ?? [])]) {
    const clave = facturaComparable(f);
    if (clave && !yaTenia.includes(clave)) return (f ?? "").trim();
  }
  return null;
}

/**
 * La Intertienda abierta con la que se puede juntar ESTA orden, que ya existe y recibe ahora `factura`, o `null`. Las
 * mismas reglas que al crear (`ofreceJuntar`: Intertienda por la regla, la misma factura —también entre las agregadas—, la
 * misma tienda que vende, el mismo destino si las dos lo tienen, la otra abierta), más dos: la propia orden no cuenta, y
 * ella también tiene que estar abierta (una recogida o anulada no se junta con nada).
 */
export function ofreceJuntarExistente<T extends Delivery>(
  orden: Pick<Partial<Delivery>, "id" | "stage" | "order_type" | "store" | "delivery_name">,
  factura: string | null | undefined,
  existentes: readonly T[],
  reglas?: OrderTypeRules,
): T | null {
  if (!orden.stage || !ETAPAS_EN_LAS_QUE_SE_JUNTA.includes(orden.stage)) return null;
  const otras = existentes.filter((o) => o.id !== orden.id);
  return ofreceJuntar({ order_type: orden.order_type, invoice_num: factura, store: orden.store, delivery_name: orden.delivery_name }, otras, reglas);
}

/**
 * Cuál de las dos se queda y cuál se anula. **Se queda la que va más adelante** (en `ETAPAS_EN_LAS_QUE_SE_JUNTA`): si
 * almacén ya empezó a preparar una, anular esa tiraría su trabajo (y su ruta, su chofer). **Empatadas, la más vieja** (el
 * `order_no` más bajo): es la que la gente ya conoce por su número. Sin número pierde; y si todo empata, el `id` decide,
 * para que la respuesta no dependa del orden en que llegan.
 */
export function quienSeQueda<T extends Pick<Delivery, "id" | "stage" | "order_no">>(a: T, b: T): { queda: T; anula: T } {
  const etapa = (o: T) => ETAPAS_EN_LAS_QUE_SE_JUNTA.indexOf(o.stage);
  if (etapa(a) !== etapa(b)) return etapa(a) > etapa(b) ? { queda: a, anula: b } : { queda: b, anula: a };
  const numero = (o: T) => (typeof o.order_no === "number" ? o.order_no : Number.POSITIVE_INFINITY);
  if (numero(a) !== numero(b)) return numero(a) < numero(b) ? { queda: a, anula: b } : { queda: b, anula: a };
  return a.id <= b.id ? { queda: a, anula: b } : { queda: b, anula: a };
}

/** Por qué este rol no puede juntar estas dos. */
export type PorQueNoSeJunta = "etapa" | "editar" | "anular";

/**
 * ¿Puede este rol juntar dos órdenes que ya existen? `null` = sí. Tiene que poder las DOS escrituras, porque una sin la
 * otra es media junta: escribir la PO y los pallets en la que se queda, en su etapa (`puedeJuntarEn`, el tramo «misma
 * etapa» del guard), y anular la otra en la suya (`puedeAnular`, el espejo del guard de la 122). Con el guard de la 173:
 *
 * - admin, gerente y oficina: sí, en las cinco etapas abiertas.
 * - logística: puede escribir pero **no anula** (el guard no le deja ningún salto de etapa) → no.
 * - almacén: tampoco anula → no. Es justo quien hace el proceso tres veces; abrírselo es cambiar el guard, y no se hace aquí.
 * - ventas y chofer: solo si la que se anula está en borrador y la que se queda en borrador o pendiente.
 */
export function porQueNoPuedeJuntar(rol: string | null | undefined, queda: string | null | undefined, anula: string | null | undefined): PorQueNoSeJunta | null {
  if (!queda || !anula || !ETAPAS_EN_LAS_QUE_SE_JUNTA.includes(queda) || !ETAPAS_EN_LAS_QUE_SE_JUNTA.includes(anula)) return "etapa";
  if (!puedeJuntarEn(rol, queda)) return "editar";
  if (!rol || !puedeAnular(rol as UserRole, anula as Stage)) return "anular";
  return null;
}

type ConEtiqueta = { order_code?: string | null; order_no: number; order_suffix?: string | null };

/**
 * El motivo con que se anula la que se junta. **La clave es `other`** con el texto «Juntada en #X»: es la única clave que
 * existe seguro (la lista de motivos vive en `settings.cancel_reasons`, la edita el admin, y solo `other` y la del retraso
 * no se pueden borrar). Una clave nueva («merged») saldría tal cual, sin etiqueta, en cualquier lista ya guardada, y
 * añadirla a esas listas es escribir datos de producción.
 */
export function anulacionAlJuntar(queda: ConEtiqueta, factura: string, lang: "en" | "es"): Pick<Delivery, "canceled_reason" | "canceled_reason_note"> {
  const x = orderLabel(queda);
  const f = (factura ?? "").trim();
  return {
    canceled_reason: MOTIVO_OTRO,
    canceled_reason_note: lang === "es" ? `Juntada en #${x} — misma factura #${f}` : `Joined into #${x} — same invoice #${f}`,
  };
}

/** Lo que devuelve la que se queda a como estaba si la anulación falla: los mismos campos del parche, con su valor de antes. */
export function deshacerAlJuntar(antes: Partial<Delivery>, parche: Partial<Delivery>): Partial<Delivery> {
  const vuelta: Record<string, unknown> = {};
  for (const k of Object.keys(parche)) vuelta[k] = (antes as Record<string, unknown>)[k] ?? null;
  return vuelta as Partial<Delivery>;
}

/** Las escrituras que usa `juntarExistentes`: las del proveedor de datos, las mismas de toda la app. */
export type EscriturasDeJuntar = {
  updateDelivery: (id: string, patch: Partial<Delivery>) => Promise<boolean>;
  addNote: (id: string, text: string) => Promise<void>;
  setStage: (id: string, stage: Stage, note?: string, extra?: Partial<Delivery>) => Promise<boolean>;
};

/**
 * - `juntada`: la que se queda tiene las dos PO y los pallets, y la otra está anulada.
 * - `sin_escribir`: falló la primera escritura; no cambió nada.
 * - `deshecha`: la anulación falló y la que se queda volvió a como estaba (con una nota que lo dice).
 * - `a_medias`: la anulación falló y deshacer también. Se dice con todas las letras: la que se queda tiene la PO y los
 *   pallets de la otra, y la otra sigue viva.
 */
export type ResultadoDeJuntar = "juntada" | "sin_escribir" | "deshecha" | "a_medias";

/** Los campos de la escritura propia que viajan con la anulación cuando la que se anula es la que se estaba editando: la
 *  factura que se acaba de escribir (para que su ficha diga por qué), nada más. */
const CAMPOS_PROPIOS_AL_ANULAR = ["invoice_num", "invoices_extra"] as const;

/**
 * Junta dos Intertiendas que ya existen. **Primero la que se queda, después la anulación**: si se anulara primero y la
 * segunda escritura fallara, la PO y los pallets de la anulada no estarían en ninguna orden viva, que es lo peor (el
 * material no sale). Al revés, lo malo es una orden con una PO de más, y eso se deshace.
 *
 * `propia` es lo que la persona estaba guardando en la orden `idPropia` (la factura y, en la ficha, el resto del
 * formulario). Si esa orden se queda, viaja entera junto al parche; si se anula, solo viaja su factura, con la anulación.
 */
export async function juntarExistentes(
  esc: EscriturasDeJuntar,
  args: {
    queda: Delivery; anula: Delivery; idPropia: string; propia: Partial<Delivery>; factura: string;
    minutosPorPallet: { recoger: number; entregar: number }; lang: "en" | "es";
  },
): Promise<ResultadoDeJuntar> {
  const { queda, anula, idPropia, propia, factura, minutosPorPallet, lang } = args;
  const propiaQueda: Partial<Delivery> = queda.id === idPropia ? propia : {};
  const quedaDespues = { ...queda, ...propiaQueda };
  const anulaDespues = { ...anula, ...(anula.id === idPropia ? propia : {}) };
  const propiaAnula: Record<string, unknown> = {};
  if (anula.id === idPropia) {
    for (const k of CAMPOS_PROPIOS_AL_ANULAR) if (k in propia) propiaAnula[k] = propia[k];
  }

  const parche = parcheAlJuntar(quedaDespues, anulaDespues, minutosPorPallet);
  const escritura = { ...propiaQueda, ...parche };
  if (Object.keys(escritura).length && !(await esc.updateDelivery(queda.id, escritura))) return "sin_escribir";
  await esc.addNote(queda.id, notaAlJuntar({ po2: anulaDespues.po2, est_pallets: anulaDespues.est_pallets, invoice_num: factura }, lang, orderLabel(anula)));

  const motivo = anulacionAlJuntar(queda, factura, lang);
  if (await esc.setStage(anula.id, "canceled", motivo.canceled_reason_note ?? undefined, { ...(propiaAnula as Partial<Delivery>), ...motivo })) return "juntada";

  const vuelta = deshacerAlJuntar(quedaDespues, parche);
  if (Object.keys(vuelta).length && !(await esc.updateDelivery(queda.id, vuelta))) return "a_medias";
  await esc.addNote(queda.id, lang === "es"
    ? `No se pudo anular #${orderLabel(anula)}: se deshizo lo que se le había sumado de ella`
    : `Could not cancel #${orderLabel(anula)}: what had been added from it was undone`);
  return "deshecha";
}

/** Lo que se le dice a la persona después de `juntarExistentes`. `null` en `sin_escribir`: el proveedor ya avisó del error. */
export function avisoTrasJuntar(r: ResultadoDeJuntar, queda: ConEtiqueta, anula: ConEtiqueta, lang: "en" | "es"): string | null {
  const q = orderLabel(queda);
  const a = orderLabel(anula);
  if (r === "juntada") return lang === "es" ? `#${a} se juntó en #${q} (un viaje) y quedó anulada` : `#${a} was joined into #${q} (one trip) and canceled`;
  if (r === "deshecha") return lang === "es"
    ? `No se pudo anular #${a}; #${q} volvió a como estaba. No se juntó nada.`
    : `Could not cancel #${a}; #${q} is back as it was. Nothing was joined.`;
  if (r === "a_medias") return lang === "es"
    ? `ATENCIÓN: #${q} ya tiene la PO y los pallets de #${a}, pero #${a} NO se anuló y no se pudo deshacer. Anula #${a} a mano (motivo «Otro»: Juntada en #${q}) o quítale a #${q} lo sumado.`
    : `WARNING: #${q} already has #${a}'s PO and pallets, but #${a} was NOT canceled and it could not be undone. Cancel #${a} by hand (reason «Other»: Joined into #${q}) or remove what was added to #${q}.`;
  return null;
}
