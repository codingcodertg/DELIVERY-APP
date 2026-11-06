import { COLUMNAS_PROPIAS_DE_LA_CARGA, etapaDeLaFamilia, hermanasDe } from "./cargas-partidas";
import { problemaDeFecha } from "./dia-de-entrega";
import { normalizaLugar } from "./order-endpoints";
import { esPasoDeRelevo, etiquetaDeRelevo, letraDelPaso } from "./relevo-etiqueta";
import { isStoreToStore, type OrderTypeRules } from "./required";
import type { Delivery, NamedLocation } from "./types";

export { esPasoDeRelevo, etiquetaDeRelevo, letraDelPaso, numeroConLetra, PASTILLA_DE_RELEVO, PREFIJO_DE_RELEVO, mensajeDelRelevo, textoDeRelevoParaBuscar } from "./relevo-etiqueta";

/**
 * TRANSFERENCIA POR RELEVO de una orden tienda-a-tienda (D-898, migración 256).
 *
 * El dueño, 2026-11-05: una intertienda va de McAllen a Brownsville; Julio la lleva de McAllen a Weslaco y, más tarde, Max
 * de Weslaco a Brownsville. Quien planifica las rutas elige la tienda de relevo y el día en que se recoge el segundo paso
 * (el mismo día o cualquier día futuro). Los pasos se llaman «Tr-1111-a» y «Tr-1111-b» y llevan una pastilla propia.
 *
 * EL MODELO: se monta sobre las CARGAS HERMANAS de D-452 (migración 157), no al lado. Cada paso es una fila de
 * `deliveries` con la misma `order_no` y `order_code` y su letra en `order_suffix`; por eso cada paso tiene su chofer, su
 * día, su puesto en la ruta, su recogida, su entrega, su comprobante y su historial sin que ningún lector de la ruta
 * cambie. Lo único nuevo es `relay_step` (1, 2…): con él es un paso de relevo («Tr-1111-a»), sin él una carga partida de
 * las de siempre («1111a»). La familia se lee igual (`hermanasDe`, `etapaDeLaFamilia`): «la orden» está entregada cuando
 * lo está su último paso.
 *
 * Diferencias con una carga partida, todas aquí:
 *   · los pasos van EN SERIE (una carga partida va en paralelo): el paso b sale de donde el a llega, y no se puede recoger
 *     antes de que el a esté entregado en la tienda de relevo (`porQueNoSeRecoge`; la base lo exige con un disparador);
 *   · cada paso lleva TODOS los pallets (no se reparten);
 *   · un paso de relevo no se parte, ni se reparte, ni se junta con ✂ ✎ ⤵: se deshace entero con «Deshacer el relevo».
 *
 * La base hace lo mismo en `activar_relevo` / `deshacer_relevo` (256); esto es la regla sin pantalla, y lo que usa el demo.
 * El dato admite más de dos pasos (c, d): `relay_step` es un número y todo aquí recorre la cadena; la pantalla solo crea dos.
 */

type Minima = Pick<Delivery, "id" | "order_no"> & {
  order_suffix?: string | null; relay_step?: number | null; is_training?: boolean; stage?: string;
  assigned_driver?: string | null; delivery_date?: string | null; route_seq?: number | null; pickup_seq?: number | null;
  pickup_name?: string | null; delivery_name?: string | null;
};

/** Las etapas en las que se puede ACTIVAR: ya aprobada y aún sin recoger. (Una pendiente se aprueba antes: el paso b nace
 *  listo para recoger y no pasa por aprobación.) */
export const ETAPAS_PARA_ACTIVAR_RELEVO: readonly string[] = ["approved", "fulfilling", "ready"];
/** Las etapas en las que un paso ya salió: desde aquí el relevo no se deshace. */
const YA_SALIO = new Set(["picked_up", "delivered"]);

/** Los pasos del relevo al que pertenece `d`, en orden (a, b…). Vacío si `d` no es de un relevo. */
export function pasosDelRelevo<T extends Minima>(todas: readonly T[], d: Pick<Minima, "order_no" | "is_training" | "relay_step">): T[] {
  if (!esPasoDeRelevo(d)) return [];
  return hermanasDe(todas, d).filter(esPasoDeRelevo).sort((a, b) => (a.relay_step ?? 0) - (b.relay_step ?? 0));
}

