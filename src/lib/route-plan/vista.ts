import type { FilaDeParada } from "./entrada";
import { ordenDeLaParte } from "./publicar";

/**
 * La ruta de cada chofer, como se enseña (D-322): de las filas guardadas en `route_plan_stops` a lo que la
 * pantalla pinta. No calcula horas ni decide nada: las horas son las que guardó el motor. Aquí solo se
 * agrupa, se ordena, se suma y se dice lo que una fila sola no dice —con cuántos pallets llega el camión a
 * cada parada, qué viaje es, si la orden es de builder, y si es una de varias cargas de la misma orden.
 */

export type ParadaGuardada = Pick<FilaDeParada,
  "driver_id" | "driver_name" | "seq" | "kind" | "delivery_id" | "order_ref" | "label" | "place" | "window_start" | "window_end" | "is_hard" |
  "eta" | "etd" | "wait_min" | "service_min" | "late_min" | "load_after" | "leg_minutes" | "leg_miles" | "pinned">;

export interface ParadaVista extends ParadaGuardada {
  /** Pallets a bordo durante el tramo que LLEGA a esta parada: lo que cargaba al salir de la anterior. */
  aBordoAlLlegar: number;
  /** El viaje del día: sube cada vez que el camión, ya vacío, vuelve a recoger. */
  viaje: number;
  builder: boolean;
  /** Si el motor repartió la orden en varias cargas: cuál es esta y de cuántas. */
  carga: { numero: number; de: number } | null;
}

export interface RutaVista {
  choferId: string;
  chofer: string;
  paradas: ParadaVista[];
  totales: {
    paradas: number; entregas: number; viajes: number;
    /** De la llegada a la primera parada a la salida de la última. El regreso a la base no es una parada. */
    inicio: number; fin: number; minutos: number;
    manejoMin: number; millas: number; esperaMin: number; tardeMin: number;
    /** Lo más cargado que va el camión en todo el día. */
    palletsMax: number;
  };
}

/** Minutos desde la medianoche, como hora de reloj: 510 → «08:30». */
export const horaDeReloj = (min: number): string => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const centesimas = (n: number) => Math.round(n * 100) / 100;

export function vistaDelPlan(
  paradas: readonly ParadaGuardada[],
  ordenes: readonly { id: string; builder?: boolean }[],
  partes: Readonly<Record<string, readonly string[]>>,
): RutaVista[] {
  const esBuilder = new Set(ordenes.filter((o) => o.builder).map((o) => o.id));
  const porChofer = new Map<string, ParadaGuardada[]>();
  // Una parada sin chofer (se borró su perfil: `on delete set null`) no es de nadie: se agrupa por el nombre.
  for (const p of paradas) {
    const k = p.driver_id ?? `nombre:${p.driver_name}`;
    porChofer.set(k, [...(porChofer.get(k) ?? []), p]);
  }
  const rutas: RutaVista[] = [];
  for (const [choferId, suyas] of porChofer) {
    const enOrden = [...suyas].sort((a, b) => a.seq - b.seq);
    let aBordo = 0, viaje = 1, vacioTrasEntregar = false;
    const vistas = enOrden.map((p): ParadaVista => {
      if (p.kind === "P" && vacioTrasEntregar) { viaje++; vacioTrasEntregar = false; }
      const id = ordenDeLaParte(p.order_ref);
      const hermanas = partes[id];
      const numero = hermanas ? hermanas.indexOf(p.order_ref) + 1 : 0;
      const v: ParadaVista = {
        ...p, load_after: Number(p.load_after), leg_miles: Number(p.leg_miles),
        aBordoAlLlegar: aBordo, viaje, builder: esBuilder.has(id),
        carga: hermanas && hermanas.length > 1 && numero > 0 ? { numero, de: hermanas.length } : null,
      };
      aBordo = Number(p.load_after);
      if (p.kind === "D" && aBordo === 0) vacioTrasEntregar = true;
      return v;
    });
    const primera = vistas[0], ultima = vistas[vistas.length - 1];
    rutas.push({
      choferId, chofer: primera.driver_name, paradas: vistas,
      totales: {
        paradas: vistas.length, entregas: vistas.filter((p) => p.kind === "D").length, viajes: viaje,
        inicio: primera.eta, fin: ultima.etd, minutos: ultima.etd - primera.eta,
        manejoMin: vistas.reduce((s, p) => s + p.leg_minutes, 0), millas: centesimas(vistas.reduce((s, p) => s + p.leg_miles, 0)),
        esperaMin: vistas.reduce((s, p) => s + p.wait_min, 0), tardeMin: vistas.reduce((s, p) => s + p.late_min, 0),
        palletsMax: centesimas(Math.max(...vistas.map((p) => p.load_after))),
      },
    });
  }
  return rutas.sort((a, b) => (a.chofer < b.chofer ? -1 : a.chofer > b.chofer ? 1 : a.choferId < b.choferId ? -1 : 1));
}
