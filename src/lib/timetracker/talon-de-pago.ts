// ============================================================
// Talones de pago de Time Tracker (D-NEXT): todo lo que decide una cifra vive aquí, para que las
// pruebas lo IMPORTEN en vez de copiarlo.
//
// Pedido del dueño (2026-10-13): «haz los paystubs para el time tracker app». La cuadrilla que ficha
// en sitio no tenía tarifa en la app, y se le paga directo, sin retenciones: el talón de la app ES el
// talón oficial. Por eso aquí no hay ni una línea de impuestos, y no se debe inventar ninguna.
//
// Dos orígenes:
//  - **Presencial**: los minutos del periodo salen de `summarize` (lib/clockin/payroll.ts, la misma
//    aritmética de la pantalla de Nómina › Presencial) y se multiplican por la tarifa de la persona
//    (`timetracker.pay_rates`, migración 170). Las extras no se recalculan aquí: las da `summarize`,
//    con el umbral de la persona.
//  - **Remoto**: el lote ya pagado (`timetracker.payrolls`) y sus líneas por proyecto, calculadas con
//    `lineasDeNomina` —que es el `calcLinesFor` de ManagerReports movido aquí tal cual—.
//
// Un talón guardado es una FOTO: no se recalcula nunca (ver `decideTalones`).
// ============================================================

import { computePay, projectWeekStart, weekStartISO } from "@/lib/timetracker/helpers";
import { sumaDeAjustes, totalConAjustes } from "@/lib/timetracker/total-de-nomina";
import type { Assignment, PayrollAdjustment, Project, Session } from "@/lib/timetracker/types";
import { OT_WEEKLY_MIN, summarize, type PayEntry } from "@/lib/clockin/payroll";

export type TipoDeTalon = "onsite" | "remote";

/** Una línea por proyecto en el talón del remoto. */
export interface LineaDeTalon {
  label: string;
  regular: number;
  ot: number;
  rate: number;
  otRate: number;
  pay: number;
}

/** La fila de `timetracker.paystubs`, en camelCase (rowcase.ts). */
export interface TalonDePago {
  id?: string;
  employeeUid: string;
  employeeName: string | null;
  kind: TipoDeTalon;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  method: string | null;
  regularHours: number;
  otHours: number;
  hourlyRate: number | null;
  otRate: number | null;
  lines: LineaDeTalon[];
  gross: number;
  adjustments: PayrollAdjustment[];
  net: number;
  payrollId: string | null;
  createdAt?: string;
}

/** La tarifa de una persona (`timetracker.pay_rates`). */
export interface TarifaPorHora {
  hourlyRate: number;
  otMultiplier: number;
  otWeeklyHours: number;
}

/** 1.5× pasadas 40 h a la semana: la regla federal de horas extra (FLSA). Editable por persona. */
export const TARIFA_POR_DEFECTO: Omit<TarifaPorHora, "hourlyRate"> = { otMultiplier: 1.5, otWeeklyHours: 40 };

export const round2 = (n: number): number => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

// ------------------------------------------------------------
// Presencial
// ------------------------------------------------------------

export interface PagoPresencial {
  regularHours: number;
  otHours: number;
  hourlyRate: number;
  otRate: number;
  regularPay: number;
  otPay: number;
  gross: number;
}

/**
 * El dinero de un periodo de fichaje. Las horas se redondean a dos decimales ANTES de multiplicar
 * —como se imprimen—, y cada importe a céntimos, para que en el papel horas × tarifa dé el importe y
 * la suma de los dos importes dé el bruto, sin un céntimo de diferencia.
 */
export function pagoPresencial(
  min: { regularMin: number; otMin: number },
  tarifa: { hourlyRate: number; otMultiplier?: number | null },
): PagoPresencial {
  const hourlyRate = round2(tarifa.hourlyRate);
  const mult = tarifa.otMultiplier == null ? TARIFA_POR_DEFECTO.otMultiplier : Number(tarifa.otMultiplier);
  const otRate = round2(hourlyRate * mult);
  const regularHours = round2(min.regularMin / 60);
  const otHours = round2(min.otMin / 60);
  const regularPay = round2(regularHours * hourlyRate);
  const otPay = round2(otHours * otRate);
  return { regularHours, otHours, hourlyRate, otRate, regularPay, otPay, gross: round2(regularPay + otPay) };
}

