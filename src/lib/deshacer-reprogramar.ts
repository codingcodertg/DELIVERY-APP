/**
 * «Deshacer» en el aviso «Reprogramada al …» (D-861). El dueño, 2026-11-04, con la captura del Gestor: «where it says
 * rescheduled at the bottom, I want an UNDO right there, in case it was a mistake and I catch it».
 *
 * Qué cambia un «📅 Reprogramar» (medido en las migraciones, no supuesto):
 *  - `reprogramar_orden` (173) cambia SOLO `delivery_date` y deja dos eventos en el historial (el «edited» y la nota).
 *    Ni la etapa, ni la ventana, ni la aprobación.
 *  - El disparador de la 172, si la orden tenía chofer y está entre pendiente y lista, la saca de su ruta:
 *    `assigned_driver`, `route_seq` y `pickup_seq` a null, con su propio evento.
 *
 * Deshacer = reprogramar de vuelta a la fecha de antes POR EL MISMO CAMINO (la misma función, con sus permisos, su RLS y
 * su nota en el historial) y, si la 172 la sacó de la ruta y quien deshace es de los que asignan, volver a ponerla con su
 * chofer y su posición (un `updateDelivery` normal, que el guard juzga y el historial apunta). Lo de aquí es la regla,
 * sin pantalla: qué se fotografía antes y qué se escribe al deshacer.
 */
import type { Delivery } from "./types";

/** Lo que la reprogramación puede cambiar, tal como estaba antes de tocarla. */
export interface FotoDeReprogramacion {
  id: string;
  delivery_date: string | null;
  stage: string;
  assigned_driver: string | null;
  route_seq: number | null;
  pickup_seq: number | null;
}

export function fotoAntesDeReprogramar(d: Pick<Delivery, "id" | "delivery_date" | "stage" | "assigned_driver" | "route_seq"> & { pickup_seq?: number | null }): FotoDeReprogramacion {
  return {
    id: d.id,
    delivery_date: d.delivery_date ? d.delivery_date.slice(0, 10) : null,
    stage: d.stage,
    assigned_driver: d.assigned_driver ?? null,
    route_seq: d.route_seq ?? null,
    pickup_seq: d.pickup_seq ?? null,
  };
}

/** Los roles que asignan chofer en el Gestor: solo ellos devuelven la orden a la ruta al deshacer. */
const ROLES_QUE_ASIGNAN = ["admin", "logistics", "manager"];

/** Cuánto se queda el aviso con «Deshacer»: lo bastante para leerlo y cazar el error. */
export const MS_AVISO_CON_DESHACER = 8000;

export interface PlanDeDeshacer {
  /** La fecha a la que vuelve (por `reprogramar_orden`). `null`: no tenía fecha, no se puede deshacer por ese camino. */
  fecha: string | null;
  /** La nota obligatoria de la función: dice en el historial que es un deshacer. */
  nota: string;
  /** Si la 172 la sacó de la ruta: el parche que la vuelve a poner. `null`: no hace falta o este rol no asigna. */
  parcheDeRuta: Pick<Delivery, "assigned_driver" | "route_seq"> & { pickup_seq: number | null } | null;
}

/**
 * Qué escribir para deshacer. `ahora` es la orden tal como quedó tras reprogramar (o `undefined` si ya no se ve).
 * La ruta se devuelve solo si la orden la perdió (chofer vacío ahora) y nadie le puso otro mientras tanto.
 */
export function planDeDeshacer(foto: FotoDeReprogramacion, ahora: Pick<Delivery, "assigned_driver"> | undefined, rol: string | null | undefined, lang: "en" | "es"): PlanDeDeshacer {
  const perdioLaRuta = !!foto.assigned_driver && (!ahora || !ahora.assigned_driver);
  const parcheDeRuta = perdioLaRuta && ROLES_QUE_ASIGNAN.includes(rol ?? "")
    ? { assigned_driver: foto.assigned_driver, route_seq: foto.route_seq, pickup_seq: foto.pickup_seq }
    : null;
  return { fecha: foto.delivery_date, nota: notaDeDeshacer(lang), parcheDeRuta };
}

export function notaDeDeshacer(lang: "en" | "es"): string {
  return lang === "es" ? "Deshecha la reprogramación anterior (fue un error)" : "Undid the previous reschedule (it was a mistake)";
}