/** El paso anterior de la cadena, si está a la vista. (Un chofer no ve el paso de otro chofer: entonces decide la base.) */
export function pasoAnterior<T extends Minima>(todas: readonly T[], d: Minima): T | null {
  if (!esPasoDeRelevo(d) || (d.relay_step ?? 0) <= 1) return null;
  return pasosDelRelevo(todas, d).find((x) => x.relay_step === (d.relay_step ?? 0) - 1) ?? null;
}

export type Bilingue = { en: string; es: string };
const rotulo = (d: Pick<Delivery, "order_no"> & { order_code?: string | null; relay_step?: number | null; order_suffix?: string | null }) =>
  etiquetaDeRelevo(d.order_code || d.order_no, d.order_suffix ?? letraDelPaso(d.relay_step ?? 1));

/** El mensaje del bloqueo, con el nombre del paso que falta y dónde. */
export function mensajeDeEspera(anterior: Pick<Delivery, "order_no"> & { order_code?: string | null; relay_step?: number | null; order_suffix?: string | null; delivery_name?: string | null }): Bilingue {
  const donde = (anterior.delivery_name ?? "").trim();
  return {
    en: `Not yet: transfer step ${rotulo(anterior)} has not been delivered${donde ? ` at ${donde}` : ""}. This step can only be picked up after that.`,
    es: `Todavía no: el paso ${rotulo(anterior)} de la transferencia no se ha entregado${donde ? ` en ${donde}` : ""}. Este paso solo se puede recoger después.`,
  };
}

/**
 * LA REGLA DEL ORDEN: un paso b (c, d…) no se recoge —ni se da por entregado— hasta que el paso anterior esté ENTREGADO en
 * la tienda de relevo. `null` = se puede (o no es un relevo, o es el primer paso, o el anterior no está a la vista y lo
 * decide la base). Vale para todos los roles: no es un permiso, es que la mercancía todavía no está ahí.
 */
export function porQueNoSeRecoge<T extends Minima & Pick<Delivery, "order_no"> & { order_code?: string | null }>(d: T, todas: readonly T[]): Bilingue | null {
  const anterior = pasoAnterior(todas, d);
  if (!anterior || anterior.stage === "delivered") return null;
  return mensajeDeEspera(anterior);
}

/** ¿Esta escritura mete el paso en recogido/entregado viniendo de una etapa anterior? Es lo que la regla del orden frena. */
export const entraEnElCamion = (antes: string | null | undefined, despues: string | null | undefined): boolean =>
  !!despues && YA_SALIO.has(despues) && !YA_SALIO.has(antes ?? "");

// ---- Activar ---------------------------------------------------------------------------------------------------------

export type PorQueNoSeActiva = "ya_es_relevo" | "partida" | "etapa" | "no_es_tienda_a_tienda" | "sin_tiendas";

const tiendaDe = (nombre: string | null | undefined, tiendas: readonly NamedLocation[]) => {
  const n = normalizaLugar(nombre);
  return n ? tiendas.find((t) => normalizaLugar(t.name) === n) ?? null : null;
};

/**
 * ¿Se puede activar un relevo en esta orden? `null` = sí. Tiene que ser de tienda a tienda (una Intertienda o un
 * Transfer: su destino es una tienda de Ajustes), estar aprobada y sin recoger, y no estar partida en cargas.
 */
export function porQueNoSeActiva(d: Delivery, hermanas: readonly Minima[], tiendas: readonly NamedLocation[], reglas?: OrderTypeRules): PorQueNoSeActiva | null {
  if (esPasoDeRelevo(d)) return "ya_es_relevo";
  if (d.order_suffix || hermanas.some((h) => h.id !== d.id)) return "partida";
  if (!ETAPAS_PARA_ACTIVAR_RELEVO.includes(d.stage)) return "etapa";
  if (!isStoreToStore(d.order_type, reglas)) return "no_es_tienda_a_tienda";
  // El DESTINO tiene que ser una tienda de Ajustes. La recogida no se exige por nombre: en una orden de tienda a tienda
  // sale de «Vendido desde», pero su nombre puede ser el del almacén de esa tienda.
  if (!tiendaDe(d.delivery_name, tiendas)) return "sin_tiendas";
  return null;
}

