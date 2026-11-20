import { listaDelChofer } from "@/lib/lista-unica";
import { ETAPAS_HECHAS, estaEnElCamion } from "@/lib/mover-parada";
import type { ModoDelGestor } from "@/lib/ordenes-del-dia";
import type { FilaDeLaRuta, LecturaDeRuta, OrdenAsignada, ParadaDelPlanMinima } from "@/lib/route-plan/lectura-de-ruta";
import { ordenDeLaParte } from "@/lib/route-plan/publicar";
import { BUSINESS_TZ } from "@/lib/utils";
import { formateadorDeFecha } from "@/lib/formateador";

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
 * La lista que se pinta: PRIMERO todo lo hecho, en el orden en que pasó (su hora real), y DESPUÉS todo lo pendiente, en el
 * orden de la lectura de siempre con su índice.
 *
 * El dueño (Routes Manager, 2026-11-19): una parada entregada a las 13:23 salía en medio de las pendientes, después de una
 * que aún ni había llegado, y sin flechas no había cómo subirla. Lo hecho ya no se mueve: lo que importa es que se lea en el
 * orden en que pasó. Lo pendiente no cambia en nada (orden, índice, flechas, arrastre, cuenta de pallets).
 *
 * De dónde sale el orden de lo pendiente: de la lista del DÍA ENTERO (la que ve «Mi ruta»: las paradas del plan publicado si
 * la ruta lo sigue, y si no `listaDelChofer`), de la que solo se toma el SITIO de las pendientes. Cada hueco pendiente se
 * rellena con la siguiente fila de `lectura.filas`, sin emparejar por orden ni por etiqueta. Eso lo hace `hechasPrimero`.
 */
export function filasConLoHecho(
  lectura: Pick<LecturaDeRuta, "fuente" | "filas">, pendientes: readonly OrdenAsignada[], hechas: readonly OrdenHecha[], capacidad: number,
  paradasDelPlan: readonly ParadaDelPlanMinima[] | null,
  /** `true` (la tabla): lo hecho primero, en su hora real. `false` (la MEDIDA y la clave del plan): lo hecho donde iba, como
   *  la ruta se hizo en la lista; así una parada hecha no cambia la forma medida ni la clave del plan (D-584). */
  comoIba = true,
): FilaPintada[] {
  const deSiempre: FilaPintada[] = lectura.filas.map((fila, i) => ({ hecha: false, fila, i }));
  if (hechas.length === 0) return deSiempre;
  const porId = new Map(hechas.map((h) => [h.id, h]));
  // D-621 (2026-10-20): de una orden EN EL CAMIÓN solo la recogida está hecha; su entrega es una fila PENDIENTE (viene
  // en `lectura.filas`, se mueve y se mide). Roberto: «Its picked up which is fine but the delivery is after other ones».
  // Si la pantalla no metió esa entrega entre las pendientes (no hay fila D suya en la lectura), se pinta como antes: fija,
  // «en camino». Así lo que lee solo con `hechas` sigue completo.
  const entregasPendientes = new Set(lectura.filas.filter((f) => f.tipo === "D").map((f) => f.orden));
  const esHecha = (tipo: "P" | "D", orden: string): boolean => {
    const h = porId.get(orden);
    return !!h && (tipo === "P" || !estaEnElCamion(h.stage) || !entregasPendientes.has(orden));
  };
  const filaHecha = (tipo: "P" | "D", orden: string): FilaPintada =>
    ({ hecha: true, tipo, orden, estado: tipo === "D" && porId.get(orden)!.stage !== "delivered" ? "en_camino" : "hecho" });
  const conPuesto = hechas.filter((h) => h.route_seq != null);
  // Una orden recogida está en `hechas` (por su P) y en `pendientes` (por su D): a la lista entera va una vez.
  const unaVez = new Map<string, OrdenAsignada>();
  for (const o of [...conPuesto, ...pendientes]) if (!unaVez.has(o.id)) unaVez.set(o.id, o);
  const entera: { tipo: "P" | "D"; orden: string }[] = lectura.fuente === "plan" && paradasDelPlan?.length
    ? [...paradasDelPlan].sort((a, b) => a.seq - b.seq).map((p) => ({ tipo: p.kind, orden: ordenDeLaParte(p.order_ref) }))
    : listaDelChofer([...unaVez.values()], capacidad)
      .flatMap((p): { tipo: "P" | "D"; orden: string }[] => (p.tipo === "P" ? p.ordenes.map((orden) => ({ tipo: "P", orden })) : [{ tipo: "D", orden: p.orden }]));
  const out: FilaPintada[] = [];
  const pintadas = new Set<string>();
  let k = 0;
  for (const hueco of entera) {
    if (esHecha(hueco.tipo, hueco.orden)) {
      const clave = `${hueco.tipo}:${hueco.orden}`;
      if (!pintadas.has(clave)) { pintadas.add(clave); out.push(filaHecha(hueco.tipo, hueco.orden)); }
    } else if (k < deSiempre.length) out.push(deSiempre[k++]);
  }
  while (k < deSiempre.length) out.push(deSiempre[k++]);
  const sinSitio = hechas.flatMap((h) => (["P", "D"] as const).filter((tipo) => esHecha(tipo, h.id) && !pintadas.has(`${tipo}:${h.id}`)).map((tipo) => filaHecha(tipo, h.id)));
  return comoIba ? hechasPrimero([...sinSitio, ...out], porId) : [...sinSitio, ...out];
}

