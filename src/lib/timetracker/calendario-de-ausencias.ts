/**
 * Fechas del calendario de ausencias de la bandeja de fichaje (D-1155, ayuda de Roberto,
 * 24 nov 2026): quién falta en qué días.
 *
 * Todo son fechas `YYYY-MM-DD` y toda la aritmética va en UTC. Una fecha de solo día no tiene
 * hora, así que pasarla por la zona local podía correrla un día según dónde esté el navegador.
 */

export type Ausencia = {
  id: string;
  nombre: string;
  type: string;
  start_date: string;
  end_date: string;
  status: string;
};

/** Una persona fuera ese día. `pendiente` = la solicitud todavía no está aprobada. */
export type Ausente = { id: string; nombre: string; pendiente: boolean; tipo: string };

export type DiaDeCuadricula = { fecha: string; dia: number; delMes: boolean; hoy: boolean };

const DIA_MS = 86_400_000;
const CASILLAS = 42; // 6 semanas: cabe cualquier mes y la altura no salta de un mes a otro.

/** Solo cuentan estas: un cambio de horario o un intercambio de turno no saca a nadie del día. */
const TIPOS_DE_AUSENCIA = ["vacation", "sick"];
/** Aprobada o pendiente. Denegada o cancelada no dejan a nadie fuera. */
const ESTADOS_QUE_CUENTAN = ["approved", "pending"];

function epoch(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fechaDeEpoch(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** La fecha `n` días después (o antes, si `n` es negativo), en UTC. */
export function sumarDias(fecha: string, n: number): string {
  return fechaDeEpoch(epoch(fecha) + n * DIA_MS);
}

/**
 * Cuadrícula de 6×7 para un mes. `mes` va de 1 a 12 y la semana empieza en domingo. Incluye los
 * días de los meses vecinos que completan la primera y la última semana (`delMes` = false).
 */
export function cuadriculaDelMes(anio: number, mes: number, hoy: string): DiaDeCuadricula[] {
  const primero = Date.UTC(anio, mes - 1, 1);
  const inicio = primero - new Date(primero).getUTCDay() * DIA_MS;
  const mesISO = fechaDeEpoch(primero).slice(0, 7);
  return Array.from({ length: CASILLAS }, (_, i) => {
    const fecha = fechaDeEpoch(inicio + i * DIA_MS);
    return { fecha, dia: Number(fecha.slice(8)), delMes: fecha.startsWith(mesISO), hoy: fecha === hoy };
  });
}

/** El mes anterior (delta -1) o el siguiente (delta 1), con el salto de año resuelto. */
export function mesVecino(anio: number, mes: number, delta: number): { anio: number; mes: number } {
  const total = anio * 12 + (mes - 1) + delta;
  const anioNuevo = Math.floor(total / 12);
  return { anio: anioNuevo, mes: total - anioNuevo * 12 + 1 };
}

/** Para cada fecha pedida, quién está fuera. Una solicitud cubre desde start_date hasta end_date, las dos incluidas. */
export function ausentesPorDia(ausencias: Ausencia[], fechas: string[]): Map<string, Ausente[]> {
  const validas = ausencias.filter((a) => TIPOS_DE_AUSENCIA.includes(a.type) && ESTADOS_QUE_CUENTAN.includes(a.status));
  const mapa = new Map<string, Ausente[]>();
  for (const fecha of fechas) {
    const fuera = validas
      .filter((a) => a.start_date <= fecha && fecha <= a.end_date)
      .map((a) => ({ id: a.id, nombre: a.nombre, pendiente: a.status === "pending", tipo: a.type }))
      .sort((x, y) => x.nombre.localeCompare(y.nombre));
    if (fuera.length) mapa.set(fecha, fuera);
  }
  return mapa;
}

/** Lo que cabe en una celda: hasta `max` personas, y el resto como número para «+N más». */
export function recorteDeDia(ausentes: Ausente[], max = 3): { visibles: Ausente[]; restantes: number } {
  return { visibles: ausentes.slice(0, max), restantes: Math.max(0, ausentes.length - max) };
}