export const TEXTO_NO_SE_ACTIVA: Record<PorQueNoSeActiva, Bilingue> = {
  ya_es_relevo: { en: "This order already is a relay transfer.", es: "Esta orden ya es una transferencia por relevo." },
  partida: { en: "This order is split into loads: join them before setting up a relay.", es: "Esta orden está partida en cargas: júntalas antes de activar un relevo." },
  etapa: { en: "A relay is set up on an approved order that has not been picked up yet.", es: "El relevo se activa en una orden aprobada que todavía no se ha recogido." },
  no_es_tienda_a_tienda: { en: "A relay transfer is only for store-to-store orders.", es: "La transferencia por relevo es solo para órdenes de tienda a tienda." },
  sin_tiendas: { en: "The destination must be a store from Settings.", es: "El destino tiene que ser una tienda de Ajustes." },
};

/** Las tiendas que se ofrecen como relevo: las de Ajustes, menos el origen y el destino. */
export function tiendasDeRelevo(d: Pick<Delivery, "pickup_name" | "delivery_name" | "store">, tiendas: readonly NamedLocation[]): NamedLocation[] {
  const fuera = new Set([d.pickup_name, d.delivery_name, d.store].map(normalizaLugar).filter(Boolean));
  return tiendas.filter((t) => normalizaLugar(t.name) && !fuera.has(normalizaLugar(t.name)));
}

/** El primer día que vale para el paso b: hoy, o el día del paso a si es posterior. Por defecto, ese mismo. */
export function primerDiaDelPasoB(diaDelPasoA: string | null | undefined, hoy: string): string {
  const a = (diaDelPasoA ?? "").slice(0, 10);
  return a && a > hoy ? a : hoy;
}

export type ProblemaDelDia = "falta" | "antes" | "domingo" | "imposible";
/** ¿Vale ese día para recoger el paso b? El mismo día que el a o cualquiera posterior; nunca en el pasado; nunca domingo. */
export function problemaDelDiaDelPasoB(fecha: string | null | undefined, diaDelPasoA: string | null | undefined, hoy: string): ProblemaDelDia | null {
  const f = (fecha ?? "").trim();
  if (!f) return "falta";
  const p = problemaDeFecha(f, { hoy });
  if (p === "fecha_imposible") return "imposible";
  if (f < primerDiaDelPasoB(diaDelPasoA, hoy)) return "antes";
  if (p) return "domingo";
  return null;
}
export const TEXTO_DEL_DIA: Record<ProblemaDelDia, Bilingue> = {
  falta: { en: "Pick the pickup day for step b.", es: "Elige el día de recogida del paso b." },
  antes: { en: "Step b can't be picked up before today or before step a's day.", es: "El paso b no se puede recoger antes de hoy ni antes del día del paso a." },
  domingo: { en: "That day is a Sunday: pick another day.", es: "Ese día es domingo: elige otro." },
  imposible: { en: "That date is not valid.", es: "Esa fecha no es válida." },
};

/**
 * Lo que se escribe al activar, en TypeScript (el demo y las pruebas); `activar_relevo` (256) hace lo mismo en la base.
 *   · la madre pasa a ser el PASO A: letra `a`, `relay_step` 1, y su destino es la tienda de relevo;
 *   · nace el PASO B: copia de la madre (lo mismo que copia una carga partida, `COLUMNAS_PROPIAS_DE_LA_CARGA`), con TODOS
 *     los pallets, recogida en la tienda de relevo, el destino final de la madre, su día, sin chofer, en «lista». La tarifa
 *     se queda solo en el paso a, para que ningún total la sume dos veces.
 * `null` si la tienda no vale.
 */
