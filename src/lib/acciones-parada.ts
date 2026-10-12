import type { OrderEvent } from "@/lib/types";
import type { NotifSeed } from "@/lib/notifications";
import { isoInTZ } from "@/lib/utils";
import { KIND_RECIBIDA } from "@/lib/recibir";
import { EVENTO_DEJADO } from "@/lib/leave-at-store";

// ============================================================
// Botones por parada en «Mi ruta» (D-487, D-495; D-NEXT): Llegué · Recogido en cada recogida; Llegué · Entregado ·
// Rechazado en cada entrega.
//
// El dueño, 2026-10-06: «quiero que ahí salga un por cada carga, cada pickup y los deliveries también que diga pickup
// […] deliver, skip y en los deliveries puede ser hasta rejected y él tiene que poner una razón».
//
// **D-NEXT (2026-10-11), «remove the skip buittom in driver view · arrived and pickup buttom to be added»:** fuera
// «Saltar». Ya no se escriben saltos y los que hubiera **dejan de contar**: la parada vuelve a su sitio de siempre y nadie
// tiene que «retomarla». Los eventos `skipped`/`resumed` viejos siguen en el historial de la orden, con su nombre. Entra
// «📍 Llegué», por PARADA (la tienda donde se recoge, la dirección donde se entrega), que deja un evento de llegada.
//
// «Recogido» y «Entregado» ya existían (D-218, `one-tap-stop.ts`) y se reúsan tal cual. Rechazado y Llegué **no
// cambian la etapa**:
//
//  - **Rechazado**: el cliente no aceptó la entrega. Evento `customer_rejected` con la razón en la nota, OBLIGATORIA.
//    La orden se queda en `picked_up` —el material sigue en el camión— y el chofer la descarga con «Dejar en tienda»
//    (D-224), que ya existía. La marca sigue visible para logística en Órdenes y en el Gestor hasta que la orden se
//    vuelva a recoger o se entregue.
//  - **Llegué** (D-NEXT): evento `arrived_pickup` (en la tienda) o `arrived_delivery` (con el cliente). Vale el día en
//    que se hizo y para ESE tramo: dejar la orden en una tienda o volver a recogerla lo borra.
//
// Por qué eventos y no una etapa o columna: es el mismo camino de «Received» (D-409, `recibir.ts`). `order_events.kind`
// es texto libre, el chofer ya puede insertar sus propios eventos (100: `created_by = auth.uid()`), y la lista ya los
// carga para todos los roles. Cero migraciones, y el guard de etapas (`guard_delivery_stage`) ni se entera. La columna
// `arrived_at` que escribe la ficha NO le sirve al chofer: el guard (157) solo le deja cambiar, sin cambiar de etapa, las
// coordenadas de una parada ya cerrada, así que escribirla le contesta «You cannot edit an order in the picked_up stage».
//
// Puro: sin React, sin red.
// ============================================================

/** Históricos (D-487): ya no se escriben desde D-NEXT. Siguen aquí para nombrarlos en el historial. */
export const KIND_SALTADA = "skipped";
export const KIND_RETOMADA = "resumed";
export const KIND_RECHAZADA = "customer_rejected";
/** «📍 Llegué» (D-NEXT): a la tienda a recoger, o con el cliente a entregar. */
export const KIND_LLEGO_A_RECOGER = "arrived_pickup";
export const KIND_LLEGO_A_ENTREGAR = "arrived_delivery";

/** La marca vigente de una parada. Desde D-NEXT solo existe el rechazo: el salto se fue con su botón. */
export type MarcaDeParada = { marca: "rechazada"; at: string; motivo: string | null };

/** Lo que borra la marca de rechazo: la orden volvió a salir o se cerró. */
const CIERRAN_RECHAZO = new Set<string>(["picked_up", "delivered", KIND_RECIBIDA, "canceled"]);

type EventoDeParada = Pick<OrderEvent, "delivery_id" | "kind" | "created_at" | "note">;

/** Los eventos de cada orden, del más viejo al más nuevo (el proveedor los tiene al revés). Sin las notas. */
function porOrdenEnOrden(events: readonly EventoDeParada[]): Map<string, EventoDeParada[]> {
  const porOrden = new Map<string, EventoDeParada[]>();
  for (const e of events) {
    if (e.kind === "note") continue;
    const l = porOrden.get(e.delivery_id);
    if (l) l.push(e); else porOrden.set(e.delivery_id, [e]);
  }
  for (const l of porOrden.values()) l.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return porOrden;
}

