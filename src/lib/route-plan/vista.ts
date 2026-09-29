import type { FilaDeParada } from "./entrada";
import { ordenDeLaParte } from "./publicar";
import { cuentaDePallets, type FilaDeCuenta } from "@/lib/lista-unica";

/**
 * La ruta de cada chofer, como se enseña (D-322): de las filas guardadas en `route_plan_stops` a lo que la
 * pantalla pinta. No calcula horas ni decide nada: las horas son las que guardó el motor. Aquí solo se
 * agrupa, se ordena, se suma y se dice lo que una fila sola no dice —la cuenta de pallets de cada parada, si la orden es
 * de builder, y si es una de varias cargas de la misma orden.
 *
 * Sin viajes desde D-NEXT: la ruta es UNA lista (el motor ya la planificaba así, con recargas a media ruta); lo que
 * antes se contaba como «N viajes» y se pintaba con una raya ya no existe. En su lugar, cada parada lleva su cuenta —a bordo
 * antes ± la parada = a bordo después · libre— y la ruta, su salida y su regreso a la base.
 */

export type ParadaGuardada = Pick<FilaDeParada,
  "driver_id" | "driver_name" | "seq" | "kind" | "delivery_id" | "order_ref" | "label" | "place" | "window_start" | "window_end" | "is_hard" |
  "eta" | "etd" | "wait_min" | "service_min" | "late_min" | "load_after" | "leg_minutes" | "leg_miles" | "pinned">;

export interface ParadaVista extends ParadaGuardada {
  /** Pallets a bordo durante el tramo que LLEGA a esta parada: lo que cargaba al salir de la anterior. */
  aBordoAlLlegar: number;
  /** La cuenta de esta parada (D-NEXT): antes ± la parada = después, y lo libre con la capacidad del camión. */
  cuenta: FilaDeCuenta;
  builder: boolean;
  /** Si el motor repartió la orden en varias cargas: cuál es esta y de cuántas. */
  carga: { numero: number; de: number } | null;
}

export interface RutaVista {
  choferId: string;
  chofer: string;
  /** La capacidad del camión con la que se planificó, o `null` si no se sabe (la cuenta no marca excesos). */
  capacidad: number | null;
  paradas: ParadaVista[];
  /** La salida de la base (0 a bordo) y el regreso (lo que quede, que tiene que ser 0). */
  salida: FilaDeCuenta;
  regreso: FilaDeCuenta;
  totales: {
    paradas: number; entregas: number;
    /** De la llegada a la primera parada a la salida de la última. El regreso a la base no es una parada. */
    inicio: number; fin: number; minutos: number;
    manejoMin: number; millas: number; esperaMin: number; tardeMin: number;
    /** Lo más cargado que va el camión en todo el día. */
    palletsMax: number;
    /** Lo que se carga en el día (la suma de las recogidas). */
    palletsMovidos: number;
    /** En cuántas paradas se pasa de la capacidad. */
    paradasConExceso: number;
    /** Al volver a la base no da 0: la cuenta no cuadra. */
    finalNoCero: boolean;
  };
}

/** Minutos desde la medianoche, como hora de reloj: 510 → «08:30». */
export const horaDeReloj = (min: number): string => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const centesimas = (n: number) => Math.round(n * 100) / 100;

/** `choferes`: los del plan, para la capacidad de cada camión (`input.entrada.choferes`). Sin ellos, la cuenta no marca
 *  excesos. */
export function vistaDelPlan(
  paradas: readonly ParadaGuardada[],
  ordenes: readonly { id: string; builder?: boolean }[],
  partes: Readonly<Record<string, readonly string[]>>,
  choferes: readonly { id: string; capacidad?: number | null }[] | null = null,
): RutaVista[] {
  const esBuilder = new Set(ordenes.filter((o) => o.builder).map((o) => o.id));
  const capacidadDe = new Map((choferes ?? []).map((c) => [c.id, c.capacidad != null && Number(c.capacidad) > 0 ? Number(c.capacidad) : null]));
  const porChofer = new Map<string, ParadaGuardada[]>();
  // Una parada sin chofer (se borró su perfil: `on delete set null`) no es de nadie: se agrupa por el nombre.
  for (const p of paradas) {
    const k = p.driver_id ?? `nombre:${p.driver_name}`;
    porChofer.set(k, [...(porChofer.get(k) ?? []), p]);
  }
  const rutas: RutaVista[] = [];
  for (const [choferId, suyas] of porChofer) {
    const enOrden = [...suyas].sort((a, b) => a.seq - b.seq);
    const capacidad = capacidadDe.get(choferId) ?? null;
    // La cuenta, de lo que guardó el motor: cada parada cambia la carga de la anterior a la suya (`load_after`).
    let previa = 0;
    const cambios = enOrden.map((p) => { const c = centesimas(Number(p.load_after) - previa); previa = Number(p.load_after); return c; });
    const cuenta = cuentaDePallets(cambios, capacidad);
    const vistas = enOrden.map((p, i): ParadaVista => {
      const id = ordenDeLaParte(p.order_ref);
      const hermanas = partes[id];
      const numero = hermanas ? hermanas.indexOf(p.order_ref) + 1 : 0;
      return {
        ...p, load_after: Number(p.load_after), leg_miles: Number(p.leg_miles),
        aBordoAlLlegar: cuenta.paradas[i].antes, cuenta: cuenta.paradas[i], builder: esBuilder.has(id),
        carga: hermanas && hermanas.length > 1 && numero > 0 ? { numero, de: hermanas.length } : null,
      };
    });
    const primera = vistas[0], ultima = vistas[vistas.length - 1];
    rutas.push({
      choferId, chofer: primera.driver_name, capacidad, paradas: vistas, salida: cuenta.salida, regreso: cuenta.regreso,
      totales: {
        paradas: vistas.length, entregas: vistas.filter((p) => p.kind === "D").length,
        inicio: primera.eta, fin: ultima.etd, minutos: ultima.etd - primera.eta,
        manejoMin: vistas.reduce((s, p) => s + p.leg_minutes, 0), millas: centesimas(vistas.reduce((s, p) => s + p.leg_miles, 0)),
        esperaMin: vistas.reduce((s, p) => s + p.wait_min, 0), tardeMin: vistas.reduce((s, p) => s + p.late_min, 0),
        palletsMax: cuenta.totales.cargaMaxima, palletsMovidos: cuenta.totales.palletsMovidos,
        paradasConExceso: cuenta.totales.paradasConExceso, finalNoCero: cuenta.totales.finalNoCero,
      },
    });
  }
  return rutas.sort((a, b) => (a.chofer < b.chofer ? -1 : a.chofer > b.chofer ? 1 : a.choferId < b.choferId ? -1 : 1));
}