export function alActivar(madre: Delivery, tienda: NamedLocation, fecha: string, a: { id: string; ahora: string; creador: string | null }): { madre: Partial<Delivery>; paso: Delivery } | null {
  const fuera = [madre.pickup_name, madre.delivery_name, madre.store].map(normalizaLugar);
  if (!normalizaLugar(tienda.name) || fuera.includes(normalizaLugar(tienda.name))) return null;
  const punto = tienda.lat != null && tienda.lng != null ? { lat: tienda.lat, lng: tienda.lng } : null;
  const copia = { ...madre } as Record<string, unknown>;
  for (const c of COLUMNAS_PROPIAS_DE_LA_CARGA) delete copia[c];
  const etiqueta = madre.order_code || String(madre.order_no);
  const paso: Delivery = {
    ...(copia as unknown as Delivery),
    id: a.id, order_suffix: "b", relay_step: 2, stage: "ready",
    est_pallets: madre.est_pallets, actual_pallets: madre.actual_pallets,
    pickup_name: tienda.name, pickup_address: tienda.address, pickup_point_lat: null, pickup_point_lng: null,
    delivery_date: fecha, assigned_driver: null, delivery_fee: null, morning_priority: false,
    route_seq: null, pickup_seq: null, load_no: null, load_auto: false,
    route_miles: null, route_duration: null, route_provider: null, route_traffic: null,
    created_at: a.ahora, updated_at: a.ahora, created_by: a.creador,
    pickup_lat: null, pickup_lng: null, pickup_gps_at: null, departed_at: null, arrived_at: null,
    pod_received_by: null, pod_signature: null, pod_delivered_at: null, pod_lat: null, pod_lng: null, pod_accuracy: null,
    photos: null, photo_meta: null, delivered_address: null, csat_rating: null, csat_comment: null,
    delivery_notes: [madre.delivery_notes, notaDelPaso(etiqueta, "b", tienda.name, madre.delivery_name)].filter(Boolean).join("\n"),
  };
  return {
    madre: {
      order_suffix: "a", relay_step: 1,
      delivery_name: tienda.name, delivery_address: tienda.address,
      delivery_lat: punto?.lat ?? null, delivery_lng: punto?.lng ?? null, delivery_pin_source: punto ? "geocoded" : null,
      route_miles: null, route_duration: null, route_provider: null, route_traffic: null,
    },
    paso,
  };
}

/** La nota que lleva el paso nuevo (como la de una carga partida). */
export const notaDelPaso = (etiqueta: string, letra: string, desde: string | null | undefined, hasta: string | null | undefined) =>
  `Relay transfer ${etiquetaDeRelevo(etiqueta, letra)}: ${desde ?? "?"} → ${hasta ?? "?"}.`;

// ---- Deshacer --------------------------------------------------------------------------------------------------------

/** ¿Se puede deshacer el relevo? Mientras el paso a no se haya recogido (y, claro, ningún paso posterior haya salido). */
export function sePuedeDeshacer(pasos: readonly Minima[]): boolean {
  return pasos.length >= 2 && pasos.every((p) => !YA_SALIO.has(p.stage ?? ""));
}

/**
 * Lo que se escribe al deshacer: el paso a vuelve a ser la orden entera —sin letra, sin `relay_step`, con el destino
 * FINAL, que es el del último paso— y los demás pasos se borran. `null` si no se puede.
 */
export function alDeshacer(pasos: readonly Delivery[]): { id: string; cambio: Partial<Delivery>; borrar: string[] } | null {
  if (!sePuedeDeshacer(pasos)) return null;
  const [a, ...resto] = pasos;
  const ultimo = resto[resto.length - 1];
  return {
    id: a.id,
    cambio: {
      order_suffix: null, relay_step: null,
      delivery_name: ultimo.delivery_name, delivery_address: ultimo.delivery_address,
      delivery_lat: ultimo.delivery_lat, delivery_lng: ultimo.delivery_lng, delivery_pin_source: ultimo.delivery_pin_source,
      route_miles: null, route_duration: null, route_provider: null, route_traffic: null,
    },
    borrar: resto.map((p) => p.id),
  };
}

// ---- El estado de «la orden» -----------------------------------------------------------------------------------------

