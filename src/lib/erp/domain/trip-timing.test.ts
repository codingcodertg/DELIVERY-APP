import { describe, it, expect } from "vitest";
import { serviceMin, tripTiming, dayMinutes, DEFAULT_SERVICE_MIN, RELOAD_MIN } from "./trip-timing";

describe("serviceMin", () => {
  it("reads the leading number out of free text", () => {
    expect(serviceMin("30")).toBe(30);
    expect(serviceMin("30 min")).toBe(30);
    expect(serviceMin("45m")).toBe(45);
  });

  it("finds a number anywhere in the string", () => {
    expect(serviceMin("min 20")).toBe(20);
  });

  it("falls back to the default rather than costing zero — a stop is never instant", () => {
    for (const v of ["", "   ", "abc", "0", null, undefined]) {
      expect(serviceMin(v)).toBe(DEFAULT_SERVICE_MIN);
    }
  });

  it("KNOWN BUG, pinned: hours are read as minutes", () => {
    // The module's own docs give "1 hr" as expected input from the office, but only the digits are
    // parsed — so an hour-long unload is budgeted as ONE MINUTE. That under-states the day by 59
    // minutes per such stop, in the exact figure the >8h shift alert is measured against.
    // Ported as-is (behaviour parity); fixing it changes capacity planning and is a business call.
    expect(serviceMin("1 hr")).toBe(1);
    expect(serviceMin("2 hours")).toBe(2);
  });

  it("KNOWN QUIRK, pinned: a minus sign is ignored and decimals truncate", () => {
    expect(serviceMin("-5")).toBe(5); // the regex matches digits only
    expect(serviceMin("1.5")).toBe(1);
  });
});

describe("tripTiming", () => {
  it("adds unload time to wheel time", () => {
    // The whole point: a load judged on driving alone looks like it fits a shift when it does not.
    expect(tripTiming(60, ["30", "30"])).toEqual({ driveMin: 60, serviceMin: 60, totalMin: 120 });
  });

  it("uses the default for each unreadable duration", () => {
    expect(tripTiming(60, [null, "abc", "0"]).serviceMin).toBe(3 * DEFAULT_SERVICE_MIN);
  });

  it("handles a load with no stops and a stop with no drive", () => {
    expect(tripTiming(45, [])).toEqual({ driveMin: 45, serviceMin: 0, totalMin: 45 });
    expect(tripTiming(0, ["15"]).totalMin).toBe(15);
  });
});

describe("dayMinutes", () => {
  const t1 = tripTiming(60, ["30", "30"]); // 120
  const t2 = tripTiming(90, ["15"]); // 105

  it("does not add a reload for a single trip — the truck is done, not turning around", () => {
    expect(dayMinutes([t1])).toBe(120);
  });

  it("adds one reload between each consecutive pair", () => {
    expect(dayMinutes([t1, t2])).toBe(120 + 105 + RELOAD_MIN);
    expect(dayMinutes([t1, t2, t1])).toBe(120 + 105 + 120 + 2 * RELOAD_MIN);
  });

  it("is zero for no trips", () => {
    expect(dayMinutes([])).toBe(0);
  });

  it("accepts a custom reload allowance", () => {
    expect(dayMinutes([t1, t2], 45)).toBe(120 + 105 + 45);
  });
});
