import { test, expect } from "vitest";
import {
  isSaturdayISO,
  defaultWindowFor,
  autoWindowSwap,
  SATURDAY_WINDOW,
  WEEKDAY_ALL_DAY_WINDOW,
  DELIVERY_WINDOW_PRESETS,
  parseWindow,
} from "./delivery-scheduling";

test("Saturdays are recognised", () => {
  // 2026-03-07 and 2026-03-14 are Saturdays; 2026-03-10 is a Tuesday.
  expect(isSaturdayISO("2026-03-07")).toBe(true);
  expect(isSaturdayISO("2026-03-14")).toBe(true);
  expect(isSaturdayISO("2026-03-10")).toBe(false);
  expect(isSaturdayISO("2026-03-08")).toBe(false);
});

test("a weekday check does not depend on the runtime timezone", () => {
  // The source parses `iso + "T12:00:00"` in local time. Building from the date parts means the
  // answer is the same on a Chicago laptop and a UTC server, which is where the on-time bug came
  // from in delivery-analytics.
  expect(isSaturdayISO("2026-03-07T00:00:00Z")).toBe(true);
  expect(isSaturdayISO("2026-03-07")).toBe(true);
});

test("a malformed date is not a Saturday", () => {
  expect(isSaturdayISO("")).toBe(false);
  expect(isSaturdayISO("not-a-date")).toBe(false);
});

test("the default window follows the weekday", () => {
  expect(defaultWindowFor("2026-03-07")).toBe(SATURDAY_WINDOW);
  expect(defaultWindowFor("2026-03-10")).toBe(WEEKDAY_ALL_DAY_WINDOW);
});

test("an empty window takes the day's default", () => {
  expect(autoWindowSwap("", "2026-03-07")).toBe(SATURDAY_WINDOW);
  expect(autoWindowSwap(null, "2026-03-10")).toBe(WEEKDAY_ALL_DAY_WINDOW);
});

test("the default flips both ways when the date moves", () => {
  expect(autoWindowSwap(WEEKDAY_ALL_DAY_WINDOW, "2026-03-07")).toBe(SATURDAY_WINDOW);
  expect(autoWindowSwap(SATURDAY_WINDOW, "2026-03-10")).toBe(WEEKDAY_ALL_DAY_WINDOW);
});

test("a deliberately chosen window is never overwritten", () => {
  // The subtlety the whole function exists for: only the OTHER day's default gets replaced.
  expect(autoWindowSwap("0830-1000", "2026-03-07")).toBe("0830-1000");
  expect(autoWindowSwap("1200-1730", "2026-03-10")).toBe("1200-1730");
  expect(autoWindowSwap("0830-1200", "2026-03-07")).toBe("0830-1200");
});

test("every preset parses with the app's own window parser", () => {
  // A preset the scheduler cannot read would silently disable conflict checking on that order.
  for (const p of DELIVERY_WINDOW_PRESETS) {
    const parsed = parseWindow(p.value);
    expect(parsed, p.key).not.toBeNull();
    expect(parsed![0]).toBeLessThan(parsed![1]);
  }
});

test("Saturday's window really is shorter than the weekday one", () => {
  expect(parseWindow(SATURDAY_WINDOW)![1]).toBeLessThan(parseWindow(WEEKDAY_ALL_DAY_WINDOW)![1]);
});