export type EstadoDelRelevo = {
  /** La etapa de la orden ENTERA: entregada solo cuando el último paso lo está (`etapaDeLaFamilia`, la de las cargas). */
  etapa: "entregada" | "en_reparto" | "pendiente";
  /** Cuántos pasos están entregados, y cuántos hay (sin contar anulados). */
  entregados: number;
  de: number;
};

export function estadoDelRelevo(pasos: readonly { stage?: string }[]): EstadoDelRelevo {
  const vivos = pasos.filter((p) => p.stage !== "canceled" && p.stage !== "rejected");
  return { etapa: etapaDeLaFamilia(pasos), entregados: vivos.filter((p) => p.stage === "delivered").length, de: vivos.length };
}

export function textoDelEstado(e: EstadoDelRelevo, es: boolean): string {
  if (e.etapa === "entregada") return es ? "Orden entregada: todos los pasos llegaron" : "Order delivered: every step arrived";
  if (e.etapa === "en_reparto") return es ? `En tránsito: ${e.entregados} de ${e.de} pasos entregados` : `In transit: ${e.entregados} of ${e.de} steps delivered`;
  return es ? `Pendiente: ${e.entregados} de ${e.de} pasos entregados` : `Pending: ${e.entregados} of ${e.de} steps delivered`;
}

/** Lo que la tarjeta enseña de cada paso. Lo devuelve `pasos_del_relevo` (256) o, sin ella, sale de las filas a la vista. */
export interface PasoParaVer {
  id: string;
  relay_step: number;
  order_suffix: string | null;
  stage: string;
  assigned_driver: string | null;
  delivery_date: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
  /** Quién y cuándo lo recogió y lo entregó (del historial). */
  picked_up_by?: string | null;
  picked_up_at?: string | null;
  delivered_by?: string | null;
  delivered_at?: string | null;
}

type Evento = { delivery_id: string; kind: string; created_by: string | null; created_at: string };

/** Los pasos para la tarjeta, de las filas y los eventos que esta persona ya tiene a la vista. */
export function pasosParaVer(pasos: readonly Delivery[], eventos: readonly Evento[], nombreDe: (id: string | null) => string | null): PasoParaVer[] {
  const ultimo = (id: string, kind: string) => eventos.filter((e) => e.delivery_id === id && e.kind === kind).sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
  return pasos.map((p) => {
    const rec = YA_SALIO.has(p.stage) ? ultimo(p.id, "picked_up") : undefined;
    const ent = p.stage === "delivered" ? ultimo(p.id, "delivered") : undefined;
    return {
      id: p.id, relay_step: p.relay_step ?? 0, order_suffix: p.order_suffix, stage: p.stage, assigned_driver: p.assigned_driver,
      delivery_date: p.delivery_date, pickup_name: p.pickup_name, delivery_name: p.delivery_name,
      picked_up_by: rec ? nombreDe(rec.created_by) : null, picked_up_at: rec?.created_at ?? p.pickup_gps_at ?? null,
      delivered_by: ent ? nombreDe(ent.created_by) : null, delivered_at: p.stage === "delivered" ? (p.pod_delivered_at ?? ent?.created_at ?? null) : null,
    };
  });
}

// ---- Avisos al planificar --------------------------------------------------------------------------------------------

export type AvisoDeRelevo = { tipo: "b_antes_que_a" | "mismo_chofer_al_reves" | "mismo_chofer_sin_orden" | "mismo_dia_otra_ruta"; ids: [string, string] } & Bilingue;

/**
 * Lo que el Gestor avisa de los relevos de un conjunto de órdenes (D-898). Por cada par de pasos seguidos sin terminar:
 *   · el paso b está agendado un día ANTERIOR al del a;
 *   · los dos van el mismo día con el MISMO chofer y la recogida del b está antes que la entrega del a en su lista (o
 *     todavía no tienen puesto en la lista, y entonces no se sabe);
 *   · los dos van el mismo día en rutas DISTINTAS: el motor de rutas ordena cada ruta por su cuenta y NO garantiza que la
 *     recogida del b caiga después de la entrega del a; se avisa para que quien planifica lo mire (y la base no dejará
 *     recoger el b antes de tiempo).
 */