/** Los fichajes de una persona en el periodo → su pago, con SU umbral de extras. */
export function presencialDeFichajes(entries: PayEntry[], tarifa: TarifaPorHora): PagoPresencial & { openCount: number; totalMin: number } {
  const umbral = tarifa.otWeeklyHours > 0 ? tarifa.otWeeklyHours * 60 : OT_WEEKLY_MIN;
  const s = summarize(entries, umbral);
  return { ...pagoPresencial(s, tarifa), openCount: s.openCount, totalMin: s.totalMin };
}

// ------------------------------------------------------------
// Remoto
// ------------------------------------------------------------

export type LineaDeNomina = {
  aid: string;
  a: Assignment | undefined;
  g: { sec: number; active: number };
  calc: { reg: number; ot: number; pay: number; overLimit: number };
};

/**
 * Las líneas de pago de un grupo de sesiones, una por asignación, con las extras por semana del
 * proyecto. Es el `calcLinesFor` de ManagerReports movido aquí sin cambiarlo, para que el talón y la
 * pantalla calculen con la misma función.
 */
export function lineasDeNomina(
  sess: Session[],
  aMap: Map<string, Assignment>,
  pMap: Map<string, Project>,
): { lines: LineaDeNomina[]; pay: number; sec: number } {
  const byA = new Map<string, { sec: number; active: number; weeks: Map<string, number> }>();
  sess.forEach((s) => {
    const aid = s.assignmentId ?? "";
    if (!byA.has(aid)) byA.set(aid, { sec: 0, active: 0, weeks: new Map() });
    const g = byA.get(aid)!;
    g.sec += s.durationSeconds || 0;
    g.active += s.activeSeconds || 0;
    const proj = pMap.get(aMap.get(aid)?.projectId ?? "");
    const w = weekStartISO(s.date ?? "", projectWeekStart(proj));
    g.weeks.set(w, (g.weeks.get(w) ?? 0) + (s.durationSeconds || 0));
  });
  let pay = 0, sec = 0;
  const lines = Array.from(byA.entries()).map(([aid, g]) => {
    const a = aMap.get(aid);
    let reg = 0, ot = 0, p = 0, overLimit = 0;
    g.weeks.forEach((wsec) => {
      const c = a ? computePay(wsec / 3600, a) : { pay: 0, reg: 0, ot: 0, overLimit: 0 };
      reg += c.reg; ot += c.ot; p += c.pay; overLimit += c.overLimit;
    });
    pay += p; sec += g.sec;
    return { aid, a, g: { sec: g.sec, active: g.active }, calc: { reg, ot, pay: p, overLimit } };
  });
  return { lines, pay, sec };
}

/** Las líneas calculadas, en la forma que se guarda en el talón. `etiqueta` la pone la pantalla. */
export function lineasDelTalon(lines: LineaDeNomina[], etiqueta: (l: LineaDeNomina) => string): LineaDeTalon[] {
  return lines.map((l) => {
    const c = l.a ? computePay(0, l.a) : { rate: 0, otRate: 0 };
    return {
      label: etiqueta(l),
      regular: round2(l.calc.reg),
      ot: round2(l.calc.ot),
      rate: round2(c.rate),
      otRate: round2(c.otRate),
      pay: round2(l.calc.pay),
    };
  });
}

/** Lo que hace falta del lote pagado. Un `Payroll` entero encaja. */
export type LotePagado = {
  id: string;
  employeeUid: string;
  employeeName: string | null;
  weekOf: string | null;
  method: string | null;
  total?: number | null;
  adjustments?: PayrollAdjustment[] | null;
};

