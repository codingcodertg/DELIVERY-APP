// Turning a week of sessions into what somebody is actually paid.
// Ported from the Time Tracker app (ADR 0010).

import { toHours } from "./timetracker";
import { computePay, secondsByAssignment, type PayInputs, type WeekSession } from "./timetracker-week";

export interface PayrollAdjustment {
  label: string;
  amount: number;
}

export interface PayrollLine {
  assignmentId: string;
  project: string;
  seconds: number;
  hours: number;
  regular: number;
  overtime: number;
  overLimit: number;
  rate: number;
  otRate: number;
  pay: number;
  /** No assignment carries a rate for this time, so it cannot be priced. */
  unrated: boolean;
}

export interface PayrollRun {
  lines: PayrollLine[];
  hours: number;
  /** Pay from the lines, before adjustments. */
  subtotal: number;
  adjustments: PayrollAdjustment[];
  adjustmentTotal: number;
  total: number;
  /** Hours on an assignment with no rate. Reported, never quietly folded into zero. */
  unratedHours: number;
}

/**
 * One person's week.
 *
 * Priced PER ASSIGNMENT and then summed, never from the week's total hours: the overtime threshold
 * and weekly limit belong to an assignment, so pooling hours across two of them applies one
 * assignment's cap to the other's work — and produces a figure that looks entirely ordinary.
 */
export function buildPayroll(
  sessions: WeekSession[],
  assignments: (PayInputs & { id: string; project_id?: string | null })[],
  projectName: (projectId: string | null | undefined) => string,
  adjustments: PayrollAdjustment[] = []
): PayrollRun {
  const aMap = new Map(assignments.map((a) => [a.id, a]));
  const lines: PayrollLine[] = [];
  let hours = 0;
  let subtotal = 0;
  let unratedHours = 0;

  for (const [assignmentId, seconds] of secondsByAssignment(sessions)) {
    const a = aMap.get(assignmentId);
    const h = toHours(seconds);
    hours += h;

    if (!a || a.hourly_rate == null || a.hourly_rate === "") {
      // Shown as a line with no money rather than dropped. Hours that vanish from a payroll are the
      // worst kind of missing: nobody goes looking for time they cannot see.
      unratedHours += h;
      lines.push({
        assignmentId,
        project: a ? projectName(a.project_id) : "Unassigned",
        seconds,
        hours: h,
        regular: 0,
        overtime: 0,
        overLimit: 0,
        rate: 0,
        otRate: 0,
        pay: 0,
        unrated: true,
      });
      continue;
    }

    const p = computePay(h, a);
    subtotal += p.pay;
    lines.push({
      assignmentId,
      project: projectName(a.project_id),
      seconds,
      hours: h,
      regular: p.reg,
      overtime: p.ot,
      overLimit: p.overLimit,
      rate: p.rate,
      otRate: p.otRate,
      pay: p.pay,
      unrated: false,
    });
  }

  lines.sort((a, b) => b.seconds - a.seconds);

  const adjustmentTotal = adjustments.reduce((n, adj) => n + (Number(adj.amount) || 0), 0);

  return {
    lines,
    hours,
    subtotal,
    adjustments,
    adjustmentTotal,
    // Adjustments are signed: a deduction is a negative amount, so this is a sum and not a subtract.
    total: subtotal + adjustmentTotal,
    unratedHours,
  };
}

/** RFC4180 escaping: anything containing a quote, comma or newline is quoted, quotes doubled. */
export function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows: unknown[][]): string {
  // CRLF, because the people opening this open it in Excel.
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

export interface PayrollExportRow {
  employee: string;
  run: PayrollRun;
}

/**
 * The week's payroll as a spreadsheet.
 *
 * One row per line rather than per employee, with the employee repeated: a spreadsheet somebody
 * pivots is more useful than one already summarised, and the totals are still there to check
 * against.
 */
export function payrollCsv(week: string, rows: PayrollExportRow[]): string {
  const out: unknown[][] = [
    ["Week of", week],
    [],
    ["Employee", "Project", "Hours", "Regular", "Overtime", "Over limit", "Rate", "OT rate", "Pay"],
  ];
  for (const { employee, run } of rows) {
    for (const l of run.lines) {
      out.push([
        employee,
        l.project,
        l.hours.toFixed(2),
        l.regular.toFixed(2),
        l.overtime.toFixed(2),
        l.overLimit.toFixed(2),
        l.unrated ? "" : l.rate.toFixed(2),
        l.unrated ? "" : l.otRate.toFixed(2),
        l.unrated ? "NO RATE" : l.pay.toFixed(2),
      ]);
    }
    for (const a of run.adjustments) {
      out.push([employee, "Adjustment: " + a.label, "", "", "", "", "", "", Number(a.amount).toFixed(2)]);
    }
    out.push([employee, "TOTAL", run.hours.toFixed(2), "", "", "", "", "", run.total.toFixed(2)]);
  }
  return toCsv(out);
}
