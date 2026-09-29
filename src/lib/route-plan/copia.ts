import type { OrdenEntrada, Punto } from "@/lib/route-engine";
import type { LatLng } from "@/lib/route-times/claves";
import type { EntradaDelDia } from "./entrada";
import type { EscrituraDeOrden } from "./publicar";

/**
 * Cambiar una ruta YA PUBLICADA (D-429). El dueño: «los botons para cmabiar la ruta cuando ya esta no funciona» — «Ya
 * publicada, no me deja». Hasta aquí un plan publicado solo se miraba (D-322, D-323): los controles salían en un borrador.
 *
 * El primer ajuste sobre un publicado crea un BORRADOR NUEVO —copia del publicado con el movimiento aplicado— y el publicado
 * sigue siendo el vigente, intacto, hasta que se publique la copia por el camino de siempre (D-320). Aquí vive lo único que
 * hace falta decidir para que esa copia SE PUEDA publicar:
 *
 * **La foto.** Publicar compara cada orden de la foto (`input.ordenes`, con su `updated_at`) con la base, y si cambió no
 * publica (`ROUTE_PLAN_STALE`, 133). Pero publicar ESCRIBE en las órdenes, y eso les cambia el `updated_at`: la foto del
 * publicado, tal cual, está vieja por construcción. Así que la copia refresca el `updated_at` de cada orden — solo si la
 * orden sigue siendo la que el plan conoció:
 *   · lo que el motor usó de ella (dónde se recoge y entrega, con sus coordenadas, cuántos pallets, su ventana, cuánto se
 *     tarda, builder, prioridad, requisitos) es igual hoy; y
 *   · lo que publicar escribió (chofer, viaje, puesto) sigue igual — nadie la movió en el Gestor desde entonces.
 * Una orden que no cumple se queda con su foto vieja, y publicar la copia dirá «se editó después de planificar», como hoy.
 * La zona (D-421/D-427) no cuenta: sale de las zonas de los choferes, no de la orden.
 *
 * **Lo ya hecho.** Una orden del publicado que ya no está pendiente ese día —recogida, entregada, anulada, cambiada de
 * fecha, o que quien edita no ve— NO se reescribe (sale de la foto y de lo que se escribe) y sus paradas NO se mueven: el
 * chofer ya la lleva, o ya no es de este día. Publicar tampoco podría escribirla (133 la rechaza por `fuera_de_etapa`).
 */

export type Foto = EntradaDelDia["fotos"][number];

/** La orden tal cual la ve la base AHORA: lo que hace falta para saber si sigue siendo la del plan. */
export interface OrdenAhora { id: string; updated_at: string; assigned_driver: string | null; route_seq: number | null; load_no: number | null }

/** Lo que se guarda con la copia (`result.copiaDelPublicado`) y viaja con cada ajuste siguiente. */
export interface CopiaDelPublicado {
  /** El publicado del que salió: su versión, para decirlo en pantalla. */
  version: number;
  /** Órdenes que ya no están pendientes ese día: ni se reescriben ni se mueven. */
  noSeReescriben: string[];
  /** Órdenes que cambiaron desde que se publicó: la copia no se podrá publicar sin planificar de nuevo. */
  cambiaron: string[];
}

/** Lo que el motor usó de la orden y que decide si el plan sigue valiendo. Sin `codigo`/`entrada` (desempate), sin
 *  `choferFijado` (lo decide lo escrito) y sin zonas (salen de los choferes). */
export function fisicaDeLaOrden(o: OrdenEntrada, puntos: Readonly<Record<Punto, LatLng>>): string {
  const punto = (p: Punto | null) => (p ? [p, puntos[p]?.lat ?? null, puntos[p]?.lng ?? null] : null);
  return JSON.stringify([
    punto(o.origen), punto(o.destino), o.pallets, o.ventana ?? null, !!o.estrecha, !!o.builder,
    o.servicioRecogidaMin, o.servicioEntregaMin, o.prioridad ?? "normal", [...(o.requisitos ?? [])].sort(),
  ]);
}

export interface FotoDeLaCopia { fotos: Foto[]; noSeReescriben: string[]; cambiaron: string[] }

export function fotoDeLaCopia(a: {
  /** La foto del publicado (`input.ordenes`). */
  fotos: readonly Foto[];
  /** Las órdenes como entraron al motor del publicado (`input.entrada.ordenes`), y sus puntos (`input.puntos`). */
  guardadas: readonly OrdenEntrada[]; puntosGuardados: Readonly<Record<Punto, LatLng>>;
  /** Las mismas, leídas hoy con la misma función (`entradaDelDia`), y sus puntos. */
  frescas: readonly OrdenEntrada[]; puntosFrescos: Readonly<Record<Punto, LatLng>>;
  /** Las órdenes pendientes de ese día, hoy. Una que no esté aquí ya no está pendiente (o no se ve). */
  ahora: readonly OrdenAhora[];
  /** Lo que escribió el publicado (`writes`). */
  escritas: readonly Pick<EscrituraDeOrden, "id" | "assigned_driver" | "route_seq" | "load_no">[];
}): FotoDeLaCopia {
  const guardada = new Map(a.guardadas.map((o) => [o.id, o]));
  const fresca = new Map(a.frescas.map((o) => [o.id, o]));
  const hoy = new Map(a.ahora.map((o) => [o.id, o]));
  const escrita = new Map(a.escritas.map((w) => [w.id, w]));
  const fotos: Foto[] = [], noSeReescriben: string[] = [], cambiaron: string[] = [];
  for (const f of a.fotos) {
    const h = hoy.get(f.id);
    if (!h) { noSeReescriben.push(f.id); continue; }
    const g = guardada.get(f.id), n = fresca.get(f.id);
    const mismaFisica = !!g && !!n && fisicaDeLaOrden(g, a.puntosGuardados) === fisicaDeLaOrden(n, a.puntosFrescos);
    const w = escrita.get(f.id);
    // Escrita por el publicado: sigue con el chofer, el viaje y el puesto que le puso. No escrita (quedó sin asignar en ese
    // plan): publicar no la tocó, así que su `updated_at` tiene que ser el de la foto — si no, alguien la cambió.
    // El viaje (`load_no`): un publicado de antes de D-443 lo escribió; uno de después no lo escribe y publicar lo deja en
    // `null`. Los dos casos se comparan igual: lo que dice lo escrito (o nada) contra lo que hay (o nada).
    const intacta = w
      ? (h.assigned_driver ?? "") === w.assigned_driver && h.route_seq === w.route_seq && (h.load_no ?? null) === (w.load_no ?? null)
      : h.updated_at === f.updated_at;
    if (mismaFisica && intacta) fotos.push({ ...f, updated_at: h.updated_at });
    else { fotos.push(f); cambiaron.push(f.id); }
  }
  return { fotos, noSeReescriben: noSeReescriben.sort(), cambiaron: cambiaron.sort() };
}