/**
 * La marca vigente de cada orden, leída de su historial. Se calcula una vez por lista de eventos.
 *
 * Desde D-NEXT solo el rechazo, que no caduca con el día. El segundo parámetro (`hoy`) era para que un salto valiera solo
 * su día; se acepta y se ignora, porque la llaman el servidor, Órdenes, el Gestor, la ficha y «Mi ruta».
 */
export function marcasDeParadas(events: readonly EventoDeParada[], _hoy?: string): Map<string, MarcaDeParada> {
  const out = new Map<string, MarcaDeParada>();
  for (const [id, enOrden] of porOrdenEnOrden(events)) {
    let rechazo: MarcaDeParada | null = null;
    for (const e of enOrden) {
      if (CIERRAN_RECHAZO.has(e.kind)) rechazo = null;
      if (e.kind === KIND_RECHAZADA) rechazo = { marca: "rechazada", at: e.created_at, motivo: e.note };
    }
    if (rechazo) out.set(id, rechazo);
  }
  return out;
}

// ---- «📍 Llegué» (D-NEXT) ----------------------------------------------------

/** Cuándo llegó el chofer a la tienda (`recoger`) o con el cliente (`entregar`), si llegó, en el tramo de ahora. */
export interface LlegadaDeOrden { recoger?: string; entregar?: string }

/**
 * Las llegadas vigentes de cada orden. Una llegada vale **el día en que se hizo** (zona del negocio) y **su tramo**:
 * «Dejar en tienda» y anularla borran las dos (la orden vuelve a empezar), y recogerla borra la de entregar (empieza un
 * tramo nuevo hacia el cliente). Que el almacén la marque lista NO la borra: es justo el chofer que llegó y espera.
 */
export function llegadasDeParadas(events: readonly EventoDeParada[], hoy: string): Map<string, LlegadaDeOrden> {
  const out = new Map<string, LlegadaDeOrden>();
  for (const [id, enOrden] of porOrdenEnOrden(events)) {
    let l: LlegadaDeOrden = {};
    for (const e of enOrden) {
      if (e.kind === EVENTO_DEJADO || e.kind === "canceled") l = {};
      if (e.kind === "picked_up") l = { recoger: l.recoger };
      if (e.kind !== KIND_LLEGO_A_RECOGER && e.kind !== KIND_LLEGO_A_ENTREGAR) continue;
      if (isoInTZ(new Date(e.created_at)) !== hoy) continue;
      l = e.kind === KIND_LLEGO_A_RECOGER ? { ...l, recoger: e.created_at } : { ...l, entregar: e.created_at };
    }
    if (l.recoger || l.entregar) out.set(id, l);
  }
  return out;
}

/**
 * «📍 Llegué» de una PARADA: la tienda donde se recoge o la dirección donde se entrega —varias órdenes seguidas en el
 * mismo sitio son una parada (D-485/D-515)—, así que se pulsa una vez y vale para todas las suyas que estén en ese tramo:
 *
 *  - recogida: las que aún no se recogieron, **también las que el almacén no tiene listas** (el chofer llega y espera);
 *  - entrega: las que van en el camión (`picked_up`). Antes de cargarla no se llega a entregar nada.
 *
 * Las rechazadas por el cliente no cuentan (ya llegó, y lo que toca es «Dejar en tienda»). `null`: no hay nada a lo que
 * llegar —todo hecho, o nada cargado—. `hecha`: alguna ya tiene su llegada; `at` es la primera.
 */
export type LlegadaDeParada =
  | { estado: "hecha"; at: string }
  | { estado: "pendiente"; tipo: "P" | "D"; ordenes: string[] };

const YA_RECOGIDA = new Set<string>(["picked_up", "delivered", "canceled"]);

export function llegadaDeLaParada(
  parada: { tipo: "P" | "D"; ordenes: readonly string[] },
  etapaDe: (id: string) => string | null | undefined,
  marcas: ReadonlyMap<string, MarcaDeParada>,
  llegadas: ReadonlyMap<string, LlegadaDeOrden>,
): LlegadaDeParada | null {
  const enTramo = parada.ordenes.filter((id) => {
    const etapa = etapaDe(id);
    if (etapa == null || marcas.has(id)) return false;
    return parada.tipo === "P" ? !YA_RECOGIDA.has(etapa) : etapa === "picked_up";
  });
  if (enTramo.length === 0) return null;
  const horas = enTramo
    .map((id) => (parada.tipo === "P" ? llegadas.get(id)?.recoger : llegadas.get(id)?.entregar))
    .filter((x): x is string => !!x)
    .sort();
  return horas.length ? { estado: "hecha", at: horas[0] } : { estado: "pendiente", tipo: parada.tipo, ordenes: enTramo };
}