export function avisosDeRelevo<T extends Minima & { order_code?: string | null }>(todas: readonly T[]): AvisoDeRelevo[] {
  const avisos: AvisoDeRelevo[] = [];
  const vistos = new Set<string>();
  for (const d of todas) {
    if (!esPasoDeRelevo(d) || (d.relay_step ?? 0) <= 1) continue;
    const a = pasoAnterior(todas, d);
    if (!a || vistos.has(d.id) || YA_SALIO.has(d.stage ?? "") || a.stage === "delivered" || d.stage === "canceled" || a.stage === "canceled") continue;
    vistos.add(d.id);
    const na = rotulo(a), nb = rotulo(d);
    const diaA = (a.delivery_date ?? "").slice(0, 10), diaB = (d.delivery_date ?? "").slice(0, 10);
    const ids: [string, string] = [a.id, d.id];
    if (diaA && diaB && diaB < diaA) {
      avisos.push({ tipo: "b_antes_que_a", ids, en: `${nb} is scheduled for ${diaB}, before ${na} (${diaA}): it can't be picked up until ${na} is delivered.`, es: `${nb} está agendado el ${diaB}, antes que ${na} (${diaA}): no se puede recoger hasta que ${na} esté entregado.` });
      continue;
    }
    if (!diaA || diaA !== diaB) continue;
    const ca = (a.assigned_driver ?? "").trim(), cb = (d.assigned_driver ?? "").trim();
    if (!ca || !cb) continue;
    if (ca === cb) {
      if (a.route_seq == null || d.pickup_seq == null) {
        avisos.push({ tipo: "mismo_chofer_sin_orden", ids, en: `${cb} carries ${na} and ${nb} the same day: place the pickup of ${nb} after the drop of ${na} in the route.`, es: `${cb} lleva ${na} y ${nb} el mismo día: coloca la recogida de ${nb} después de la entrega de ${na} en la ruta.` });
      } else if (d.pickup_seq < a.route_seq) {
        avisos.push({ tipo: "mismo_chofer_al_reves", ids, en: `${cb}: the pickup of ${nb} is placed before the drop of ${na}. Move it after.`, es: `${cb}: la recogida de ${nb} está antes que la entrega de ${na}. Muévela después.` });
      }
      continue;
    }
    avisos.push({ tipo: "mismo_dia_otra_ruta", ids, en: `${na} (${ca}) and ${nb} (${cb}) run the same day on different routes: make sure ${cb} reaches ${a.delivery_name ?? "the relay store"} after ${ca} drops it. The route optimizer does not order one route after another.`, es: `${na} (${ca}) y ${nb} (${cb}) van el mismo día en rutas distintas: asegúrate de que ${cb} llegue a ${a.delivery_name ?? "la tienda de relevo"} después de que ${ca} lo deje. El optimizador no ordena una ruta respecto de otra.` });
  }
  return avisos;
}

/**
 * Lo que el aviso de un cambio de etapa necesita saber de un paso de relevo (lib/notifications): cómo se llama
 * («#Tr-1111-a») y si después de él todavía quedan pasos —entonces «entregado» NO es que la orden llegó—. Vacío si no es
 * un relevo: el aviso sale como siempre.
 */
export function relevoParaElAviso<T extends Minima & { order_code?: string | null }>(d: T, todas: readonly T[]): { etiqueta?: string; faltanPasos?: boolean } {
  if (!esPasoDeRelevo(d)) return {};
  const pasos = pasosDelRelevo(todas, d);
  // Un chofer puede no ver los demás pasos: el primero siempre tiene otro detrás.
  const faltan = pasos.some((p) => (p.relay_step ?? 0) > (d.relay_step ?? 0)) || d.relay_step === 1;
  return { etiqueta: `#${rotulo(d)}`, faltanPasos: faltan };
}

/** Quién puede activar y deshacer: quien planifica rutas (`route_plan`: admin y logística por su rol, o a quien se le dio). */
export { canPlanRoutes as puedeGestionarRelevo } from "./constants";
