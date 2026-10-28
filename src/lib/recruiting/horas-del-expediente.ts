/**
 * Las horas y los pagos del Time Tracker dentro del expediente de RR. HH. (D-686).
 *
 * Funciones puras: la acción de servidor lee las filas crudas y esto decide cómo se pintan.
 * Nada de esto escribe en la base.
 *
 * - Horas: salen de la vista `timetracker.period_hours` (086), que ya junta fichaje (clock-in)
 *   y horas de proyecto por semana de pago (viernes a jueves). No se suman entre sí: la vista
 *   avisa con `revisar` cuando alguien tiene las dos cosas la misma semana, y aquí se respeta.
 * - Pagos: los talones (`paystubs`, 170) y los lotes de nómina (`payrolls`, 059). Un lote que ya
 *   tiene talón NO se cuenta otra vez: el talón es el mismo pago, con más detalle.
 */

export type FilaHoras = {
  period_start: string;
  period_end: string;
  horas_fichaje: number | string | null;
  horas_proyecto: number | string | null;
  revisar: boolean | null;
};

export type FilaLote = {
  id: string;
  week_of: string | null;
  method: string | null;
  total: number | string | null;
  paid: boolean | null;
  paid_at: string | null;
  draft: boolean | null;
  created_at: string;
};

export type FilaTalon = {
  id: string;
  kind: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  method: string | null;
  regular_hours: number | string | null;
  ot_hours: number | string | null;
  gross: number | string | null;
  net: number | string | null;
  payroll_id: string | null;
};

export type SemanaDeHoras = {
  desde: string;
  hasta: string;
  fichaje: number;
  proyecto: number;
  revisar: boolean;
};

export type Pago = {
  id: string;
  origen: "talon" | "lote";
  /** Fecha que ordena: la de pago si la hay, si no la del periodo. */
  fecha: string;
  periodo: string | null;
  metodo: string | null;
  horas: number | null;
  monto: number;
  pagado: boolean;
};

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Semanas de la más reciente a la más vieja. */
export function semanasDeHoras(filas: FilaHoras[]): SemanaDeHoras[] {
  return filas
    .map((f) => ({
      desde: f.period_start,
      hasta: f.period_end,
      fichaje: r2(num(f.horas_fichaje)),
      proyecto: r2(num(f.horas_proyecto)),
      revisar: !!f.revisar,
    }))
    .sort((a, b) => (a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : 0));
}

export function totalesDeHoras(semanas: SemanaDeHoras[]): { fichaje: number; proyecto: number; semanas: number } {
  return {
    fichaje: r2(semanas.reduce((s, x) => s + x.fichaje, 0)),
    proyecto: r2(semanas.reduce((s, x) => s + x.proyecto, 0)),
    semanas: semanas.length,
  };
}

/**
 * Talones + lotes en una sola lista, del más reciente al más viejo. Los borradores no son
 * pagos y no salen; un lote con talón sale una vez, como talón.
 */
export function pagosDelEmpleado(lotes: FilaLote[], talones: FilaTalon[]): Pago[] {
  const conTalon = new Set(talones.map((t) => t.payroll_id).filter(Boolean) as string[]);
  const deTalones: Pago[] = talones.map((t) => ({
    id: t.id,
    origen: "talon",
    fecha: t.pay_date,
    periodo: `${t.period_start} – ${t.period_end}`,
    metodo: t.method,
    horas: r2(num(t.regular_hours) + num(t.ot_hours)),
    monto: r2(num(t.net)),
    pagado: true,
  }));
  const deLotes: Pago[] = lotes
    .filter((l) => !l.draft && !conTalon.has(l.id))
    .map((l) => ({
      id: l.id,
      origen: "lote",
      fecha: (l.paid_at ?? l.week_of ?? l.created_at).slice(0, 10),
      periodo: l.week_of,
      metodo: l.method,
      horas: null,
      monto: r2(num(l.total)),
      pagado: !!l.paid,
    }));
  return [...deTalones, ...deLotes].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
}

/** Solo lo pagado suma; lo pendiente se enseña aparte. */
export function totalesDePagos(pagos: Pago[]): { pagado: number; pendiente: number } {
  return {
    pagado: r2(pagos.filter((p) => p.pagado).reduce((s, p) => s + p.monto, 0)),
    pendiente: r2(pagos.filter((p) => !p.pagado).reduce((s, p) => s + p.monto, 0)),
  };
}

export type SemanaConPago = SemanaDeHoras & { pago: Pago | null };

/**
 * D-NEXT: una sola tabla, semana por semana, con su pago al lado (el dueño: «esas horas pueden ir en la misma cosa de
 * pagos, ahí mismo […] es lo mismo tener duplicado eso»). Un pago cae en la semana que empieza el día de su periodo
 * (el `week_of` del lote, el `period_start` del talón). Un pago que no casa con ninguna semana —otro inicio de semana,
 * un lote duplicado— sale en una fila propia sin horas, para que no se pierda. Un pago no se asigna dos veces.
 */
export function semanasConPago(semanas: SemanaDeHoras[], pagos: Pago[]): SemanaConPago[] {
  const inicio = (p: Pago) => (p.periodo ? p.periodo.slice(0, 10) : null);
  const usados = new Set<string>();
  const filas: SemanaConPago[] = semanas.map((s) => {
    const p = pagos.find((x) => inicio(x) === s.desde) ?? null;
    if (p) usados.add(p.id);
    return { ...s, pago: p };
  });
  for (const p of pagos) {
    if (usados.has(p.id)) continue;
    filas.push({ desde: inicio(p) ?? p.fecha, hasta: "", fichaje: 0, proyecto: 0, revisar: false, pago: p });
  }
  return filas.sort((a, b) => (a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : 0));
}