/** El evento que deja «Llegué» en cada orden de la parada. */
export const kindDeLlegada = (tipo: "P" | "D"): string => (tipo === "P" ? KIND_LLEGO_A_RECOGER : KIND_LLEGO_A_ENTREGAR);

// ---- Los botones de cada orden de la parada ---------------------------------

export type AccionDeParada = "recoger" | "entregar" | "rechazar" | "dejar";

/** Un botón de la parada. `apagado`: se ve pero no se pulsa, y el motivo se dice a la vista (en un teléfono no hay
 *  `title` que leer). */
export interface BotonDeParada {
  accion: AccionDeParada;
  apagado: { en: string; es: string } | null;
}

/** Por qué «Recogido» sale apagado. El guard de la base (157) solo deja al chofer pasar de `ready` a `picked_up`. */
export const NO_ESTA_LISTA = { en: "The warehouse doesn't have it ready yet", es: "El almacén aún no la tiene lista" } as const;

/**
 * Qué botones lleva cada orden de una parada (además de «Llegué», que es de la parada entera: `llegadaDeLaParada`). `tipo`
 * es la letra de la fila (P recogida, D entrega). Es lo único que decide la pantalla: lo que no sale de aquí no se pinta.
 *
 *  - Hecha (recogida ya en el camión, o entregada) o anulada: nada.
 *  - Rechazada: solo «Dejar en tienda» —y en la entrega, que es donde vive el material—.
 *  - Recogida: «Recogido». Si el almacén aún no la tiene lista (`approved`, `fulfilling`…) sale **a la vista y apagado**,
 *    con el motivo (D-NEXT; antes solo salía «Saltar»).
 *  - Entrega: con el material en el camión (`picked_up`), «Entregado» y «Rechazado» (D-495). Antes de recogerla, nada:
 *    entregar o rechazar algo que no se ha cargado no existe.
 *
 * D-NEXT quitó «Saltar» y «Retomar». El dueño, 2026-10-11: «remove the skip buittom in driver view».
 */
export function accionesDeParada(tipo: "P" | "D", etapa: string | null | undefined, marca: MarcaDeParada | null | undefined): BotonDeParada[] {
  const boton = (accion: AccionDeParada, apagado: BotonDeParada["apagado"] = null): BotonDeParada => ({ accion, apagado });
  if (etapa === "delivered" || etapa === "canceled") return [];
  if (marca?.marca === "rechazada") return tipo === "D" && etapa === "picked_up" ? [boton("dejar")] : [];
  if (tipo === "P") {
    if (etapa === "picked_up") return [];
    return [boton("recoger", etapa === "ready" ? null : NO_ESTA_LISTA)];
  }
  // Ya en el camión no se salta (D-495). El dueño, 2026-10-07: «si aceptas una delivery no puedes skipped it solo delivered
  // or rejected».
  if (etapa === "picked_up") return [boton("entregar"), boton("rechazar")];
  return [];
}

// ---- Rechazo: la razón es obligatoria ---------------------------------------

export interface MotivoRapido { clave: string; en: string; es: string }

/** Motivos de un toque. «Otro» obliga a escribir. */
export const MOTIVOS_DE_RECHAZO: readonly MotivoRapido[] = [
  { clave: "damaged", en: "Damaged material", es: "Material dañado" },
  { clave: "wrong", en: "Wrong material", es: "Material equivocado" },
  { clave: "site", en: "Site not ready", es: "La obra no estaba lista" },
  { clave: "changed", en: "Customer changed their mind", es: "El cliente cambió de opinión" },
  { clave: "other", en: "Other", es: "Otro" },
];

/** Lo mínimo que se acepta como razón escrita: tres letras, para que «.» o «x» no pasen por razón. */
export const MINIMO_TEXTO_RECHAZO = 3;

/**
 * La razón que se guarda, o `null` si no hay razón suficiente (el botón de confirmar queda apagado).
 * Un motivo rápido basta salvo «Otro», que exige texto. Con texto, va detrás del motivo.
 */
export function razonDeRechazo(clave: string | null | undefined, texto: string | null | undefined, lang: "en" | "es"): string | null {
  const escrito = (texto ?? "").trim().replace(/\s+/g, " ");
  const rapido = MOTIVOS_DE_RECHAZO.find((m) => m.clave === clave) ?? null;
  const textoValido = escrito.length >= MINIMO_TEXTO_RECHAZO;
  if (!rapido || rapido.clave === "other") return textoValido ? escrito : null;
  const nombre = lang === "es" ? rapido.es : rapido.en;
  return textoValido ? `${nombre} — ${escrito}` : nombre;
}

