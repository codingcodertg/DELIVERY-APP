// Los fichajes de un periodo, agrupados por día (Nómina · En sitio · partes de fichaje).
//
// Pura: no toca la base ni el DOM. La aritmética de horas no se recalcula aquí: cada día
// suma `entryMinutes` de sus fichajes, la misma función que usan la tabla y `summarize`, así
// que los totales de los días suman exactamente el total del periodo (no se paga el hueco de
// la comida ni el de un recado entre dos fichajes).
//
// El día es el de la ENTRADA en hora de Texas (America/Chicago), no el UTC ni el del navegador.
// Un turno que cruza la medianoche pertenece al día en que empezó.

import { formateadorDeFecha } from "@/lib/formateador";
import { entryMinutes, type PayEntry } from "@/lib/clockin/payroll";

export type DiaDeTurnos = {
  /** Día calendario en Texas, `YYYY-MM-DD`. */
  dia: string;
  /** Los fichajes del día, por hora de entrada (ascendente). */
  entradas: PayEntry[];
  /** Hora de entrada más temprana del día (ISO UTC). */
  primeraEntrada: string;
  /** Salida más tardía entre los fichajes cerrados, o `null` si todos están abiertos. */
  ultimaSalida: string | null;
  /** Algún fichaje del día no tiene salida. */
  abierta: boolean;
  /** Suma de `entryMinutes` de los fichajes del día. */
  minutos: number;
  /** Algún fichaje del día es manual. */
  manual: boolean;
  /** Las notas de edición no vacías, sin repetir, en orden. */
  notas: string[];
};

const formatoDia = () =>
  formateadorDeFecha("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

/** Día calendario en Texas (`YYYY-MM-DD`) de un instante ISO. */
export function diaDeTexas(iso: string): string {
  return formatoDia().format(new Date(iso));
}

export function turnosPorDia(entradas: readonly PayEntry[]): DiaDeTurnos[] {
  const porDia = new Map<string, PayEntry[]>();
  for (const e of entradas) {
    const dia = diaDeTexas(e.clock_in_at);
    const lista = porDia.get(dia);
    if (lista) lista.push(e);
    else porDia.set(dia, [e]);
  }

  const dias: DiaDeTurnos[] = [];
  for (const [dia, lista] of porDia) {
    const delDia = [...lista].sort((a, b) => Date.parse(a.clock_in_at) - Date.parse(b.clock_in_at));
    const cerradas = delDia.filter((e) => e.clock_out_at);
    const salidas = cerradas.map((e) => e.clock_out_at as string);
    const ultimaSalida = salidas.length
      ? salidas.reduce((max, s) => (Date.parse(s) > Date.parse(max) ? s : max))
      : null;
    const notas: string[] = [];
    for (const e of delDia) {
      const n = e.edit_note?.trim();
      if (n && !notas.includes(n)) notas.push(n);
    }
    dias.push({
      dia,
      entradas: delDia,
      primeraEntrada: delDia[0].clock_in_at,
      ultimaSalida,
      abierta: delDia.some((e) => !e.clock_out_at),
      minutos: delDia.reduce((s, e) => s + entryMinutes(e), 0),
      manual: delDia.some((e) => !!e.manual),
      notas,
    });
  }
  // Los fichajes llegan ascendentes del servidor; los días se mantienen en ese mismo orden.
  return dias.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
}
