/**
 * «Resumen de choferes» del Panel (junta con el dueño, 2026-11-19): UNA tarjeta por chofer con ocho cifras, para un mes.
 *
 * El dueño: «quiero ver las cosas rápido… ocho puntos… ¿estoy llegando a mis KPIs?». Cada cifra sale de datos que ya
 * existen; si un dato no existe, la cifra sale «—» y la pantalla dice por qué. Las ocho:
 *
 *  1. Asistencia: días trabajados (días con turno fichado) y días tarde (primer turno del día después de la hora de
 *     entrada de Ajustes → Rutas, con `GRACIA_TARDE_MIN` de margen). Sin hora de entrada, «tarde» es «—».
 *  2. Entregas a clientes: entregadas (etapa «entregada»), sin traslados.
 *  3. Traslados entre tiendas: entregados, aparte (`traslados-de-chofer.ts`).
 *  4. Millas reales: las del rastro GPS (camión o teléfono, `millasDelDia`). Si el chofer no tiene ningún día con rastro,
 *     las del sistema (`route_miles` de sus órdenes), y la fuente se dice en pantalla.
 *  5. Ingreso por milla: ingresos de sus órdenes ÷ las millas del SISTEMA (route_miles), igual que la tabla de choferes.
 *     No se divide entre las GPS: el rastro puede faltar en algunos días y el ingreso es del mes entero (inflaba la cifra).
 *  6. Piezas dañadas contra el máximo: SIN FUENTE. La merma se registra por tienda, no por chofer (`warehouse_reports`).
 *     Por eso siempre sale «—». El máximo (`MAX_DANOS_MES`) queda listo para cuando haya de dónde sacar el dato.
 *  7. Tiempo productivo: tiempo activo (salida o recogida → entregado) ÷ tiempo en turno.
 *  8. A tiempo: entregas a cliente entregadas dentro de su ventana ÷ entregas con fecha y ventana.
 *
 * Puro: sin base, sin React, sin reloj (el «ahora» entra por parámetro).
 */
import type { Delivery, DriverShift } from "./types";
import type { OrderTypeRules } from "./required";
import { driverKpis, driverShiftKpis, inDateRange } from "./analytics";
import { esTraslado } from "./traslados-de-chofer";
import { redondeaDinero } from "./totales";

/** Máximo de piezas dañadas por chofer al mes. El valor de ejemplo de la junta (30); el dueño lo confirma. */
export const MAX_DANOS_MES = 30;
/** Minutos de margen antes de contar un día como tarde. Propuesto (no estaba en la junta); el dueño lo confirma. */
export const GRACIA_TARDE_MIN = 10;

export type FuenteDeMillas = "gps" | "sistema";

/** Lo que el resumen sabe de un chofer por el rastro GPS del mes (de `tarjetasDeChoferes`). */
export interface MillasGpsDeChofer { millas: number; diasConRastro: number; dias: number }

export interface EntradaDeResumen {
  /** Las órdenes del Panel (ya filtradas por alcance de tienda). El rango lo pone `desde`/`hasta`. */
  ordenes: readonly Delivery[];
  /** Todos los turnos que se tengan; aquí se filtran al mes. */
  turnos: readonly DriverShift[];
  /** Cada chofer: su id de perfil, su nombre (el que va en `assigned_driver`) y su hora de entrada en minutos
   *  desde medianoche (`null` si Ajustes no la tiene). */
  choferes: readonly { id: string; nombre: string; entradaMin: number | null }[];
  /** El mes, como día inicial y final inclusive (`YYYY-MM-DD`). */
  desde: string;
  hasta: string;
  reglas?: OrderTypeRules;
  /** Día local del negocio (`YYYY-MM-DD`) de un instante, y minutos desde medianoche local. */
  diaLocal: (ms: number) => string;
  minutoLocal: (ms: number) => number;
  /** Millas GPS por nombre de chofer. `null` si no se pudo leer el rastro: todas las millas salen del sistema. */
  gps: ReadonlyMap<string, MillasGpsDeChofer> | null;
  ahora?: number;
}

export interface FilaDeResumen {
  chofer: string;
  diasTrabajados: number;
  /** `null` si no hay hora de entrada programada para este chofer. */
  diasTarde: number | null;
  entregas: number;
  traslados: number;
  /** `null` si no hay ni rastro GPS ni órdenes con millas. */
  millas: number | null;
  fuenteMillas: FuenteDeMillas | null;
  /** Días con rastro GPS (de los días en que trabajó) para decir cuánto dato hay detrás de las millas. */
  diasConRastro: number;
  diasConTurno: number;
  ingresoPorMilla: number | null;
  danos: null;
  productivoPct: number | null;
  aTiempoPct: number | null;
}

