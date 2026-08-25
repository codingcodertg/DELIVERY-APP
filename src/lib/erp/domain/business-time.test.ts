import { describe, it, expect } from "vitest";
import { todayISO, nowHHMM, shiftDateISO, daysBetween, isOverdue, awaitingDriver, businessTimeMs } from "./business-time";

describe("todayISO", () => {
  it("uses the business timezone, not UTC", () => {
    // 02:00 UTC on the 24th is still 21:00 Central on the 23rd. This is the exact case that caused
    // hydration errors in the source app: the server (UTC) said one date, the browser said another.
    expect(todayISO(new Date("2026-08-24T02:00:00Z"))).toBe("2026-08-23");
  });

  it("rolls over at Central midnight, not UTC midnight", () => {
    // 04:59 UTC = 23:59 Central (CDT, UTC-5) — still the previous day.
    expect(todayISO(new Date("2026-08-24T04:59:00Z"))).toBe("2026-08-23");
    // 05:01 UTC = 00:01 Central — now the new day.
    expect(todayISO(new Date("2026-08-24T05:01:00Z"))).toBe("2026-08-24");
  });

  it("handles winter (CST, UTC-6) as well as summer", () => {
    // 05:59 UTC in January = 23:59 CST on the previous day.
    expect(todayISO(new Date("2026-01-15T05:59:00Z"))).toBe("2026-01-14");
    expect(todayISO(new Date("2026-01-15T06:01:00Z"))).toBe("2026-01-15");
  });

  it("returns a well-formed ISO date", () => {
    expect(todayISO(new Date("2026-08-23T15:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("nowHHMM", () => {
  it("reports Central wall-clock time, not UTC", () => {
    // 15:00 UTC = 10:00 CDT.
    expect(nowHHMM(new Date("2026-08-23T15:00:00Z"))).toBe("10:00");
  });

  it("uses 24-hour format with a zero-padded hour", () => {
    // 07:05 UTC = 02:05 CDT — must be "02:05", never "2:05" or "2:05 AM".
    expect(nowHHMM(new Date("2026-08-23T07:05:00Z"))).toBe("02:05");
  });
});

describe("shiftDateISO", () => {
  it("moves whole days forwards and backwards", () => {
    expect(shiftDateISO("2026-08-23", 1)).toBe("2026-08-24");
    expect(shiftDateISO("2026-08-23", -1)).toBe("2026-08-22");
    expect(shiftDateISO("2026-08-23", 0)).toBe("2026-08-23");
  });

  it("crosses month and year boundaries", () => {
    expect(shiftDateISO("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDateISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDateISO("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(shiftDateISO("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDateISO("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("does not slip a day across a DST transition", () => {
    // US DST starts 2026-03-08. Built from UTC noon precisely so the ±1h shift can't cross midnight.
    expect(shiftDateISO("2026-03-07", 1)).toBe("2026-03-08");
    expect(shiftDateISO("2026-03-08", 1)).toBe("2026-03-09");
    // ...and ends 2026-11-01.
    expect(shiftDateISO("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDateISO("2026-11-01", 1)).toBe("2026-11-02");
  });
});

describe("daysBetween", () => {
  it("counts forward and backward", () => {
    expect(daysBetween("2026-08-23", "2026-08-25")).toBe(2);
    expect(daysBetween("2026-08-25", "2026-08-23")).toBe(-2);
    expect(daysBetween("2026-08-23", "2026-08-23")).toBe(0);
  });

  it("is exact across a DST transition rather than off by an hour", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-08-23T15:00:00Z"); // 2026-08-23 Central

  it("flags an open order whose date has passed", () => {
    expect(isOverdue({ delivery_date: "2026-08-22", stage: "ready" }, now)).toBe(true);
  });

  it("does not flag today or the future", () => {
    expect(isOverdue({ delivery_date: "2026-08-23", stage: "ready" }, now)).toBe(false);
    expect(isOverdue({ delivery_date: "2026-08-24", stage: "ready" }, now)).toBe(false);
  });

  it("never flags a finished order — delivered late is not overdue today", () => {
    expect(isOverdue({ delivery_date: "2026-01-01", stage: "delivered" }, now)).toBe(false);
    expect(isOverdue({ delivery_date: "2026-01-01", stage: "canceled" }, now)).toBe(false);
  });

  it("treats an undated order as not overdue rather than throwing", () => {
    expect(isOverdue({ delivery_date: null, stage: "ready" }, now)).toBe(false);
    expect(isOverdue({}, now)).toBe(false);
  });
});

describe("awaitingDriver", () => {
  it("flags an in-flight order with nobody assigned", () => {
    expect(awaitingDriver({ assigned_driver: null, stage: "ready" })).toBe(true);
    expect(awaitingDriver({ assigned_driver: "   ", stage: "approved" })).toBe(true);
  });

  it("does not flag one that has a driver", () => {
    expect(awaitingDriver({ assigned_driver: "Maximo Garza", stage: "ready" })).toBe(false);
  });

  it("ignores drafts and finished orders — nothing to dispatch", () => {
    expect(awaitingDriver({ assigned_driver: null, stage: "draft" })).toBe(false);
    expect(awaitingDriver({ assigned_driver: null, stage: "delivered" })).toBe(false);
    expect(awaitingDriver({ assigned_driver: null, stage: "canceled" })).toBe(false);
  });
});

describe("businessTimeMs", () => {
  it("builds a wall-clock time in Texas, not in the runtime's zone", () => {
    // Noon Central on 2026-08-20 (CDT, UTC-5) is 17:00 UTC.
    expect(new Date(businessTimeMs("2026-08-20", 12 * 60)).toISOString()).toBe("2026-08-20T17:00:00.000Z");
  });

  it("uses the right offset in winter", () => {
    // Noon Central on 2026-01-15 (CST, UTC-6) is 18:00 UTC.
    expect(new Date(businessTimeMs("2026-01-15", 12 * 60)).toISOString()).toBe("2026-01-15T18:00:00.000Z");
  });

  it("puts business midnight at 05:00/06:00 UTC, never at 00:00", () => {
    // This is the bug it exists to prevent: midnight Central is not midnight UTC.
    expect(new Date(businessTimeMs("2026-08-20", 0)).toISOString()).toBe("2026-08-20T05:00:00.000Z");
    expect(new Date(businessTimeMs("2026-01-15", 0)).toISOString()).toBe("2026-01-15T06:00:00.000Z");
  });

  it("does not depend on the machine's own timezone", () => {
    const before = process.env.TZ;
    const answers = new Set<string>();
    for (const tz of ["UTC", "America/Chicago", "Asia/Tokyo", "Europe/London"]) {
      process.env.TZ = tz;
      answers.add(new Date(businessTimeMs("2026-08-20", 12 * 60)).toISOString());
    }
    process.env.TZ = before;
    expect([...answers]).toHaveLength(1);
  });

  it("handles the spring-forward day", () => {
    // 2026-03-08: clocks jump 02:00 -> 03:00 Central. Noon is still noon.
    expect(new Date(businessTimeMs("2026-03-08", 12 * 60)).toISOString()).toBe("2026-03-08T17:00:00.000Z");
  });
});
