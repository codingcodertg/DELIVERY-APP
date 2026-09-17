import type { Delivery } from "@/lib/types";

/**
 * La ruta del día, agrupada por chofer (D-287).
 *
 * Lo pidió Almacén dos veces: *«quiero ver a qué chofer le voy a cargar»* y *«como supervisor de
 * almacén quiero poder ver la ruta de los choferes»*. Y ya existía media vez, dentro de las hojas
 * de carga: mismo agrupado, mismo orden. Vive aquí una sola vez porque ahora lo piden dos
 * pantallas, y dos copias del mismo orden acaban ordenando distinto.
 *
 * Todo sale de `deliveries`, que es lo que Almacén ya puede leer (RLS, 080: ve las órdenes en
 * approved, fulfilling, ready, picked_up y delivered). **Las posiciones en vivo de los choferes NO
 * están aquí**: `driver_locations` solo la leen admin, logística y gerencia, y abrir eso es otra
 * decisión, del dueño.
 */

/** La clave del grupo «sin chofer»: una cadena vacía, sin centinelas. */
export const SIN_CHOFER = "";

export type ParadaDelDia = Delivery;

export type GrupoDeChofer = {
  /** El nombre del chofer, o `SIN_CHOFER` si la orden no tiene ninguno asignado. */
  chofer: string;
  paradas: ParadaDelDia[];
  /** Pallets del grupo: los reales si los hay, y si no el estimado. */
  pallets: number;
};

/**
 * El minuto en que empieza la ventana de entrega, para ordenar dentro de un chofer. Sin ventana
 * legible se va al final (9999), que es lo que hacía la hoja de carga desde siempre.
 */
export function inicioDeVentana(o: Delivery): number {
  const m = String(o.delivery_windows ?? "").match(/(\d{2})(\d{2})/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 9999;
}

/**
 * Un grupo por chofer, con **«Sin asignar» al final** y, dentro de cada chofer, las paradas por
 * secuencia de ruta y luego por ventana.
 *
 * Que los sin asignar vayan al final lo decide este comparador, a la vista. Antes lo decidía un
 * centinela `"\u0000"` cuyo comentario decía «sorts unassigned last» y hacía lo contrario: medido,
 * `["Ana", NUL, "Beto"].sort(localeCompare)` deja el NUL primero.
 */
export function rutaPorChofer(orders: Delivery[]): GrupoDeChofer[] {
  const grupos = new Map<string, Delivery[]>();
  for (const o of orders) {
    const clave = (o.assigned_driver || "").trim();
    const lista = grupos.get(clave) ?? [];
    if (!grupos.has(clave)) grupos.set(clave, lista);
    lista.push(o);
  }

  const claves = [...grupos.keys()].sort((a, b) => {
    if (a === SIN_CHOFER) return 1;
    if (b === SIN_CHOFER) return -1;
    return a.localeCompare(b);
  });

  return claves.map((chofer) => {
    const paradas = [...grupos.get(chofer)!].sort((a, b) => {
      const ra = a.route_seq ?? 1e9;
      const rb = b.route_seq ?? 1e9;
      return ra !== rb ? ra - rb : inicioDeVentana(a) - inicioDeVentana(b);
    });
    const pallets = paradas.reduce((s, o) => s + Number(o.actual_pallets ?? o.est_pallets ?? 0), 0);
    return { chofer, paradas, pallets };
  });
}
