import { aLaDecima, palletsDeLaOrden } from "./pallets";
import { parteOrdenesGrandes, type ChoferEntrada, type OrdenEntrada } from "./route-engine";
import { ETAPAS_RUTEABLES } from "./route-plan/publicar";
import type { Delivery } from "./types";

/**
 * Las CARGAS de una orden que no cabe en el camión (D-452, migración 157). El dueño, 2026-09-30: «so if we have an order
 * of more than 10 pallets that will be devided into 2 those 2 orders should assign as 2 p 2 d».
 *
 * El modelo: las cargas son ÓRDENES hermanas —la misma `order_no` y `order_code`, con `order_suffix` a, b, c…—, el
 * mecanismo que la app ya tiene desde la 012 (la partición al recoger), llevado al momento de planificar. Una carga es una
 * fila de `deliveries`: tiene su chofer, su puesto, su etapa, su recogida y su entrega. Por eso ningún lector de la ruta
 * cambia; lo que vive aquí es lo que decide CUÁNDO se parte, en cuánto, qué copia la carga nueva, cómo se nombra y cómo se
 * lee la familia. Sin pantalla ni base. El SQL (157) hace lo mismo en el servidor, y una prueba compara las dos listas de
 * columnas.
 */

export type CargaMinima = Pick<Delivery, "id" | "order_no"> & { order_suffix?: string | null; is_training?: boolean; stage?: string; actual_pallets?: number | null; est_pallets?: number | null };

/** Las cargas de la misma orden —misma `order_no` y mismo `is_training`—, incluida ella, por su letra (la sin letra, primero). */
export function hermanasDe<T extends CargaMinima>(todas: readonly T[], d: Pick<CargaMinima, "order_no" | "is_training">): T[] {
  return todas
    .filter((x) => x.order_no === d.order_no && !!x.is_training === !!d.is_training)
    .sort((a, b) => (a.order_suffix ?? "").localeCompare(b.order_suffix ?? ""));
}

/** «Carga 1 de 2»: cuál es esta y de cuántas. `null` si la orden no está partida. */
export function cargaDe(d: Pick<CargaMinima, "id">, hermanas: readonly Pick<CargaMinima, "id">[]): { numero: number; de: number } | null {
  if (hermanas.length < 2) return null;
  const numero = hermanas.findIndex((x) => x.id === d.id) + 1;
  return numero > 0 ? { numero, de: hermanas.length } : null;
}

export const etiquetaDeCarga = (c: { numero: number; de: number }, es: boolean): string => (es ? `carga ${c.numero} de ${c.de}` : `load ${c.numero} of ${c.de}`);

/** La letra de la carga nueva: la siguiente a la mayor de la familia; una orden nunca partida cuenta como `a`. `null` si se acabaron. */
export function siguienteLetra(hermanas: readonly Pick<CargaMinima, "order_suffix">[]): string | null {
  const mayor = hermanas.reduce((m, h) => ((h.order_suffix ?? "a") > m ? h.order_suffix ?? "a" : m), "a");
  const n = String.fromCharCode(mayor.charCodeAt(0) + 1);
  return n > "z" ? null : n;
}

const centesimas = (n: number) => Math.round(n * 100);

/**
 * Lo que propone el sistema al partir en DOS: llena el camión y el resto va a la otra carga (la regla del motor,
 * `parteOrdenesGrandes`). `null` si cabe entera —una orden que cabe no se parte nunca— o si no se sabe cuánto lleva.
 */
export function restoPropuesto(total: number, capacidad: number): number | null {
  if (!(total > 0) || !(capacidad > 0) || centesimas(total) <= centesimas(capacidad)) return null;
  return (centesimas(total) - centesimas(capacidad)) / 100;
}

const ruteable = (d: { stage?: string }) => !!d.stage && ETAPAS_RUTEABLES.includes(d.stage);

/** ¿Se puede partir esta orden desde el Gestor? Pendiente de ruta, con pallets, y más de los que caben en ese camión. */
export function sePuedePartir(d: CargaMinima, capacidad: number): boolean {
  return ruteable(d) && restoPropuesto(palletsDeLaOrden(d), capacidad) != null;
}

/** ¿Se pueden volver a juntar dos cargas? Hermanas, las dos pendientes de ruta, y la suma cabe en ese camión. */
export function sePuedenJuntar(a: CargaMinima, b: CargaMinima, capacidad: number): boolean {
  if (a.id === b.id || a.order_no !== b.order_no || !!a.is_training !== !!b.is_training) return false;
  if (!a.order_suffix || !b.order_suffix || !ruteable(a) || !ruteable(b)) return false;
  return capacidad > 0 && centesimas(palletsDeLaOrden(a)) + centesimas(palletsDeLaOrden(b)) <= centesimas(capacidad);
}

