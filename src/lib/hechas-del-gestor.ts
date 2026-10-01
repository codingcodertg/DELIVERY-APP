import { listaDelChofer } from "@/lib/lista-unica";
import { ETAPAS_HECHAS } from "@/lib/mover-parada";
import type { ModoDelGestor } from "@/lib/ordenes-del-dia";
import type { FilaDeLaRuta, LecturaDeRuta, OrdenAsignada, ParadaDelPlanMinima } from "@/lib/route-plan/lectura-de-ruta";
import { ordenDeLaParte } from "@/lib/route-plan/publicar";
import { BUSINESS_TZ } from "@/lib/utils";

/**
 * Lo ya HECHO de un chofer sigue en su lista del Gestor de Rutas (D-459).
 *
 * El dueño, 2026-10-01: «right now when the order gets delivered it desapears frm the logistic manager view so don't do
 * that». Hasta aquí el Gestor pintaba solo lo pendiente (`ROUTE_STAGES`): al entregar, la orden se iba de la tarjeta de su
 * chofer, y un chofer que ya lo había entregado todo se quedaba sin tarjeta. D-433 ya contaba lo hecho para COMPARAR con el
 * plan y para numerar; no lo pintaba («lo ya hecho cuenta para comparar y no se pinta»). Ahora se pinta.
 *
 * Lo que NO cambia, y por eso esto va aparte de `lecturaDeLaRuta`: **las filas pendientes son exactamente las de la
 * lectura de siempre, en su orden y con su índice**. Las flechas, el arrastre, «Pasar a…», «🧭 Optimizar», la cuenta de
 * pallets y la medida siguen trabajando sobre lo pendiente y nada más; lo hecho no tiene índice, así que ninguno de ellos lo
 * puede tocar (su puesto es fijo, D-433). Aquí solo se decide EN QUÉ HUECO de esa lista se intercala cada fila hecha.
 */

/** Lo que hace falta de una orden ya hecha. */
export interface OrdenHecha extends OrdenAsignada { stage: string; pod_delivered_at?: string | null; pickup_gps_at?: string | null }

/**
 * Lo hecho que se PINTA, por chofer: solo viendo UN día, lo recogido o entregado de ese día. Viendo «todas las fechas» la
 * lista de un chofer mezcla días (y lo entregado sería toda su historia); viendo lo atrasado, nada está hecho.
 */
export function hechasQueSePintan<T extends { stage: string; assigned_driver?: string | null; delivery_date?: string | null; route_seq?: number | null; order_no: number }>(
  todas: readonly T[], fecha: string, modo: ModoDelGestor,
): Map<string, T[]> {
  const porChofer = new Map<string, T[]>();
  if (modo !== "dia") return porChofer;
  for (const d of todas) {
    if (!d.assigned_driver || !ETAPAS_HECHAS.has(d.stage) || d.delivery_date !== fecha) continue;
    porChofer.set(d.assigned_driver, [...(porChofer.get(d.assigned_driver) ?? []), d]);
  }
  for (const lista of porChofer.values()) {
    // Sin puesto, delante: lo hecho que nadie ordenó ya pasó. Las demás, por su puesto.
    const sinPuesto = (x: T) => x.route_seq == null;
    lista.sort((a, b) => {
      if (sinPuesto(a) !== sinPuesto(b)) return sinPuesto(a) ? -1 : 1;
      return (a.route_seq ?? 0) - (b.route_seq ?? 0) || a.order_no - b.order_no;
    });
  }
  return porChofer;
}

/**
 * Una fila de la tabla de paradas: una pendiente (la de `lectura.filas`, con su puesto `i` en ella, que es el de su
 * cuenta de pallets) o una ya hecha, que solo informa.
 * - `estado: "hecho"`: la recogida de una orden recogida o entregada, y la entrega de una entregada.
 * - `estado: "en_camino"`: la entrega de una orden recogida y aún sin entregar. No está hecha, pero tampoco se mueve: va
 *   en el camión.
 */
export type FilaPintada =
  | { hecha: false; fila: FilaDeLaRuta; i: number }
  | { hecha: true; tipo: "P" | "D"; orden: string; estado: "hecho" | "en_camino" };