/** La nota del evento: la razón, con el prefijo que la hace legible en el historial y en Auditoría. */
export function notaDeRechazo(razon: string, lang: "en" | "es"): string {
  return `${lang === "es" ? "Rechazada por el cliente" : "Rejected by customer"}: ${razon}`;
}

// ---- Rechazo: qué se hace con el material (D-495) ----------------------------
//
// El dueño, 2026-10-07: «al ser rejecte te pregunta que paso y donde las vas a dejar o si la dejaras de vuetla». El material
// sigue en el camión: el chofer dice si lo REGRESA a la tienda de donde salió o lo DEJA en otra tienda, y el rechazo se
// guarda junto con ese «Dejar en tienda» (D-224), que es lo que lo devuelve a la lista con su nuevo origen.

/** A dónde va el material rechazado: de vuelta a su tienda de origen, o a otra tienda. */
export type DestinoDelRechazo = { tipo: "origen" } | { tipo: "tienda"; nombre: string };

/** La tienda donde queda, o `null` si aún no se eligió o no existe. «Origen» es `store` del pedido. */
export function tiendaDelRechazo<T extends { name: string }>(
  destino: DestinoDelRechazo | null, origen: string | null | undefined, tiendas: readonly T[],
): T | null {
  if (!destino) return null;
  const buscada = (destino.tipo === "origen" ? origen ?? "" : destino.nombre).trim().toLowerCase();
  if (!buscada) return null;
  return tiendas.find((s) => s.name.trim().toLowerCase() === buscada) ?? null;
}

/** La línea que se añade a la nota del rechazo: qué se hizo con el material. */
export function notaDelDestino(destino: DestinoDelRechazo, tienda: string, lang: "en" | "es"): string {
  if (destino.tipo === "origen") return lang === "es" ? `Lo regresa a ${tienda}` : `Taking it back to ${tienda}`;
  return lang === "es" ? `Lo deja en ${tienda}` : `Leaving it at ${tienda}`;
}

/** La razón tal como se guardó, sin el prefijo de `notaDeRechazo` (para la pastilla). */
export function razonDeLaNota(nota: string | null | undefined): string {
  if (!nota) return "";
  const i = nota.indexOf(": ");
  return i >= 0 ? nota.slice(i + 2) : nota;
}

/** Aviso en la campana a logística y administración: un rechazo es trabajo para ellos (volver a programar). */
export function avisosDeRechazo(args: {
  users: readonly { id: string; role: string }[];
  actorId: string | null | undefined;
  delivery_id: string;
  order_no: number | null;
  etiqueta: string;
  razon: string;
  chofer: string | null | undefined;
}): NotifSeed[] {
  const { users, actorId, delivery_id, order_no, etiqueta, razon, chofer } = args;
  return users
    .filter((u) => (u.role === "logistics" || u.role === "admin") && u.id !== actorId)
    .map((u) => ({
      user_id: u.id, delivery_id, order_no, kind: KIND_RECHAZADA,
      message: `Order ${etiqueta} was rejected by the customer${chofer ? ` (${chofer})` : ""}: ${razon}`,
    }));
}

/** Nombre del evento en el historial de la orden y en Auditoría. `null` si no es uno de estos. Los saltos (D-487) ya no
 *  se escriben, pero los viejos se siguen nombrando. */
export function etiquetaDeEventoDeParada(kind: string, lang: "en" | "es"): string | null {
  if (kind === KIND_SALTADA) return lang === "es" ? "⏭ Parada saltada" : "⏭ Stop skipped";
  if (kind === KIND_RETOMADA) return lang === "es" ? "↩ Parada retomada" : "↩ Stop resumed";
  if (kind === KIND_RECHAZADA) return lang === "es" ? "⛔ Rechazada por el cliente" : "⛔ Rejected by customer";
  if (kind === KIND_LLEGO_A_RECOGER) return lang === "es" ? "📍 Llegó a la tienda" : "📍 Arrived at the store";
  if (kind === KIND_LLEGO_A_ENTREGAR) return lang === "es" ? "📍 Llegó con el cliente" : "📍 Arrived at the customer";
  return null;
}

/** La pastilla que acompaña a la etapa en Órdenes y en el Gestor. Colores con tokens del tema (claro y oscuro), no
 *  a pelo: es la regla de `inline-colors.test.ts`. Desde D-NEXT solo la del rechazo: «Saltada» se fue con su botón. */
export function pastillaDeMarca(m: MarcaDeParada | null | undefined, lang: "en" | "es"): { texto: string; fondo: string; tinta: string; detalle: string } | null {
  if (!m) return null;
  return { texto: lang === "es" ? "Rechazada" : "Rejected", fondo: "var(--red-chip-bg)", tinta: "var(--red-chip-text)", detalle: razonDeLaNota(m.motivo) };
}