/** Cuenta los días tarde: por cada día, el primer turno contra la hora de entrada. */
export function diasTardeDe(
  turnos: readonly DriverShift[],
  entradaMin: number | null,
  diaLocal: (ms: number) => string,
  minutoLocal: (ms: number) => number,
): number | null {
  if (entradaMin == null) return null;
  const primeroDelDia = new Map<string, number>();
  for (const t of turnos) {
    const ms = new Date(t.started_at).getTime();
    if (!Number.isFinite(ms)) continue;
    const dia = diaLocal(ms);
    const min = minutoLocal(ms);
    const previo = primeroDelDia.get(dia);
    if (previo == null || min < previo) primeroDelDia.set(dia, min);
  }
  let tarde = 0;
  for (const min of primeroDelDia.values()) if (min > entradaMin + GRACIA_TARDE_MIN) tarde++;
  return tarde;
}

/** Una fila por chofer con actividad en el mes (orden o turno), por nombre. */
export function resumenDeChoferes(e: EntradaDeResumen): FilaDeResumen[] {
  const ordenesMes = inDateRange([...e.ordenes], e.desde, e.hasta);
  const turnosMes = e.turnos.filter((t) => {
    const ms = new Date(t.started_at).getTime();
    if (!Number.isFinite(ms)) return false;
    const dia = e.diaLocal(ms);
    return dia >= e.desde && dia <= e.hasta;
  });
  const nombrePorId = new Map(e.choferes.map((c) => [c.id, c.nombre]));
  const entradaPorNombre = new Map(e.choferes.map((c) => [c.nombre, c.entradaMin]));

  const kpis = driverKpis(ordenesMes, () => 0, undefined, e.reglas);
  const activos = driverShiftKpis(
    turnosMes, ordenesMes, (id) => nombrePorId.get(id), e.ahora ?? Date.now(),
    (d) => !esTraslado(d.order_type, e.reglas),
  );
  const productivoPorNombre = new Map(activos.map((a) => [a.driver, a.activePct]));

  const nombres = new Set<string>([
    ...kpis.map((k) => k.driver),
    ...turnosMes.map((t) => nombrePorId.get(t.driver_id)).filter((n): n is string => !!n),
  ]);
  return [...nombres].sort((a, b) => a.localeCompare(b)).map((chofer): FilaDeResumen => {
    const k = kpis.find((x) => x.driver === chofer);
    const turnos = turnosMes.filter((t) => nombrePorId.get(t.driver_id) === chofer);
    const dias = new Set(turnos.map((t) => e.diaLocal(new Date(t.started_at).getTime())));
    const gps = e.gps?.get(chofer);
    const usaGps = !!gps && gps.diasConRastro > 0 && gps.millas > 0;
    const millasSistema = k && k.miles > 0 ? k.miles : null;
    const millas = usaGps ? gps!.millas : millasSistema;
    const ingresos = k?.revenue ?? 0;
    return {
      chofer,
      diasTrabajados: dias.size,
      diasTarde: diasTardeDe(turnos, entradaPorNombre.get(chofer) ?? null, e.diaLocal, e.minutoLocal),
      entregas: k?.delivered ?? 0,
      traslados: k?.transfersDelivered ?? 0,
      millas: millas == null ? null : Math.round(millas * 10) / 10,
      fuenteMillas: millas == null ? null : usaGps ? "gps" : "sistema",
      diasConRastro: usaGps ? gps!.diasConRastro : 0,
      diasConTurno: dias.size,
      ingresoPorMilla: millasSistema ? redondeaDinero(ingresos / millasSistema) : null,
      danos: null,
      productivoPct: productivoPorNombre.get(chofer) ?? null,
      aTiempoPct: k?.onTimePct ?? null,
    };
  });
}

/** Las millas GPS por chofer, desde las tarjetas del rastro (solo los que tienen millas medidas). */
export function millasGpsPorChofer(
  tarjetas: readonly { chofer: string; millas: number | null; diasConRastro: number; dias: number }[],
): Map<string, MillasGpsDeChofer> {
  const m = new Map<string, MillasGpsDeChofer>();
  for (const t of tarjetas) if (t.millas != null) m.set(t.chofer, { millas: t.millas, diasConRastro: t.diasConRastro, dias: t.dias });
  return m;
}
