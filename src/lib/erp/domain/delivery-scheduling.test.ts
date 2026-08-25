import { describe, it, expect } from "vitest";
import {
  parseWindow,
  checkSchedule,
  sameDayOrders,
  DAY_START,
  DAY_END,
  type ScheduleOrder,
} from "./delivery-scheduling";

describe("parseWindow", () => {
  it("parses the standard 4-digit military window", () => {
    expect(parseWindow("0830-1200")).toEqual([510, 720]);
  });

  it("accepts a 3-digit start and an en-dash, both of which appear in real data", () => {
    expect(parseWindow("830-1200")).toEqual([510, 720]);
    expect(parseWindow("0830–1200")).toEqual([510, 720]);
  });

  it("normalises a reversed range instead of rejecting it", () => {
    expect(parseWindow("1200-0830")).toEqual([510, 720]);
  });

  it("ignores trailing text around a valid window", () => {
    expect(parseWindow("0830-1200 extra")).toEqual([510, 720]);
  });

  it("returns null for empty/absent input", () => {
    expect(parseWindow(null)).toBeNull();
    expect(parseWindow(undefined)).toBeNull();
    expect(parseWindow("")).toBeNull();
    expect(parseWindow("abc")).toBeNull();
  });

  it("does NOT accept colon-separated times — a known limitation, pinned", () => {
    // "08:30-12:00" parses to null, and checkSchedule treats an unparseable window as "nothing to
    // check yet" — so a colon-formatted window silently disables EVERY scheduling rule rather than
    // warning. Ported as-is; worth knowing before any UI offers a colon time picker.
    expect(parseWindow("08:30-12:00")).toBeNull();
  });

  it("does not accept 1-2 digit hours", () => {
    expect(parseWindow("12-13")).toBeNull();
  });

  it("accepts a zero-length window", () => {
    expect(parseWindow("1730-1730")).toEqual([1050, 1050]);
  });
});

describe("sameDayOrders", () => {
  const base = { delivery_date: "2026-08-25", store: "RDZ McAllen", stage: "approved" };
  const others: ScheduleOrder[] = [
    { ...base, id: "a", order_no: 1, delivery_windows: "0830-1200" },
    { ...base, id: "b", order_no: 2, delivery_windows: "1300-1700" },
    { ...base, id: "c", order_no: 3, delivery_windows: "0900-1100", stage: "canceled" },
    { ...base, id: "d", order_no: 4, delivery_windows: "0830-1200", store: "RDZ Pharr" },
    { ...base, id: "e", order_no: 5, delivery_date: "2026-08-26", delivery_windows: "0830-1200" },
  ];

  it("counts only live orders, same day, same store", () => {
    // Excludes the canceled one, the other store, and the other date.
    expect(sameDayOrders({ id: "x", ...base }, others)).toHaveLength(2);
  });

  it("compares across all stores when the draft has no store yet", () => {
    // Over-warns rather than under-warns — the safe direction for a capacity guard.
    const r = sameDayOrders({ id: "x", delivery_date: "2026-08-25", store: null }, others);
    expect(r).toHaveLength(3);
  });

  it("returns nothing when the candidate has no date", () => {
    expect(sameDayOrders({ id: "x", delivery_date: null }, others)).toEqual([]);
  });
});

describe("checkSchedule", () => {
  const base = { delivery_date: "2026-08-25", store: "RDZ McAllen", stage: "approved" };
  const others: ScheduleOrder[] = [
    { ...base, id: "a", order_no: 1, delivery_windows: "0830-1200" },
    { ...base, id: "b", order_no: 2, delivery_windows: "1300-1700" },
  ];
  const codes = (c: ScheduleOrder) => checkSchedule(c, others).map((w) => w.code);

  it("stays silent until there is both a date and a parseable window", () => {
    expect(codes({ id: "x", ...base, delivery_windows: null })).toEqual([]);
    expect(codes({ id: "x", store: "RDZ McAllen", delivery_date: null, delivery_windows: "0830-1200" })).toEqual([]);
  });

  it("flags an exact duplicate window", () => {
    expect(codes({ id: "x", ...base, delivery_windows: "0830-1200" })).toContain("same_window");
  });

  it("flags a delivery starting within 3 hours of another", () => {
    expect(codes({ id: "x", ...base, delivery_windows: "1000-1130" })).toContain("cluster");
  });

  it("does not report cluster AND same_window for the same order", () => {
    // The cluster check deliberately excludes the exact-match orders already reported.
    const c = codes({ id: "x", ...base, delivery_windows: "0830-1200" });
    expect(c).toContain("same_window");
    expect(c).not.toContain("cluster");
  });

  it("flags a window starting before the working day", () => {
    expect(codes({ id: "x", ...base, delivery_windows: "0700-0800" })).toContain("outside_hours");
  });

  it("flags a window ending after the working day", () => {
    expect(codes({ id: "x", ...base, delivery_windows: "1700-1800" })).toContain("outside_hours");
  });

  it("accepts a window exactly on the working-day bounds", () => {
    const exact = `0${Math.floor(DAY_START / 60)}${DAY_START % 60}-${Math.floor(DAY_END / 60)}${DAY_END % 60}`;
    expect(codes({ id: "x", ...base, delivery_windows: exact })).not.toContain("outside_hours");
  });

  it("counts the proposed order toward its own half-day", () => {
    // One existing AM order + this one = 2, over the limit of 1.
    expect(codes({ id: "x", ...base, delivery_windows: "0830-1200" })).toContain("am_overload");
    expect(codes({ id: "x", ...base, delivery_windows: "1500-1700" })).toContain("pm_overload");
  });

  it("splits AM/PM at noon, with noon itself counting as PM", () => {
    const pm = checkSchedule({ id: "x", ...base, delivery_windows: "1200-1400" }, others);
    expect(pm.map((w) => w.code)).toContain("pm_overload");
    expect(pm.map((w) => w.code)).not.toContain("am_overload");
  });

  it("carries both languages on every warning", () => {
    // The app renders whichever the user selected; a missing half would silently go English-only.
    for (const w of checkSchedule({ id: "x", ...base, delivery_windows: "0700-0800" }, others)) {
      expect(w.en.length).toBeGreaterThan(0);
      expect(w.es.length).toBeGreaterThan(0);
      expect(w.es).not.toBe(w.en);
    }
  });

  it("ignores canceled and rejected orders when counting capacity", () => {
    const dead: ScheduleOrder[] = [
      { ...base, id: "a", order_no: 1, delivery_windows: "0830-1200", stage: "canceled" },
      { ...base, id: "b", order_no: 2, delivery_windows: "0830-1200", stage: "rejected" },
    ];
    expect(checkSchedule({ id: "x", ...base, delivery_windows: "0830-1200" }, dead)).toEqual([]);
  });
});