/**
 * El talón del remoto a partir del lote pagado.
 *
 * **Lo que se pagó manda**: el bruto es el `total` del lote, no la suma de las líneas recalculadas.
 * En el caso normal son lo mismo (markPaid guarda como total esa misma suma); si alguien cambió una
 * tarifa después de pagar, las líneas ya no cuadran con lo pagado y `cuadra` lo dice, en vez de que
 * el talón enseñe una cifra que nadie pagó. Un lote sin `total` cae en las líneas, como el recibo.
 */
export function talonRemoto(
  lote: LotePagado,
  lineas: LineaDeTalon[],
  f: { periodEnd: string; payDate: string },
): { talon: TalonDePago; cuadra: boolean } {
  const suma = round2(lineas.reduce((n, l) => n + l.pay, 0));
  const tieneTotal = lote.total != null;
  const gross = tieneTotal ? round2(Number(lote.total)) : suma;
  const adjustments = lote.adjustments || [];
  const tarifas = Array.from(new Set(lineas.map((l) => l.rate)));
  const extras = Array.from(new Set(lineas.map((l) => l.otRate)));
  const talon: TalonDePago = {
    employeeUid: lote.employeeUid,
    employeeName: lote.employeeName,
    kind: "remote",
    periodStart: lote.weekOf ?? "",
    periodEnd: f.periodEnd,
    payDate: f.payDate,
    method: lote.method || null,
    regularHours: round2(lineas.reduce((n, l) => n + l.regular, 0)),
    otHours: round2(lineas.reduce((n, l) => n + l.ot, 0)),
    hourlyRate: tarifas.length === 1 ? tarifas[0] : null,
    otRate: extras.length === 1 ? extras[0] : null,
    lines: lineas,
    gross,
    adjustments,
    net: neto(gross, adjustments),
    payrollId: lote.id,
  };
  // Tolerancia de un céntimo por línea: cada línea se guarda redondeada y el total, entero.
  const cuadra = !tieneTotal || Math.abs(suma - gross) <= 0.01 * Math.max(1, lineas.length);
  return { talon, cuadra };
}

// ------------------------------------------------------------
// Comunes
// ------------------------------------------------------------

/** Neto = bruto + ajustes. La suma es la de `total-de-nomina.ts` (D-504): no hay una segunda. */
export function neto(gross: number, adjustments: PayrollAdjustment[] | null | undefined): number {
  return round2(totalConAjustes(gross, adjustments));
}

export interface Acumulado { gross: number; adjustments: number; net: number }

/**
 * Lo acumulado en el año: los talones de ESA persona con inicio de periodo en ese año natural, hasta
 * el periodo dado incluido. Se suman los dos tipos: es lo que se le pagó a la persona.
 */
export function acumuladoDelAnio(stubs: TalonDePago[], employeeUid: string, year: number, hastaPeriodo: string): Acumulado {
  const anio = String(year);
  const suyos = stubs.filter((s) => s.employeeUid === employeeUid && s.periodStart.slice(0, 4) === anio && s.periodStart <= hastaPeriodo);
  return {
    gross: round2(suyos.reduce((n, s) => n + Number(s.gross || 0), 0)),
    adjustments: round2(suyos.reduce((n, s) => n + sumaDeAjustes(s.adjustments), 0)),
    net: round2(suyos.reduce((n, s) => n + Number(s.net || 0), 0)),
  };
}

const claveDe = (t: Pick<TalonDePago, "employeeUid" | "kind" | "periodStart">) => `${t.employeeUid}|${t.kind}|${t.periodStart}`;

/**
 * La regla de la foto: un talón que ya existe para esa persona, ese tipo y ese periodo **se reutiliza
 * tal cual, no se recalcula**. Lo que se imprimió y se entregó es lo que se pagó; si las horas o la
 * tarifa cambian después, el papel que tiene la persona no puede dejar de coincidir con la base.
 */
