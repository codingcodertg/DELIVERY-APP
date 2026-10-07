import type { OrderEvent } from "@/lib/types";
import type { NotifSeed } from "@/lib/notifications";
import { isoInTZ } from "@/lib/utils";
import { KIND_RECIBIDA } from "@/lib/recibir";
import { EVENTO_DEJADO } from "@/lib/leave-at-store";

// ============================================================
// Botones por parada en «Mi ruta» (D-487): Recogido · Saltar en cada recogida; Entregado · Saltar · Rechazado en
// cada entrega.
//
// El dueño, 2026-10-06: «quiero que ahí salga un por cada carga, cada pickup y los deliveries también que diga pickup
// […] deliver, skip y en los deliveries puede ser hasta rejected y él tiene que poner una razón».
//
// «Recogido» y «Entregado» ya existían (D-218, `one-tap-stop.ts`) y se reúsan tal cual. Lo nuevo es Saltar y Rechazado,
// y **ninguno de los dos cambia la etapa**:
//
//  - **Saltar**: el chofer no pudo hacer esa parada ahora y sigue con la siguiente. La orden sigue en su ruta, en su
//    etapa; queda un evento `skipped` en `order_events` y la parada deja de ser «la siguiente» hasta que la retome
//    (`resumed`) o la cierre. Un salto vale **el día en que se hizo** (zona del negocio): mañana la parada vuelve a
//    salir normal, porque saltar es «ahora no», no «nunca».
//  - **Rechazado**: el cliente no aceptó la entrega. Evento `customer_rejected` con la razón en la nota, OBLIGATORIA.
//    La orden se queda en `picked_up` —el material sigue en el camión— y el chofer la descarga con «Dejar en tienda»
//    (D-224), que ya existía. La marca sigue visible para logística en Órdenes y en el Gestor hasta que la orden se
//    vuelva a recoger o se entregue.
//
// Por qué eventos y no una etapa o columna: es el mismo camino de «Received» (D-409, `recibir.ts`). `order_events.kind`
// es texto libre, el chofer ya puede insertar sus propios eventos (100: `created_by = auth.uid()`), y la lista ya los
// carga para todos los roles. Cero migraciones, y el guard de etapas (`guard_delivery_stage`) ni se entera.
//
// Puro: sin React, sin red.
// ============================================================

export const KIND_SALTADA = "skipped";
export const KIND_RECHAZADA = "customer_rejected";
export const KIND_RETOMADA = "resumed";

export type MarcaDeParada =
  | { marca: "saltada"; at: string }
  | { marca: "rechazada"; at: string; motivo: string | null };

/** Lo que borra la marca de rechazo: la orden volvió a salir o se cerró. */
const CIERRAN_RECHAZO = new Set<string>(["picked_up", "delivered", KIND_RECIBIDA, "canceled"]);
/** Lo que borra un salto: la parada se movió de etapa (o se retomó a mano). */
const CIERRAN_SALTO = new Set<string>(["picked_up", "delivered", KIND_RECIBIDA, "canceled", "ready", EVENTO_DEJADO, KIND_RETOMADA, KIND_RECHAZADA]);

/**
 * La marca vigente de cada orden, leída de su historial. Se calcula una vez por lista de eventos.
 *
 * `hoy` es la fecha del negocio (`todayISO()`): un salto de otro día ya no cuenta.
 */
export function marcasDeParadas(
  events: readonly Pick<OrderEvent, "delivery_id" | "kind" | "created_at" | "note">[],
  hoy: string,
): Map<string, MarcaDeParada> {
  const porOrden = new Map<string, Pick<OrderEvent, "delivery_id" | "kind" | "created_at" | "note">[]>();
  for (const e of events) {
    if (e.kind === "note") continue;
    const l = porOrden.get(e.delivery_id);
    if (l) l.push(e); else porOrden.set(e.delivery_id, [e]);
  }
  const out = new Map<string, MarcaDeParada>();
  for (const [id, lista] of porOrden) {
    const enOrden = [...lista].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    let rechazo: MarcaDeParada | null = null;
    let salto: MarcaDeParada | null = null;
    for (const e of enOrden) {
      if (CIERRAN_SALTO.has(e.kind)) salto = null;
      if (CIERRAN_RECHAZO.has(e.kind)) rechazo = null;
      if (e.kind === KIND_RECHAZADA) rechazo = { marca: "rechazada", at: e.created_at, motivo: e.note };
      if (e.kind === KIND_SALTADA && isoInTZ(new Date(e.created_at)) === hoy) salto = { marca: "saltada", at: e.created_at };
    }
    const m = rechazo ?? salto;
    if (m) out.set(id, m);
  }
  return out;
}

export type AccionDeParada = "recoger" | "entregar" | "saltar" | "retomar" | "rechazar" | "dejar";

/**
 * Qué botones lleva una parada. `tipo` es la letra de la fila (P recogida, D entrega). Es lo único que decide la
 * pantalla: lo que no sale de aquí no se pinta.
 *
 *  - Hecha (recogida ya en el camión o entregada) o anulada: nada.
 *  - Rechazada: solo «Dejar en tienda» —y en la entrega, que es donde vive el material—.
 *  - Recogida: «Recogido» si está lista (`ready`; antes el almacén no la ha preparado) y Saltar/Retomar.
 *  - Entrega: con el material en el camión (`picked_up`), «Entregado», Saltar/Retomar y «Rechazado». Antes de
 *    recogerla solo se puede saltar: entregar o rechazar algo que no se ha cargado no existe.
 */
export function accionesDeParada(tipo: "P" | "D", etapa: string | null | undefined, marca: MarcaDeParada | null | undefined): AccionDeParada[] {
  if (etapa === "delivered" || etapa === "canceled") return [];
  if (marca?.marca === "rechazada") return tipo === "D" && etapa === "picked_up" ? ["dejar"] : [];
  const salto: AccionDeParada = marca?.marca === "saltada" ? "retomar" : "saltar";
  if (tipo === "P") {
    if (etapa === "picked_up") return [];
    return etapa === "ready" ? ["recoger", salto] : [salto];
  }
  if (etapa === "picked_up") return ["entregar", salto, "rechazar"];
  return [salto];
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

/** Nombre del evento en el historial de la orden y en Auditoría. `null` si no es uno de estos. */
export function etiquetaDeEventoDeParada(kind: string, lang: "en" | "es"): string | null {
  if (kind === KIND_SALTADA) return lang === "es" ? "⏭ Parada saltada" : "⏭ Stop skipped";
  if (kind === KIND_RETOMADA) return lang === "es" ? "↩ Parada retomada" : "↩ Stop resumed";
  if (kind === KIND_RECHAZADA) return lang === "es" ? "⛔ Rechazada por el cliente" : "⛔ Rejected by customer";
  return null;
}

/** La pastilla que acompaña a la etapa en Órdenes y en el Gestor. Colores con tokens del tema (claro y oscuro), no
 *  a pelo: es la regla de `inline-colors.test.ts`. */
export function pastillaDeMarca(m: MarcaDeParada | null | undefined, lang: "en" | "es"): { texto: string; fondo: string; tinta: string; detalle: string } | null {
  if (!m) return null;
  if (m.marca === "rechazada") {
    return { texto: lang === "es" ? "Rechazada" : "Rejected", fondo: "var(--red-chip-bg)", tinta: "var(--red-chip-text)", detalle: razonDeLaNota(m.motivo) };
  }
  return { texto: lang === "es" ? "Saltada" : "Skipped", fondo: "var(--amber-soft)", tinta: "var(--amber-text)", detalle: "" };
}
