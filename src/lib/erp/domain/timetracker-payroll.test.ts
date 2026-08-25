import { test, expect } from "vitest";
import { buildPayroll, csvEscape, toCsv, payrollCsv } from "./timetracker-payroll";
import type { WeekSession } from "./timetracker-week";

const S = (o: Partial<WeekSession> & { id: string }): WeekSession => ({ ...o });
const A = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  project_id: "p1",
  hourly_rate: 20,
  overtime_rate: 30,
  overtime_threshold: 40,
  weekly_limit: null,
  ...over,
});
const name = () => "Site A";
const H = (n: number) => ({ duration_seconds: n * 3600 });

test("a straightforward week prices at the hourly rate", () => {
  const run = buildPayroll([S({ id: "1", assignment_id: "a", ...H(10) })], [A("a")], name);
  expect(run.hours).toBe(10);
  expect(run.subtotal).toBe(200);
  expect(run.total).toBe(200);
  expect(run.lines[0]).toMatchObject({ project: "Site A", regular: 10, overtime: 0, unrated: false });
});

test("overtime applies past the threshold", () => {
  const run = buildPayroll([S({ id: "1", assignment_id: "a", ...H(45) })], [A("a")], name);
  expect(run.subtotal).toBe(40 * 20 + 5 * 30);
});

test("two assignments are priced separately, never pooled", () => {
  // 30 + 30 hours across two assignments is NOT 60 hours with 20 of overtime. Pooling would apply
  // one assignment's threshold to the other's work and inflate the total.
  const run = buildPayroll(
    [S({ id: "1", assignment_id: "a", ...H(30) }), S({ id: "2", assignment_id: "b", ...H(30) })],
    [A("a"), A("b")],
    name
  );
  expect(run.hours).toBe(60);
  expect(run.subtotal).toBe(60 * 20);
  expect(run.lines.every((l) => l.overtime === 0)).toBe(true);
});

test("hours on an assignment with no rate are reported, not dropped", () => {
  const run = buildPayroll(
    [S({ id: "1", assignment_id: "a", ...H(8) }), S({ id: "2", assignment_id: "ghost", ...H(5) })],
    [A("a")],
    name
  );
  expect(run.hours).toBe(13);
  expect(run.unratedHours).toBe(5);
  expect(run.subtotal).toBe(160);
  const ghost = run.lines.find((l) => l.assignmentId === "ghost");
  expect(ghost).toMatchObject({ unrated: true, pay: 0, project: "Unassigned" });
});

test("an assignment that exists but has no rate set is also unrated", () => {
  const run = buildPayroll(
    [S({ id: "1", assignment_id: "a", ...H(8) })],
    [A("a", { hourly_rate: null })],
    name
  );
  expect(run.lines[0].unrated).toBe(true);
  expect(run.unratedHours).toBe(8);
});

test("adjustments are signed, so a deduction subtracts", () => {
  const run = buildPayroll(
    [S({ id: "1", assignment_id: "a", ...H(10) })],
    [A("a")],
    name,
    [{ label: "Bonus", amount: 50 }, { label: "Tool deduction", amount: -30 }]
  );
  expect(run.subtotal).toBe(200);
  expect(run.adjustmentTotal).toBe(20);
  expect(run.total).toBe(220);
});

test("an unparseable adjustment counts as zero rather than poisoning the total", () => {
  const run = buildPayroll(
    [S({ id: "1", assignment_id: "a", ...H(10) })],
    [A("a")],
    name,
    [{ label: "Typo", amount: "abc" as never }]
  );
  expect(run.total).toBe(200);
  expect(Number.isNaN(run.total)).toBe(false);
});

test("an empty week produces a zero run, not an error", () => {
  const run = buildPayroll([], [], name);
  expect(run).toMatchObject({ hours: 0, subtotal: 0, total: 0, unratedHours: 0 });
  expect(run.lines).toEqual([]);
});

test("lines sort by time worked, heaviest first", () => {
  const run = buildPayroll(
    [S({ id: "1", assignment_id: "a", ...H(2) }), S({ id: "2", assignment_id: "b", ...H(9) })],
    [A("a"), A("b")],
    name
  );
  expect(run.lines.map((l) => l.assignmentId)).toEqual(["b", "a"]);
});

// --- CSV ---------------------------------------------------------------------
test("csv escaping follows RFC4180", () => {
  expect(csvEscape("plain")).toBe("plain");
  expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  expect(csvEscape("a,b")).toBe('"a,b"');
  expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
  expect(csvEscape(null)).toBe("");
});

test("a customer name with a comma cannot shift the columns", () => {
  // The failure this prevents: one unquoted comma moves every later value into the wrong column,
  // and a payroll spreadsheet that is wrong in a plausible way is worse than one that fails.
  const csv = toCsv([["Rodriguez, Ana", "100.00"]]);
  expect(csv).toBe('"Rodriguez, Ana",100.00');
});

test("rows are CRLF separated, because these open in Excel", () => {
  expect(toCsv([["a"], ["b"]])).toBe("a\r\nb");
});

test("the payroll export carries lines, adjustments and a total per person", () => {
  const run = buildPayroll(
    [S({ id: "1", assignment_id: "a", ...H(10) })],
    [A("a")],
    name,
    [{ label: "Bonus", amount: 50 }]
  );
  const csv = payrollCsv("2026-03-08", [{ employee: "Ana Reyes", run }]);
  expect(csv).toContain("Week of,2026-03-08");
  expect(csv).toContain("Ana Reyes,Site A,10.00");
  expect(csv).toContain("Ana Reyes,Adjustment: Bonus");
  expect(csv).toContain("Ana Reyes,TOTAL,10.00");
  expect(csv).toContain("250.00");
});

test("unrated hours export as NO RATE rather than as 0.00", () => {
  // 0.00 in a pay column reads as "worked and worth nothing"; NO RATE reads as "somebody must fix
  // this before paying it", which is what it means.
  const run = buildPayroll([S({ id: "1", assignment_id: "ghost", ...H(6) })], [], name);
  const csv = payrollCsv("2026-03-08", [{ employee: "Ana", run }]);
  expect(csv).toContain("NO RATE");
  expect(csv).not.toContain("Ana,Unassigned,6.00,0.00,0.00,0.00,0.00,0.00,0.00");
});