export function decideTalones(existentes: TalonDePago[], calculados: TalonDePago[]): { aGuardar: TalonDePago[]; aImprimir: TalonDePago[] } {
  const ya = new Map(existentes.map((t) => [claveDe(t), t]));
  const aGuardar: TalonDePago[] = [];
  const aImprimir = calculados.map((c) => {
    const previo = ya.get(claveDe(c));
    if (previo) return previo;
    aGuardar.push(c);
    return c;
  });
  return { aGuardar, aImprimir };
}

export interface PersonaPresencial { id: string; name: string; method: string | null; entries: PayEntry[] }

/**
 * Los talones de la semana del presencial. Quién se queda fuera, y por qué, sale en listas para que
 * la pantalla lo diga: sin tarifa, con un fichaje sin salida (sus horas no estarían completas) o sin
 * horas. Quien ya tiene talón guardado sale con el guardado, tenga ahora tarifa o no.
 */
export function talonesPresenciales(args: {
  personas: PersonaPresencial[];
  tarifas: Map<string, TarifaPorHora>;
  existentes: TalonDePago[];
  periodStart: string;
  periodEnd: string;
  payDate: string;
}): { aGuardar: TalonDePago[]; aImprimir: TalonDePago[]; sinTarifa: string[]; conAbiertos: string[] } {
  const { personas, tarifas, existentes, periodStart, periodEnd, payDate } = args;
  const guardados = new Map(existentes.filter((t) => t.kind === "onsite" && t.periodStart === periodStart).map((t) => [t.employeeUid, t]));
  const sinTarifa: string[] = [];
  const conAbiertos: string[] = [];
  const calculados: TalonDePago[] = [];
  for (const p of personas) {
    const previo = guardados.get(p.id);
    if (previo) { calculados.push(previo); continue; }
    const tarifa = tarifas.get(p.id);
    if (!tarifa) { sinTarifa.push(p.name); continue; }
    const pago = presencialDeFichajes(p.entries, tarifa);
    if (pago.openCount > 0) { conAbiertos.push(p.name); continue; }
    if (pago.totalMin <= 0) continue;
    calculados.push({
      employeeUid: p.id, employeeName: p.name, kind: "onsite", periodStart, periodEnd, payDate, method: p.method,
      regularHours: pago.regularHours, otHours: pago.otHours, hourlyRate: pago.hourlyRate, otRate: pago.otRate,
      lines: [], gross: pago.gross, adjustments: [], net: neto(pago.gross, []), payrollId: null,
    });
  }
  return { ...decideTalones(existentes, calculados), sinTarifa, conAbiertos };
}

/** Una fila de la base → talón con números de verdad (numeric puede llegar como texto). */
export function talonDeFila(r: Record<string, unknown>): TalonDePago {
  const num = (v: unknown) => Number(v ?? 0) || 0;
  const numONulo = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: r.id as string,
    employeeUid: r.employeeUid as string,
    employeeName: (r.employeeName as string) ?? null,
    kind: r.kind as TipoDeTalon,
    periodStart: String(r.periodStart ?? ""),
    periodEnd: String(r.periodEnd ?? ""),
    payDate: String(r.payDate ?? ""),
    method: (r.method as string) ?? null,
    regularHours: num(r.regularHours),
    otHours: num(r.otHours),
    hourlyRate: numONulo(r.hourlyRate),
    otRate: numONulo(r.otRate),
    lines: ((r.lines as LineaDeTalon[] | null) ?? []).map((l) => ({ ...l, regular: num(l.regular), ot: num(l.ot), rate: num(l.rate), otRate: num(l.otRate), pay: num(l.pay) })),
    gross: num(r.gross),
    adjustments: (r.adjustments as PayrollAdjustment[] | null) ?? [],
    net: num(r.net),
    payrollId: (r.payrollId as string) ?? null,
    createdAt: r.createdAt as string | undefined,
  };
}

// ------------------------------------------------------------
// El documento imprimible
// ------------------------------------------------------------

export interface Empresa {
  name: string;
  address?: string | null;
  phone?: string | null;
  taxId?: string | null;
  email?: string | null;
  currency?: string | null;
}

