import { DELIVERY_WINDOW_PRESETS } from "./constants";
import { parseWindow } from "./dispatch";
import { cierraA, ventanasParaLaFecha } from "./delivery-windows";
import { esTodoElDia, motivosDeAprobacion, tiendaSinCupo, type MotivoDeAprobacion, type ReglasDeAprobacion } from "./aprobacion-por-hora-y-cupo";

/**
 * Las franjas de un día, con lo que queda en cada una, para la ficha de la orden (D-657).
 *
 * Kevin Gonzalez (vendedor), desde «New delivery order»: *«When I am creating an order. Is there a way of seeing the time
 * slots available for that day?»*. El dueño: *«tenemos que crear time slots»*.
 *
 * **No hay regla nueva.** Lo que llena una franja es el cupo de D-639 (`reglas.cupo`, editable en Ajustes) y lo que manda
 * a aprobación es `motivosDeAprobacion`, la misma función que decide el botón de crear: aquí solo se le pregunta, franja
 * por franja, «¿y si eligiera esta?». Una franja llena se enseña llena —no se esconde—, porque elegirla no está prohibido:
 * la orden va a aprobación de oficina, como ya pasaba.
 *
 * Qué franjas: las que el selector ofrece ese día (`ventanasParaLaFecha`: sábado sin «tarde», etc.), más las que tengan
 * cupo en Ajustes aunque no sean de la lista, si caben antes del cierre de ese día. Ordenadas por hora de empezar y luego
 * de acabar, que es como se leen en un reloj.
 */

export type EstadoDeFranja =
  /** Tiene cupo y aún cabe: `quedan` de `tope`. */
  | { tipo: "quedan"; quedan: number; tope: number }
  /** Tiene cupo y ya está lleno: elegirla manda la orden a aprobación (D-639). */
  | { tipo: "llena"; ocupadas: number; tope: number }
  /** Tiene cupo pero el conteo no llegó (cargando, o la ruta falló): se dice el tope y no se adivina lo ocupado. */
  | { tipo: "sin_conteo"; tope: number }
  /** «Todo el día» sin tope en Ajustes: se dice cuántas hay ese día, sin límite (D-712). */
  | { tipo: "cuenta"; ocupadas: number }
  /** Sin cupo: la ventana no tiene tope, o la tienda no cuenta para el cupo (flota propia). */
  | { tipo: "libre" };

export interface Franja {
  ventana: string;
  estado: EstadoDeFranja;
  /** Lo que diría D-639 si la orden se creara con esta franja: hora de corte y cupo. */
  motivos: MotivoDeAprobacion[];
}

const orden = (v: string): [number, number] => parseWindow(v) ?? [Infinity, Infinity];

/** Las ventanas que se enseñan ese día: las del selector y las que tienen cupo, sin repetir. */
export function ventanasDeLasFranjas(fecha: string, reglas: ReglasDeAprobacion, actual?: string | null): string[] {
  const delSelector = ventanasParaLaFecha(fecha, actual).map((p) => p.value);
  const cierre = cierraA(fecha);
  const conCupo = Object.keys(reglas.cupo).filter((v) => {
    const tramo = parseWindow(v);
    return !!tramo && tramo[1] <= cierre;
  });
  return [...new Set([...delSelector, ...conCupo])].sort((a, b) => {
    const [ia, fa] = orden(a), [ib, fb] = orden(b);
    return ia - ib || fa - fb;
  });
}

/** El estado de una franja: el mismo tope y la misma cuenta que `motivoPorCupo`. */
export function estadoDeFranja(ventana: string, tienda: string | null | undefined, ocupadas: Record<string, number> | null, reglas: ReglasDeAprobacion): EstadoDeFranja {
  const tope = reglas.cupo[ventana];
  if (tiendaSinCupo(tienda, reglas)) return { tipo: "libre" };
  if (typeof tope !== "number") return esTodoElDia(ventana) && ocupadas != null ? { tipo: "cuenta", ocupadas: ocupadas[ventana] ?? 0 } : { tipo: "libre" };
  if (ocupadas == null) return { tipo: "sin_conteo", tope };
  const n = ocupadas[ventana] ?? 0;
  return n >= tope ? { tipo: "llena", ocupadas: n, tope } : { tipo: "quedan", quedan: tope - n, tope };
}

/** Las franjas de esa fecha para una orden de esa tienda. Sin fecha válida, ninguna: no hay día que enseñar. */
export function franjasDelDia(args: {
  fecha: string | null | undefined;
  tienda: string | null | undefined;
  ocupadas: Record<string, number> | null;
  reglas: ReglasDeAprobacion;
  ahora: Date;
  actual?: string | null;
}): Franja[] {
  const fecha = (args.fecha ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return [];
  return ventanasDeLasFranjas(fecha, args.reglas, args.actual).map((ventana) => ({
    ventana,
    estado: estadoDeFranja(ventana, args.tienda, args.ocupadas, args.reglas),
    motivos: motivosDeAprobacion({ delivery_date: fecha, delivery_windows: ventana, store: args.tienda }, args.ahora, args.ocupadas, args.reglas),
  }));
}

/**
 * La dirección que pide el conteo, o `null` si no hay que pedirlo. Lleva la fecha dentro: la ficha vuelve a pedir
 * cuando cambia la dirección, o sea al cambiar la fecha. `excluir` es la propia orden al editarla.
 */
export function consultaDelCupo(fecha: string | null | undefined, excluir: string | null | undefined, activa: boolean): string | null {
  const f = (fecha ?? "").slice(0, 10);
  if (!activa || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  return `/api/cupo-de-la-manana?fecha=${f}${excluir ? `&excluir=${encodeURIComponent(excluir)}` : ""}`;
}

/** El nombre de la franja: el del selector si es una de la lista; si no, las horas. */
export function nombreDeFranja(ventana: string, es: boolean): string {
  const p = DELIVERY_WINDOW_PRESETS.find((x) => x.value === ventana);
  if (p) return es ? p.es : p.en;
  return ventana.replace(/(\d{2})(\d{2})/g, "$1:$2");
}

/** Lo que dice la franja debajo de su nombre. */
export function textoDeFranja(e: EstadoDeFranja, es: boolean): string {
  switch (e.tipo) {
    case "quedan":
      return es ? `${e.quedan === 1 ? "Queda" : "Quedan"} ${e.quedan} de ${e.tope}` : `${e.quedan} of ${e.tope} left`;
    case "llena":
      return es ? `Llena (${e.ocupadas} de ${e.tope})` : `Full (${e.ocupadas} of ${e.tope})`;
    case "sin_conteo":
      return es ? `Cupo de ${e.tope}` : `Limit ${e.tope}`;
    case "cuenta":
      return es ? `${e.ocupadas} ${e.ocupadas === 1 ? "orden" : "órdenes"} ese día` : `${e.ocupadas} ${e.ocupadas === 1 ? "order" : "orders"} that day`;
    case "libre":
      return es ? "Libre" : "Open";
  }
}