/**
 * La lista que se pinta: las filas pendientes de la lectura, en su orden, con las hechas intercaladas **en el orden en
 * que iban**.
 *
 * De dónde sale ese orden: de la lista del DÍA ENTERO —lo pendiente más lo hecho—, que es la que ve el chofer en «Mi
 * ruta»: las paradas del plan publicado si la ruta lo sigue (`lectura.fuente === "plan"`), y si no `listaDelChofer` con
 * todas sus órdenes. De esa lista solo se toma el SITIO de las hechas: cada hueco pendiente se rellena con la siguiente
 * fila de `lectura.filas`, sin emparejar por orden ni por etiqueta, para que lo pendiente no pueda salir distinto de como
 * lo mueven las flechas. Con el mismo puesto guardado en una hecha y una pendiente (el empate que midió D-433), la hecha va
 * delante. Una hecha sin puesto va arriba del todo: ya pasó.
 */
export function filasConLoHecho(
  lectura: Pick<LecturaDeRuta, "fuente" | "filas">, pendientes: readonly OrdenAsignada[], hechas: readonly OrdenHecha[], capacidad: number,
  paradasDelPlan: readonly ParadaDelPlanMinima[] | null,
): FilaPintada[] {
  const deSiempre: FilaPintada[] = lectura.filas.map((fila, i) => ({ hecha: false, fila, i }));
  if (hechas.length === 0) return deSiempre;
  const porId = new Map(hechas.map((h) => [h.id, h]));
  const filaHecha = (tipo: "P" | "D", orden: string): FilaPintada =>
    ({ hecha: true, tipo, orden, estado: tipo === "D" && porId.get(orden)!.stage !== "delivered" ? "en_camino" : "hecho" });

  const conPuesto = hechas.filter((h) => h.route_seq != null);
  const entera: { tipo: "P" | "D"; orden: string }[] = lectura.fuente === "plan" && paradasDelPlan?.length
    ? [...paradasDelPlan].sort((a, b) => a.seq - b.seq).map((p) => ({ tipo: p.kind, orden: ordenDeLaParte(p.order_ref) }))
    : listaDelChofer([...conPuesto, ...pendientes], capacidad)
      .flatMap((p): { tipo: "P" | "D"; orden: string }[] => (p.tipo === "P" ? p.ordenes.map((orden) => ({ tipo: "P", orden })) : [{ tipo: "D", orden: p.orden }]));

  const out: FilaPintada[] = [];
  const pintadas = new Set<string>();
  let k = 0;
  for (const hueco of entera) {
    if (porId.has(hueco.orden)) {
      // Una orden repartida en cargas sale dos veces en el plan: hecha, una fila de recogida y una de entrega bastan.
      const clave = `${hueco.tipo}:${hueco.orden}`;
      if (!pintadas.has(clave)) { pintadas.add(clave); out.push(filaHecha(hueco.tipo, hueco.orden)); }
    } else if (k < deSiempre.length) out.push(deSiempre[k++]);
  }
  while (k < deSiempre.length) out.push(deSiempre[k++]);
  // Las hechas que la lista del día no trae (sin puesto, o fuera del plan): arriba, cada una con su recogida y su entrega.
  const sinSitio = hechas.flatMap((h) => (["P", "D"] as const).filter((tipo) => !pintadas.has(`${tipo}:${h.id}`)).map((tipo) => filaHecha(tipo, h.id)));
  return [...sinSitio, ...out];
}

/** «3 de 7 entregadas»: lo entregado contra TODAS las órdenes del chofer ese día (pendientes, recogidas y entregadas). */
export function resumenDeEntregas(pendientes: readonly unknown[], hechas: readonly { stage: string }[]): { entregadas: number; total: number } {
  return { entregadas: hechas.filter((h) => h.stage === "delivered").length, total: pendientes.length + hechas.length };
}

/** La hora REAL de una fila hecha, «HH:MM» en el huso del negocio: la de la entrega (`pod_delivered_at`) o la de la recogida
 *  (`pickup_gps_at`). `null` si no se guardó o no se lee: entonces la celda no inventa una. */
export function horaReal(orden: { pod_delivered_at?: string | null; pickup_gps_at?: string | null }, tipo: "P" | "D"): string | null {
  const iso = tipo === "D" ? orden.pod_delivered_at : orden.pickup_gps_at;
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
