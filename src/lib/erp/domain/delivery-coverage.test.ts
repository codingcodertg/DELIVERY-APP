import { describe, it, expect } from "vitest";
import { onTimeCoverage, type Delivery } from "./delivery-analytics";

const mk = (o: Partial<Delivery>): Delivery =>
  ({ created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", stage: "draft", ...o }) as Delivery;

describe("onTimeCoverage", () => {
  it("counts how many delivered orders carry real proof", () => {
    const rows = [
      mk({ stage: "delivered", delivery_date: "2026-08-20", pod_delivered_at: "2026-08-20T17:00:00Z" }),
      mk({ stage: "delivered", delivery_date: "2026-08-20" }),
      mk({ stage: "delivered", delivery_date: "2026-08-21" }),
    ];
    expect(onTimeCoverage(rows)).toEqual({ measurable: 3, withProof: 1, pct: 33 });
  });

  it("ignores orders that are not delivered", () => {
    const rows = [
      mk({ stage: "ready", delivery_date: "2026-08-20", pod_delivered_at: "2026-08-20T17:00:00Z" }),
      mk({ stage: "delivered", delivery_date: "2026-08-20", pod_delivered_at: "2026-08-20T17:00:00Z" }),
    ];
    expect(onTimeCoverage(rows)).toMatchObject({ measurable: 1, withProof: 1 });
  });

  it("ignores delivered orders with no date — they were never measurable", () => {
    expect(onTimeCoverage([mk({ stage: "delivered" })])).toEqual({ measurable: 0, withProof: 0, pct: null });
  });

  it("returns null rather than 0% when there is nothing to measure", () => {
    // "No deliveries yet" and "no proof on any delivery" are different facts.
    expect(onTimeCoverage([]).pct).toBeNull();
  });

  it("reports 0 when every delivery is scored on an edit timestamp", () => {
    const rows = [
      mk({ stage: "delivered", delivery_date: "2026-08-20" }),
      mk({ stage: "delivered", delivery_date: "2026-08-21" }),
    ];
    expect(onTimeCoverage(rows)).toEqual({ measurable: 2, withProof: 0, pct: 0 });
  });
});
