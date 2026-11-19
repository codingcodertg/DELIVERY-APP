/**
 * «Paradas»: la bitácora del día del chofer (2026-11-19). Su pedido, resumido (no es cita): «a place to view his stops of the
 * day… It'll show clocked in, gas, food, stops, clock out. It's just a log, a breakdown per day. It's not the actual time
 * tracker… his deliveries are something else».
 *
 * Qué entra: el inicio y el fin del turno del día (`driver_shifts`, los que marca el chofer o el automático de la primera
 * carga) y cada parada registrada (`pausas_del_chofer`). NO entran entregas ni recogidas.
 *
 * Puro: sin React, sin red. Las horas van en ISO; el día del negocio lo decide quien llama (`centralWallToUtc`, igual que el
 * Recorrido). Lo que se pinta está en `app/(app)/stops/page.tsx`.
 */
import { centralWallToUtc } from "@/lib/clockin/tz";
import { shiftDateISO } from "@/lib/utils";
import { minutosDePausa, pideRecibo, puedeAnadirFotoDespues, sinReciboTodavia, type MotivoDePausa, type PausaDelChofer } from "@/lib/pausas-del-chofer";

/** Lo que de un turno importa aquí (un `DriverShift` lo cumple). */
export interface TurnoDelDia {
  id: string;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}

export interface ParadaDeLaLinea {
  tipo: "parada";
  id: string;
  motivo: MotivoDePausa;
  nota: string | null;
  desde: string;
  /** `null`: sigue parada. */
  hasta: string | null;
  minutos: number;
  enCurso: boolean;
  foto: string | null;
  monto: number | null;
  galones: number | null;
  sinRecibo: boolean;
  /** Gasolina sin recibo todavía (la que se cerró «recibo después»). */
  reciboPendiente: boolean;
  /** Se le puede añadir la foto (y el monto) ahora: cerrada, sin foto y sin «no tengo recibo». */
  puedeAnadirFoto: boolean;
}

export interface TurnoDeLaLinea {
  tipo: "turno-inicio" | "turno-fin";
  at: string;
  nota: string | null;
}

export type ItemDelDia = ParadaDeLaLinea | TurnoDeLaLinea;

/** Hora de un ítem (la de inicio, para una parada). */
export const horaDeItem = (i: ItemDelDia): string => (i.tipo === "parada" ? i.desde : i.at);

const ORDEN_DEL_TIPO: Record<ItemDelDia["tipo"], number> = { "turno-inicio": 0, parada: 1, "turno-fin": 2 };

/** Un ítem de parada, a partir de la fila. `ahora` cuenta los minutos de la que sigue parada. */
export function paradaDeLaLinea(p: PausaDelChofer, ahora: Date = new Date()): ParadaDeLaLinea {
  return {
    tipo: "parada",
    id: p.id,
    motivo: p.motivo,
    nota: p.nota,
    desde: p.empezo_at,
    hasta: p.termino_at,
    minutos: minutosDePausa(p, ahora),
    enCurso: !p.termino_at,
    foto: p.recibo_foto,
    monto: p.recibo_monto == null ? null : Number(p.recibo_monto),
    galones: pideRecibo(p.motivo) && p.recibo_galones != null ? Number(p.recibo_galones) : null,
    sinRecibo: p.sin_recibo,
    reciboPendiente: sinReciboTodavia(p),
    puedeAnadirFoto: puedeAnadirFotoDespues(p),
  };
}

export interface LineaDelDia {
  /** En orden de hora. Un turno que empezó va primero y uno que terminó, al final, si la hora empata. */
  items: ItemDelDia[];
  /** Hubo al menos un turno ese día. Sin él, la pantalla lo dice en vez de enseñar «inicio» de la nada. */
  huboTurno: boolean;
  /** El último turno del día sigue abierto (sin salida). */
  turnoAbierto: boolean;
}

/**
 * La línea de tiempo de un día: los turnos que empezaron en ese día y sus paradas, en orden. `turnos` y `paradas` ya vienen
 * filtrados al día y al chofer (quien llama lo hace con `limitesDelDia`).
 */
export function lineaDelDia(x: { turnos: readonly TurnoDelDia[]; paradas: readonly PausaDelChofer[]; ahora?: Date }): LineaDelDia {
  const ahora = x.ahora ?? new Date();
  const items: ItemDelDia[] = [];
  for (const t of x.turnos) {
    items.push({ tipo: "turno-inicio", at: t.started_at, nota: t.note });
    if (t.ended_at) items.push({ tipo: "turno-fin", at: t.ended_at, nota: t.note });
  }
  for (const p of x.paradas) items.push(paradaDeLaLinea(p, ahora));
  items.sort((a, b) => {
    const d = Date.parse(horaDeItem(a)) - Date.parse(horaDeItem(b));
    return d !== 0 ? d : ORDEN_DEL_TIPO[a.tipo] - ORDEN_DEL_TIPO[b.tipo];
  });
  return {
    items,
    huboTurno: x.turnos.length > 0,
    turnoAbierto: x.turnos.some((t) => !t.ended_at),
  };
}

export interface TotalesDelDia {
  /** Paradas del día (abiertas o cerradas, de cualquier motivo). */
  paradas: number;
  /** Minutos sumados de todas (una abierta cuenta hasta `ahora`). */
  minutos: number;
  /** Solo gasolina: lo pagado (suma de los montos) y los galones (suma). Con cero, no hubo gasolina registrada con esos datos. */
  gasolinaMonto: number;
  gasolinaGalones: number;
  /** Cuántas de gasolina todavía no tienen recibo. */
  recibosPendientes: number;
}

/** Los totales de arriba de la pantalla. Redondeo a centavos y a milésimas de galón. */
export function totalesDelDia(paradas: readonly PausaDelChofer[], ahora: Date = new Date()): TotalesDelDia {
  const t: TotalesDelDia = { paradas: 0, minutos: 0, gasolinaMonto: 0, gasolinaGalones: 0, recibosPendientes: 0 };
  for (const p of paradas) {
    t.paradas += 1;
    t.minutos += minutosDePausa(p, ahora);
    if (pideRecibo(p.motivo)) {
      if (p.recibo_monto != null) t.gasolinaMonto += Number(p.recibo_monto);
      if (p.recibo_galones != null) t.gasolinaGalones += Number(p.recibo_galones);
      if (sinReciboTodavia(p)) t.recibosPendientes += 1;
    }
  }
  t.gasolinaMonto = Math.round(t.gasolinaMonto * 100) / 100;
  t.gasolinaGalones = Math.round(t.gasolinaGalones * 1000) / 1000;
  return t;
}

/** ¿Se puede pasar al día siguiente desde `dia`? Nunca un día futuro: solo si `dia` es anterior a `hoy`. */
export const puedeIrAlDiaSiguiente = (dia: string, hoy: string): boolean => dia < hoy;

/** Los turnos que empezaron dentro del día [`desde`, `hasta`), con sus horas en ISO. */
export function turnosDelDia<T extends TurnoDelDia>(turnos: readonly T[], desde: string, hasta: string): T[] {
  const d = Date.parse(desde);
  const h = Date.parse(hasta);
  return turnos.filter((t) => {
    const s = Date.parse(t.started_at);
    return s >= d && s < h;
  });
}

/** Los límites [desde, hasta) de un día del negocio (America/Chicago), como en el Recorrido y en el hook de paradas. */
export const limitesDelDia = (dia: string): { desde: string; hasta: string } => ({
  desde: centralWallToUtc(`${dia}T00:00`),
  hasta: centralWallToUtc(`${shiftDateISO(dia, 1)}T00:00`),
});