/** La hora REAL de una orden en una fila hecha, en milisegundos: la de su entrega (`pod_delivered_at`) para una «D», la de su
 *  recogida (`pickup_gps_at`) para una «P» (mismo campo que `horaReal`). `null` si falta o no se lee. */
export function instanteReal(o: { pod_delivered_at?: string | null; pickup_gps_at?: string | null } | undefined, tipo: "P" | "D"): number | null {
  const iso = tipo === "D" ? o?.pod_delivered_at : o?.pickup_gps_at;
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Una fila para ordenar: `hecha` (ya hecha: recogida hecha o entrega entregada), su tipo y las órdenes que lleva (una la «D»;
 *  una o varias la «P», si son de la misma tienda). */
export interface FilaQueSeOrdena { hecha: boolean; tipo: "P" | "D"; ordenes: readonly string[] }

/**
 * Orden de las filas para pintar y numerar: PRIMERO las hechas, en el orden en que pasó (su hora real), y DESPUÉS las demás,
 * en su orden de siempre. Devuelve los índices de `filas` en el orden nuevo (una permutación completa).
 * - Sin hechas, la permutación es la identidad.
 * - La hora de una fila: la más temprana de sus órdenes que tenga hora. Sin hora (o ilegible), toma la de la hecha de ANTES en
 *   la lista de hoy; al principio de todo, ninguna (−∞), así que queda delante en su orden actual. Es estable: lo que empata
 *   sale en el orden en que estaba.
 * - Una entrega nunca queda antes que su recogida: si la hora de la entrega es anterior (el chofer tocó tarde), la entrega se
 *   pone justo detrás de su recogida. Así la carga de a bordo sigue cuadrando.
 */
export function ordenConHechasPrimero(filas: readonly FilaQueSeOrdena[], instante: (orden: string, tipo: "P" | "D") => number | null): number[] {
  const hechas: number[] = [];
  const resto: number[] = [];
  filas.forEach((f, k) => (f.hecha ? hechas : resto).push(k));
  if (hechas.length === 0) return filas.map((_, k) => k);
  let previa = -Infinity;
  const conClave = hechas.map((k) => {
    const f = filas[k];
    const ms = f.ordenes.map((o) => instante(o, f.tipo)).filter((x): x is number => x != null);
    const clave = ms.length ? Math.min(...ms) : previa;
    previa = clave;
    return { k, clave };
  });
  conClave.sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
  const ord = conClave.map((x) => x.k);
  for (const d of [...ord]) {
    const f = filas[d];
    if (f.tipo !== "D") continue;
    const iP = ord.findIndex((k) => filas[k].tipo === "P" && filas[k].ordenes.includes(f.ordenes[0]));
    const iD = ord.indexOf(d);
    if (iP >= 0 && iD < iP) {
      ord.splice(iD, 1);
      ord.splice(iP, 0, d);
    }
  }
  return [...ord, ...resto];
}

/** Lo HECHO de la lista que se pinta (`filasConLoHecho`) va primero, en orden real (`ordenConHechasPrimero`); lo demás, detrás. */
function hechasPrimero(filas: readonly FilaPintada[], porId: ReadonlyMap<string, OrdenHecha>): FilaPintada[] {
  const porFila: FilaQueSeOrdena[] = filas.map((f) => (f.hecha
    ? { hecha: f.estado === "hecho", tipo: f.tipo, ordenes: [f.orden] }
    : { hecha: false, tipo: f.fila.tipo, ordenes: f.fila.tipo === "P" ? f.fila.ordenes : [f.fila.orden] }));
  return ordenConHechasPrimero(porFila, (orden, tipo) => instanteReal(porId.get(orden), tipo)).map((k) => filas[k]);
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
  return formateadorDeFecha("en-GB", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
