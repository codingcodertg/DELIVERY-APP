import type { ParadaFisica } from "@/lib/gestor/paradas-numeradas";
import type { ParadaDeLaLista } from "@/lib/lista-unica";
import { ETAPAS_HECHAS } from "@/lib/mover-parada";

// ============================================================
// D-584 · Dos pedidos del dueño para el chofer (2026-10-18, «for drivers in delivery app»):
//
//  1. «When pickup is at a store, no need to put address. Only if pickup is not at a store»: la recogida de «Mi ruta» dice
//     la TIENDA, resaltada, cuando sale de una tienda de Ajustes; la dirección solo cuando no (`recogidaParaElChofer`).
//  2. «keep the route lines of the day even when delivered»: la línea del mapa se mide sobre la ruta del DÍA —lo pendiente
//     con lo ya recogido o entregado donde iba (D-529)— y no sobre lo que queda. Hasta aquí, cada entrega cambiaba la forma
//     de la ruta (`firmaDeLaForma`), tiraba la medida, y se volvía a medir solo lo pendiente: la línea se encogía parada a
//     parada y desaparecía con la última (`seMide`, `tieneParadas`: cero pendientes). `ordenesDeLaRutaDelDia` y `listaDelDia` son
//     lo que se le da a `useMedidaDeRutas` en vez de lo pendiente.
// ============================================================

const normaliza = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export type RecogidaParaElChofer =
  /** Sale de una tienda de Ajustes: se enseña la tienda, resaltada, y NO su dirección. */
  | { enTienda: true; tienda: string }
  /** No es una tienda (un almacén o un proveedor, D-537): su nombre si lo tiene y su dirección. */
  | { enTienda: false; nombre: string | null; direccion: string | null };

/**
 * De dónde recoge el chofer, tal como se le enseña. La tienda es la de la orden (`pickup_name`, y si falta, `store`, como
 * el motor de rutas en `entrada.ts`), y «es tienda» quiere decir que está en Ajustes con ese nombre (sin mayúsculas ni
 * espacios de más, como `puntosDelTrazoPublicado`). Una orden sin ningún nombre de recogida no está en tienda.
 */
export function recogidaParaElChofer(
  d: { pickup_name?: string | null; pickup_address?: string | null; store?: string | null },
  tiendas: readonly { name: string }[],
): RecogidaParaElChofer {
  const nombre = (d.pickup_name ?? "").trim() || (d.store ?? "").trim() || null;
  const tienda = nombre ? tiendas.find((s) => normaliza(s.name) === normaliza(nombre)) : undefined;
  if (tienda) return { enTienda: true, tienda: tienda.name };
  return { enTienda: false, nombre, direccion: (d.pickup_address ?? "").trim() || null };
}

/** La ruta del DÍA de un chofer para medirla: lo pendiente y lo ya hecho, sin repetir una orden, en un orden que no
 *  depende de qué está hecho (por puesto, y por id): así la FORMA de la ruta (`firmaDeLaForma`) no cambia al entregar y
 *  la medida —y la línea— se quedan. El orden de las paradas lo pone la lista (`listaDelDia`), no este arreglo. */
export function ordenesDeLaRutaDelDia<T extends { id: string; route_seq?: number | null }>(pendientes: readonly T[], hechas: readonly T[]): T[] {
  const porId = new Map<string, T>();
  for (const d of [...pendientes, ...hechas]) if (!porId.has(d.id)) porId.set(d.id, d);
  return [...porId.values()].sort((a, b) => (a.route_seq ?? -1) - (b.route_seq ?? -1) || a.id.localeCompare(b.id));
}

/** Lo PENDIENTE de una ruta del día (lo que la tabla mueve y numera desde lo pendiente): lo que no está recogido ni entregado. */
export function pendientesDelDia<T extends { stage: string }>(delDia: readonly T[]): T[] {
  return delDia.filter((d) => !ETAPAS_HECHAS.has(d.stage));
}

/**
 * La lista que se mide: las paradas del día (`diaDe(…).paradas`, las mismas que numeran la tabla, el mapa y «Mi ruta»),
 * como la lista de una medida. Una recogida es una parada con sus órdenes y su tienda; una parada de entrega con varias
 * órdenes (misma dirección) son varias entregas seguidas, que la medida ya junta por punto.
 */
export function listaDelDia(paradas: readonly ParadaFisica[]): ParadaDeLaLista[] {
  return paradas.flatMap((p): ParadaDeLaLista[] => (p.tipo === "P"
    ? [{ tipo: "P", ordenes: [...p.ordenes], tienda: p.lugar }]
    : p.ordenes.map((orden) => ({ tipo: "D", orden }))));
}

/**
 * La marca del pin de una parada ya hecha en el mapa. Entregada: su NÚMERO de parada del día, y el pin apagado (la opacidad
 * la pone `dimmed`); hasta aquí era un «✓» apagado (D-459) y el dueño: «keep the numbers and fade them instead of replacing
 * them with a faded checkmark». Sin número (una entregada que nadie ordenó), el «✓» de siempre. Recogida y en camino: «🚚».
 */
export function marcaDeLaHecha(entregada: boolean, numero: number | null | undefined): string {
  if (!entregada) return "🚚";
  return numero != null ? String(numero) : "✓";
}
