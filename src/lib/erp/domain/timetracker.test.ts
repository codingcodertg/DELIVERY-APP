import { describe, it, expect } from "vitest";
import { formatDuration, toHours, activityPct, employeeTotals, type SessionLike } from "./timetracker";

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(3725)).toBe("1h 02m");
    expect(formatDuration(7200)).toBe("2h 00m");
  });

  it("drops the hour part below an hour", () => {
    expect(formatDuration(600)).toBe("10m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("rounds to the nearest minute, which is how a timesheet is read", () => {
    expect(formatDuration(89)).toBe("1m"); // 1.48 min
    expect(formatDuration(91)).toBe("2m"); // 1.52 min
  });

  it("treats null, undefined and negatives as zero rather than throwing", () => {
    expect(formatDuration(null)).toBe("0m");
    expect(formatDuration(undefined)).toBe("0m");
    expect(formatDuration(-500)).toBe("0m");
  });
});

describe("toHours", () => {
  it("converts to decimal hours at 2dp", () => {
    expect(toHours(3600)).toBe(1);
    expect(toHours(5400)).toBe(1.5);
    expect(toHours(3725)).toBe(1.03);
  });

  it("floors negatives at zero", () => {
    expect(toHours(-100)).toBe(0);
    expect(toHours(null)).toBe(0);
  });
});

describe("activityPct", () => {
  it("is the active share of tracked time", () => {
    expect(activityPct(1800, 3600)).toBe(50);
    expect(activityPct(3600, 3600)).toBe(100);
  });

  it("returns NULL for a session with no tracked time, not 0", () => {
    // "No data" and "idle the whole time" are different facts. Showing 0% for a session that never
    // started would read as a performance problem that did not happen.
    expect(activityPct(0, 0)).toBeNull();
    expect(activityPct(null, null)).toBeNull();
    expect(activityPct(100, 0)).toBeNull();
  });

  it("is 0 when time was tracked but none of it was active", () => {
    expect(activityPct(0, 3600)).toBe(0);
  });
});

describe("employeeTotals", () => {
  const sessions: SessionLike[] = [
    { employee_name: "Ana", duration_seconds: 3600, active_seconds: 1800, manual: false },
    { employee_name: "Ana", duration_seconds: 1800, active_seconds: 900, manual: true },
    { employee_name: "Beto", duration_seconds: 7200, active_seconds: 7200, manual: false },
    { employee_uid: "u-3", duration_seconds: 600, active_seconds: 0, manual: false },
  ];

  it("rolls up per employee, heaviest first", () => {
    const t = employeeTotals(sessions);
    expect(t.map((x) => x.employee)).toEqual(["Beto", "Ana", "u-3"]);
  });

  it("sums seconds and reports hours", () => {
    const ana = employeeTotals(sessions).find((t) => t.employee === "Ana")!;
    expect(ana.sessions).toBe(2);
    expect(ana.seconds).toBe(5400);
    expect(ana.hours).toBe(1.5);
    expect(ana.activityPct).toBe(50);
  });

  it("counts manual entries separately rather than excluding them", () => {
    // They are legitimate — a forgotten clock-in gets added back — but a timesheet that is mostly
    // manual is worth seeing as such.
    expect(employeeTotals(sessions).find((t) => t.employee === "Ana")!.manualCount).toBe(1);
    expect(employeeTotals(sessions).find((t) => t.employee === "Beto")!.manualCount).toBe(0);
  });

  it("falls back to the uid when there is no name, and to a dash when there is neither", () => {
    expect(employeeTotals(sessions).some((t) => t.employee === "u-3")).toBe(true);
    expect(employeeTotals([{ duration_seconds: 60 }])[0].employee).toBe("—");
  });

  it("returns nothing for no sessions", () => {
    expect(employeeTotals([])).toEqual([]);
  });
});