/** La otra carga de una familia de DOS (la que se junta o con la que se reparte). `null` si no hay exactamente otra. */
export function laOtraCarga<T extends CargaMinima>(d: Pick<CargaMinima, "id">, hermanas: readonly T[]): T | null {
  const otras = hermanas.filter((x) => x.id !== d.id);
  return otras.length === 1 ? otras[0] : null;
}

/**
 * La etapa de la FAMILIA (decisión 2 del orquestador, leída por familia porque no hay fila madre): entregada cuando TODAS
 * sus cargas vivas están entregadas; en reparto cuando alguna ya salió (recogida o entregada) y no todas llegaron; si no,
 * pendiente. Una carga anulada o rechazada no cuenta.
 */
export function etapaDeLaFamilia(hermanas: readonly { stage?: string }[]): "entregada" | "en_reparto" | "pendiente" {
  const vivas = hermanas.filter((h) => h.stage !== "canceled" && h.stage !== "rejected");
  if (vivas.length && vivas.every((h) => h.stage === "delivered")) return "entregada";
  if (vivas.some((h) => h.stage === "delivered" || h.stage === "picked_up")) return "en_reparto";
  return "pendiente";
}

/**
 * Qué parte el motor y en cuánto: las órdenes que no caben en el camión más grande de los que pueden llevarlas, con los
 * RESTOS sucesivos que hay que pedirle a `partir_carga`: para partes [10, 10, 5], primero 15 (todo menos la primera, a
 * la madre) y después 5 (a la carga recién nacida). Es exactamente lo que el motor haría virtualmente, hecho en filas.
 */
export function restosParaPartir(partes: readonly { pallets: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < partes.length; i++) out.push(partes.slice(i).reduce((s, p) => s + centesimas(p.pallets), 0) / 100);
  return out;
}

export function particionesDelDia(ordenes: readonly OrdenEntrada[], choferes: readonly ChoferEntrada[]): { id: string; restos: number[] }[] {
  const { ordenes: partidas, partes } = parteOrdenesGrandes(ordenes, choferes);
  const porId = new Map(partidas.map((o) => [o.id, o]));
  return Object.entries(partes).map(([id, ids]) => ({ id, restos: restosParaPartir(ids.map((x) => porId.get(x)!)) })).filter((p) => p.restos.length);
}

// ---- Partir SOLA al guardar (D-NEXT) -----------------------------------------------------------------------------
// Roberto Rodriguez Jr, 2026-10-22, desde el Gestor: «When its over 10 pallets system needs to automatically split it into
// 2 trips». FV168 (18 pallets, camión de 10) salió en UN viaje: se asignó con «Asignar a…» (D-474), cuyo motor parte en
// cargas VIRTUALES (`id#a`, `id#b`) y las vuelve a juntar en una fila al escribir (`paradasSinPartes`); `partir_carga`
// solo lo llamaban «Armar rutas» y el ✂ del Gestor. Ahora lo llama el guardado mismo: toda forma de darle chofer a una
// orden desde la app pasa por `updateDelivery` (Gestor, «Asignar a…», «Mejor lugar», arrastre, «Pasar a…», la ficha,
// Órdenes), y es ahí donde ya se avisa al chofer de su asignación por la misma razón.

/** Quién puede partir: el espejo de `puede_partir_cargas` (157). El módulo lo mira la base; aquí solo se evita pedírselo
 *  a quien seguro no puede (ventas o almacén subiendo pallets de una orden ya asignada). */
export const ROLES_QUE_PARTEN: readonly string[] = ["admin", "logistics", "manager", "accounting"];

/**
 * Las cargas en que va una orden en un camión: llena camiones y la última lleva el resto —la regla del motor
 * (`parteOrdenesGrandes`)—: 18 en 10 → [10, 8]; 25 en 10 → [10, 10, 5]. Vacío si cabe entera (o no se sabe).
 */
export function cargasParaElCamion(total: number, capacidad: number): number[] {
  if (restoPropuesto(total, capacidad) == null) return [];
  const t = centesimas(total), c = centesimas(capacidad);
  const n = Math.ceil(t / c);
  return Array.from({ length: n }, (_, k) => (k < n - 1 ? c : t - c * (n - 1)) / 100);
}

export type OrdenAlGuardar = Pick<Delivery, "assigned_driver" | "stage" | "est_pallets" | "actual_pallets">;