/** Todo texto que venga de una persona (nombres, rótulos, métodos) pasa por aquí antes de ir al HTML. */
export function escapa(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function dinero(n: number, moneda: string): string {
  const v = round2(n);
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "-" : "") + moneda + " " + abs;
}
const conSigno = (n: number, moneda: string) => (round2(n) < 0 ? dinero(n, moneda) : "+" + dinero(n, moneda));
const horas = (n: number) => round2(n).toFixed(2);

function fechaCorta(iso: string, lang: "en" | "es"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(lang === "es" ? "es" : "en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function seccionDelTalon(t: TalonDePago, empresa: Empresa, acumulado: Acumulado, lang: "en" | "es"): string {
  const T = (en: string, es: string) => (lang === "es" ? es : en);
  const m = empresa.currency || "$";
  const tipo = t.kind === "onsite" ? T("On-site", "Presencial") : T("Remote", "Remoto");

  const filas: string[] = [];
  if (t.kind === "onsite") {
    const rate = t.hourlyRate ?? 0;
    const otRate = t.otRate ?? 0;
    filas.push(`<tr><td>${T("Regular hours", "Horas regulares")}</td><td class="n">${horas(t.regularHours)}</td><td class="n">${dinero(rate, m)}</td><td class="n">${dinero(round2(t.regularHours * rate), m)}</td></tr>`);
    filas.push(`<tr><td>${T("Overtime hours", "Horas extra")}</td><td class="n">${horas(t.otHours)}</td><td class="n">${dinero(otRate, m)}</td><td class="n">${dinero(round2(t.otHours * otRate), m)}</td></tr>`);
  } else {
    for (const l of t.lines) {
      const h = l.ot > 0 ? `${horas(l.regular)} + ${horas(l.ot)} ${T("OT", "extra")}` : horas(l.regular);
      const r = l.ot > 0 ? `${dinero(l.rate, m)} / ${dinero(l.otRate, m)}` : dinero(l.rate, m);
      filas.push(`<tr><td>${escapa(l.label)}</td><td class="n">${h}</td><td class="n">${r}</td><td class="n">${dinero(l.pay, m)}</td></tr>`);
    }
    if (!t.lines.length) filas.push(`<tr><td colspan="4" class="vacio">${T("No hours in this payment.", "Sin horas en este pago.")}</td></tr>`);
  }
  const ajustes = t.adjustments.map((a) => `<tr><td colspan="3">${escapa(a.label)}</td><td class="n">${conSigno(Number(a.amount || 0), m)}</td></tr>`).join("");

  const datosEmpresa = [
    empresa.address ? escapa(empresa.address) : "",
    [empresa.phone ? escapa(empresa.phone) : "", empresa.email ? escapa(empresa.email) : ""].filter(Boolean).join(" · "),
    empresa.taxId ? `${T("Tax ID", "ID fiscal")} ${escapa(empresa.taxId)}` : "",
  ].filter(Boolean).map((x) => `<div>${x}</div>`).join("");

  return `
    <section class="talon">
      <div class="cab">
        <div>
          <div class="emp">${escapa(empresa.name || T("Company", "Empresa"))}</div>
          <div class="datos">${datosEmpresa}</div>
        </div>
        <div class="der">
          <div class="titulo">${T("PAY STUB", "TALÓN DE PAGO")}</div>
          <div class="tipo">${tipo}</div>
        </div>
      </div>
      <table class="info">
        <tr><th>${T("Employee", "Empleado")}</th><td>${escapa(t.employeeName || "—")}</td></tr>
        <tr><th>${T("Pay period", "Periodo de pago")}</th><td>${escapa(fechaCorta(t.periodStart, lang))} – ${escapa(fechaCorta(t.periodEnd, lang))}</td></tr>
        <tr><th>${T("Pay date", "Fecha de pago")}</th><td>${escapa(fechaCorta(t.payDate, lang))}</td></tr>
        <tr><th>${T("Method", "Método")}</th><td>${escapa(t.method || "—")}</td></tr>
      </table>
      <table class="dinero">
        <thead><tr><th>${T("Earnings", "Ingresos")}</th><th class="n">${T("Hours", "Horas")}</th><th class="n">${T("Rate", "Tarifa")}</th><th class="n">${T("Amount", "Importe")}</th></tr></thead>
        <tbody>
          ${filas.join("")}
          <tr class="sub"><td colspan="3">${T("Gross pay", "Pago bruto")}</td><td class="n">${dinero(t.gross, m)}</td></tr>
          ${ajustes}
          <tr class="neto"><td colspan="3">${T("Net pay", "Pago neto")}</td><td class="n">${dinero(t.net, m)}</td></tr>
        </tbody>
      </table>
      <table class="ytd">
        <thead><tr><th>${T("Year to date", "Acumulado del año")}</th><th class="n">${T("Gross", "Bruto")}</th><th class="n">${T("Adjustments", "Ajustes")}</th><th class="n">${T("Net", "Neto")}</th></tr></thead>
        <tbody><tr><td></td><td class="n">${dinero(acumulado.gross, m)}</td><td class="n">${conSigno(acumulado.adjustments, m)}</td><td class="n">${dinero(acumulado.net, m)}</td></tr></tbody>
      </table>
      <div class="pie">${T("No taxes withheld", "Sin retenciones de impuestos")}</div>
    </section>`;
}

/** Varios talones en un documento, uno por página. */
export function htmlDeTalones(items: { talon: TalonDePago; acumulado: Acumulado }[], empresa: Empresa, lang: "en" | "es"): string {
  const T = (en: string, es: string) => (lang === "es" ? es : en);
  // Blanco con texto oscuro aunque la app esté en oscuro: es un papel.
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
    <title>${escapa(empresa.name || "")} — ${T("Pay stubs", "Talones de pago")}</title>
    <style>
      *{box-sizing:border-box;} html,body{background:#ffffff;color:#152238;}
      body{font-family:Inter,Arial,sans-serif;margin:0;padding:0;}
      .talon{padding:28px;page-break-after:always;break-after:page;}
      .cab{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #152238;padding-bottom:12px;margin-bottom:14px;}
      .emp{font-size:20px;font-weight:800;} .datos{font-size:12px;color:#4a5568;margin-top:4px;line-height:1.5;}
      .der{text-align:right;} .titulo{font-size:22px;font-weight:800;letter-spacing:.04em;} .tipo{font-size:12px;color:#4a5568;margin-top:4px;}
      table{width:100%;border-collapse:collapse;margin-bottom:14px;}
      .info th{width:170px;text-align:left;color:#4a5568;font-weight:600;font-size:13px;padding:4px 10px 4px 0;}
      .info td{font-size:13px;font-weight:600;padding:4px 0;border-bottom:1px solid #e2e8f0;}
      .dinero th,.ytd th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#4a5568;padding:6px 8px;border-bottom:2px solid #cbd5e0;background:#f7fafc;}
      .dinero td,.ytd td{font-size:13px;padding:6px 8px;border-bottom:1px solid #e2e8f0;}
      .n{text-align:right;white-space:nowrap;} .vacio{color:#718096;text-align:center;}
      tr.sub td{font-weight:700;} tr.neto td{font-weight:800;font-size:16px;border-top:2px solid #152238;}
      .pie{margin-top:18px;font-size:12px;color:#4a5568;text-align:center;}
      @media print{.talon{padding:14px;}}
    </style></head><body>
    ${items.map((i) => seccionDelTalon(i.talon, empresa, i.acumulado, lang)).join("")}
    <script>window.onload=function(){setTimeout(function(){window.print();},200);};</script>
    </body></html>`;
}

/** Un talón solo. */
export function htmlDelTalon(talon: TalonDePago, empresa: Empresa, acumulado: Acumulado, lang: "en" | "es"): string {
  return htmlDeTalones([{ talon, acumulado }], empresa, lang);
}