/**
 * ¿Este guardado deja una orden que no cabe en el camión de su chofer? Devuelve las CARGAS en que va (vacío si no hay que
 * partir); los restos para `partir_carga` en cadena salen de ellas con `restosParaPartir`.
 *
 * Solo cuando el guardado es el que crea el desborde: le DA chofer (otro que el que tenía) o le CAMBIA los pallets a una
 * que ya lo tiene. Un guardado que no toca ni lo uno ni lo otro (una nota, la factura) no parte nada, aunque la orden ya
 * estuviera de más: esa la sigue ofreciendo el ✂ del Gestor. Y solo pendiente de ruta (lo ya recogido va entero: es lo
 * que pasó), y solo si quien guarda puede partir.
 */
export function cargasAlGuardar(antes: OrdenAlGuardar | null | undefined, cambio: Partial<OrdenAlGuardar>, capacidadDe: (chofer: string) => number, rol: string | null | undefined): number[] {
  if (!antes || !rol || !ROLES_QUE_PARTEN.includes(rol)) return [];
  const despues = { ...antes, ...cambio };
  const chofer = (despues.assigned_driver ?? "").trim();
  if (!chofer || !ruteable(despues)) return [];
  const leDaChofer = "assigned_driver" in cambio && chofer !== (antes.assigned_driver ?? "").trim();
  const leCambiaPallets = ("est_pallets" in cambio || "actual_pallets" in cambio) && centesimas(palletsDeLaOrden(despues)) !== centesimas(palletsDeLaOrden(antes));
  if (!leDaChofer && !leCambiaPallets) return [];
  return cargasParaElCamion(palletsDeLaOrden(despues), capacidadDe(chofer));
}

/**
 * Parte en cadena: cada resto se le pide a la carga recién nacida (la madre se queda con la primera). Para en el primer
 * fallo y devuelve las nuevas que sí nacieron —son órdenes válidas, como en «Armar rutas»—.
 */
export async function parteEnCadena(partir: (id: string, resto: number) => Promise<string | null>, id: string, restos: readonly number[]): Promise<string[]> {
  const nuevas: string[] = [];
  let de = id;
  for (const resto of restos) {
    const nueva = await partir(de, resto);
    if (!nueva) break;
    nuevas.push(nueva);
    de = nueva;
  }
  return nuevas;
}

/** El aviso a quien asigna: qué se partió y en cuánto, y que cada carga se coloca con las flechas (la nueva nace sin puesto:
 *  medido en el demo, sale donde la lista pone lo provisional, no necesariamente al final); o que no se pudo y queda el ✂. */
export function avisoDePartirSola(a: { orden: string; chofer: string; capacidad: number; cargas: readonly number[]; nacidas: number }): { en: string; es: string } {
  const lista = a.cargas.map((n) => String(aLaDecima(n))).join(" + ");
  const total = aLaDecima(a.cargas.reduce((s, n) => s + centesimas(n), 0) / 100);
  if (a.nacidas < a.cargas.length - 1) {
    return {
      en: `#${a.orden} doesn't fit in ${a.chofer}'s truck (${total} of ${a.capacidad} pallets) and could not be split automatically: use ✂ in Routes.`,
      es: `#${a.orden} no cabe en el camión de ${a.chofer} (${total} de ${a.capacidad} pallets) y no se pudo partir sola: usa ✂ en Rutas.`,
    };
  }
  return {
    en: `#${a.orden} didn't fit in ${a.chofer}'s truck (${total} of ${a.capacidad} pallets): split into ${a.cargas.length} trips, ${lista}. Each load has its own P and D: place them with the arrows.`,
    es: `#${a.orden} no cabía en el camión de ${a.chofer} (${total} de ${a.capacidad} pallets): partida en ${a.cargas.length} viajes, ${lista}. Cada carga tiene su P y su D: colócalas con las flechas.`,
  };
}

/** ¿El error dice que la función no existe (la base no tiene la 157)? PostgREST: `PGRST202`; Postgres: `42883`. */
export function esFuncionAusente(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "PGRST202" || e.code === "42883" || /could not find the function|function .* does not exist/i.test(e.message ?? "");
}

/**
 * Las columnas que una carga nueva NO copia de su madre: son de ESTA fila (id, letra, pallets), de su sitio en la ruta
 * (puesto, recogida, viaje), sus sellos, y lo hecho (recogida, salida, llegada, comprobante, fotos, CSAT). Espejo del
 * `jsonb_build_object` de `partir_carga` (157); una prueba compara las dos listas.
 */
export const COLUMNAS_PROPIAS_DE_LA_CARGA = [
  "id", "order_suffix", "est_pallets", "actual_pallets",
  "route_seq", "pickup_seq", "load_no", "load_auto",
  "created_at", "updated_at", "created_by",
  "pickup_lat", "pickup_lng", "pickup_gps_at", "departed_at", "arrived_at",
  "pod_received_by", "pod_signature", "pod_delivered_at", "pod_lat", "pod_lng", "pod_accuracy",
  "photos", "photo_meta", "delivered_address", "csat_rating", "csat_comment",
  "delivery_notes",
] as const;

/** El total y en qué campo se reparte: el recuento si lo hay (la estimación de ventas se deja como historia, como la 012), si no la estimación. */
const repartoDe = (d: { actual_pallets?: number | null; est_pallets?: number | null }) => ({ contada: d.actual_pallets != null, total: palletsDeLaOrden(d) });

/** La nota que lleva la carga nueva, como la de la partición al recoger (012). */
export const notaDeLaCarga = (etiqueta: string, letraMadre: string, resto: number, total: number) => `Split of #${etiqueta}${letraMadre} at planning: ${resto} of ${total} pallets.`;

/**
 * La carga nueva, en TypeScript (el demo y las pruebas): la madre entera menos `COLUMNAS_PROPIAS_DE_LA_CARGA`, con lo
 * suyo. Es lo que hace `partir_carga` en la base.
 */
export function copiaParaLaCarga(madre: Delivery, a: { id: string; letra: string; resto: number; ahora: string; creador: string | null }): Delivery {
  const { contada, total } = repartoDe(madre);
  const letraMadre = madre.order_suffix ?? "a";
  const copia = { ...madre } as Record<string, unknown>;
  for (const c of COLUMNAS_PROPIAS_DE_LA_CARGA) delete copia[c];
  return {
    ...(copia as unknown as Delivery),
    id: a.id, order_suffix: a.letra, est_pallets: a.resto, actual_pallets: contada ? a.resto : null,
    route_seq: null, pickup_seq: null, load_no: null, load_auto: false,
    created_at: a.ahora, updated_at: a.ahora, created_by: a.creador,
    pickup_lat: null, pickup_lng: null, pickup_gps_at: null, departed_at: null, arrived_at: null,
    pod_received_by: null, pod_signature: null, pod_delivered_at: null, pod_lat: null, pod_lng: null, pod_accuracy: null,
    photos: null, photo_meta: null, delivered_address: null, csat_rating: null, csat_comment: null,
    delivery_notes: [madre.delivery_notes, notaDeLaCarga(madre.order_code || String(madre.order_no), letraMadre, a.resto, total)].filter(Boolean).join("\n"),
  };
}

/** Lo que cambia en la madre al partir: su letra (`a` si nunca se partió) y lo que se queda. `null` si el resto no vale. */
export function madreAlPartir(madre: CargaMinima, resto: number): Partial<Delivery> | null {
  const { contada, total } = repartoDe(madre);
  if (!(total > 0) || !(resto > 0) || centesimas(resto) >= centesimas(total)) return null;
  const queda = (centesimas(total) - centesimas(resto)) / 100;
  return { order_suffix: madre.order_suffix ?? "a", ...(contada ? { actual_pallets: queda } : { est_pallets: queda }) };
}

/** Lo que cambia en cada una al repartir: `a` se queda con `palletsA`, `b` con el resto del total de las dos. `null` si no vale. */
export function alRepartir(a: CargaMinima, b: CargaMinima, palletsA: number): { a: Partial<Delivery>; b: Partial<Delivery> } | null {
  const total = centesimas(palletsDeLaOrden(a)) + centesimas(palletsDeLaOrden(b));
  if (!(palletsA > 0) || centesimas(palletsA) >= total) return null;
  const campo = (d: CargaMinima, n: number): Partial<Delivery> => (d.actual_pallets != null ? { actual_pallets: n } : { est_pallets: n });
  return { a: campo(a, palletsA), b: campo(b, (total - centesimas(palletsA)) / 100) };
}

/** Lo que cambia en `a` al juntarle `b`: suma los pallets de `b`, y pierde la letra si no queda otra hermana. */
export function alJuntar(a: CargaMinima, b: CargaMinima, hermanasQueQuedan: number): Partial<Delivery> {
  const suma = (centesimas(palletsDeLaOrden(a)) + centesimas(palletsDeLaOrden(b))) / 100;
  return { ...(a.actual_pallets != null ? { actual_pallets: suma } : { est_pallets: suma }), order_suffix: hermanasQueQuedan <= 1 ? null : a.order_suffix ?? null };
}
