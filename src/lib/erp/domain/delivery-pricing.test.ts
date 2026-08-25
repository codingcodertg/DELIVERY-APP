import { describe, it, expect } from "vitest";
import {
  listFee,
  discountFee,
  isLocalCity,
  cityFromAddress,
  localCities,
  suggestDeliveryFee,
  LOCAL_CITIES_DEFAULT,
} from "./delivery-pricing";

// These are the office's real money formulas. The tiers are checked at their exact boundaries
// because that is where a port goes wrong silently — an off-by-one on `< 11` vs `<= 11` changes what
// a customer is quoted, and nothing else in the system would catch it.

describe("listFee (local)", () => {
  it("charges the flat short-haul rate below 11 miles", () => {
    expect(listFee(0)).toBe(100);
    expect(listFee(10.9)).toBe(100);
  });

  it("switches to the mid tier AT 11 miles — the boundary is exclusive", () => {
    // 120 + 11*0.8 = 128.8 → 130
    expect(listFee(11)).toBe(130);
  });

  it("keeps 50 miles in the mid tier — the upper boundary is exclusive too", () => {
    // 120 + 50*0.8 = 160
    expect(listFee(50)).toBe(160);
  });

  it("switches to the long-haul tier just past 50", () => {
    // 350 + 51 = 401 → 400
    expect(listFee(51)).toBe(400);
  });

  it("rounds to the nearest ten", () => {
    // 120 + 20*0.8 = 136 → 140
    expect(listFee(20)).toBe(140);
    // 120 + 30*0.8 = 144 → 140
    expect(listFee(30)).toBe(140);
  });
});

describe("discountFee (local)", () => {
  it("is always at or below the list fee", () => {
    for (const mi of [0, 5, 10.9, 11, 25, 50, 51, 80, 200]) {
      expect(discountFee(mi)).toBeLessThanOrEqual(listFee(mi));
    }
  });

  it("matches the documented tiers at their boundaries", () => {
    expect(discountFee(0)).toBe(80);
    expect(discountFee(10.9)).toBe(80);
    expect(discountFee(11)).toBe(110); // 100 + 8.8 = 108.8 → 110
    expect(discountFee(50)).toBe(140); // 100 + 40 = 140
    expect(discountFee(51)).toBe(250); // 200 + 51 = 251 → 250
  });
});

describe("non-local pricing", () => {
  it("uses the flat high base regardless of distance tier", () => {
    expect(listFee(5, false)).toBe(510); // 500 + 5 = 505 → 510
    expect(listFee(100, false)).toBe(600);
    expect(discountFee(5, false)).toBe(410); // 400 + 5 = 405 → 410
    expect(discountFee(100, false)).toBe(500);
  });

  it("always costs more than the local price for the same distance", () => {
    for (const mi of [0, 11, 50, 51, 120]) {
      expect(listFee(mi, false)).toBeGreaterThan(listFee(mi, true));
      expect(discountFee(mi, false)).toBeGreaterThan(discountFee(mi, true));
    }
  });
});

describe("isLocalCity", () => {
  it("matches regardless of case or padding", () => {
    expect(isLocalCity("mcallen")).toBe(true);
    expect(isLocalCity("  McAllen  ")).toBe(true);
    expect(isLocalCity("BROWNSVILLE")).toBe(true);
  });

  it("rejects a city outside the zone", () => {
    expect(isLocalCity("Houston")).toBe(false);
    expect(isLocalCity("San Antonio")).toBe(false);
  });

  it("treats empty as not local rather than throwing", () => {
    expect(isLocalCity("")).toBe(false);
    expect(isLocalCity("   ")).toBe(false);
  });

  it("honours a configured override instead of the defaults", () => {
    const s = { local_cities: ["Laredo"] };
    expect(isLocalCity("Laredo", s)).toBe(true);
    expect(isLocalCity("McAllen", s)).toBe(false);
  });

  it("falls back to defaults when the override is empty, not to 'nothing is local'", () => {
    expect(localCities({ local_cities: [] })).toEqual(LOCAL_CITIES_DEFAULT);
    expect(localCities(null)).toEqual(LOCAL_CITIES_DEFAULT);
  });
});

describe("cityFromAddress", () => {
  it("prefers an exact known-city hit anywhere in the string", () => {
    expect(cityFromAddress("123 Main St, McAllen TX 78501", LOCAL_CITIES_DEFAULT)).toBe("McAllen");
  });

  it("falls back to the second-to-last comma segment for a geocoded address", () => {
    expect(cityFromAddress("500 E Elm, Sometown, Hidalgo County, Texas, 78501")).toBe("Texas");
  });

  it("handles a typed two-part address", () => {
    expect(cityFromAddress("123 Main St, Houston TX")).toBe("123 Main St");
  });

  it("returns a dash for an empty address rather than an empty string", () => {
    expect(cityFromAddress(null)).toBe("—");
    expect(cityFromAddress("   ")).toBe("—");
  });
});

describe("suggestDeliveryFee", () => {
  const today = "2026-08-23";
  const now = new Date("2026-08-23T15:00:00Z"); // 10am Central — safely mid-day

  it("returns nulls with no address, so nothing is quoted from nothing", () => {
    const r = suggestDeliveryFee({ delivery_address: null, route_miles: 30 }, null, now);
    expect(r.zone).toBe("unknown");
    expect(r.list).toBeNull();
    expect(r.discount).toBeNull();
    expect(r.needsApproval).toBe(false);
  });

  it("returns nulls when miles are unknown, even with a good address", () => {
    // The fee is a function of miles. An address alone must not produce a price.
    const r = suggestDeliveryFee({ delivery_address: "1 Main, McAllen TX", route_miles: null }, null, now);
    expect(r.zone).toBe("local");
    expect(r.city).toBe("McAllen");
    expect(r.list).toBeNull();
    expect(r.discount).toBeNull();
  });

  it("prices a local delivery and does not flag approval", () => {
    const r = suggestDeliveryFee({ delivery_address: "1 Main, McAllen TX", route_miles: 20 }, null, now);
    expect(r.zone).toBe("local");
    expect(r.list).toBe(140);
    expect(r.discount).toBe(120); // 100 + 16 = 116 → 120
    expect(r.needsApproval).toBe(false);
  });

  it("flags a non-local delivery for manager approval", () => {
    const r = suggestDeliveryFee({ delivery_address: "1 Main, Houston TX", route_miles: 20 }, null, now);
    expect(r.zone).toBe("nonlocal");
    expect(r.needsApproval).toBe(true);
    expect(r.list).toBe(520);
  });

  it("adds the same-day surcharge to BOTH prices when the delivery is today", () => {
    const r = suggestDeliveryFee(
      { delivery_address: "1 Main, McAllen TX", route_miles: 20, delivery_date: today },
      { same_day_surcharge: 35 },
      now
    );
    expect(r.sameDay).toBe(true);
    expect(r.sameDaySurcharge).toBe(35);
    expect(r.list).toBe(175); // 140 + 35
    expect(r.discount).toBe(155); // 120 + 35
  });

  it("does not surcharge a future delivery", () => {
    const r = suggestDeliveryFee(
      { delivery_address: "1 Main, McAllen TX", route_miles: 20, delivery_date: "2026-09-01" },
      { same_day_surcharge: 35 },
      now
    );
    expect(r.sameDay).toBe(false);
    expect(r.list).toBe(140);
  });

  it("treats a zero/unset surcharge as off, even for a same-day order", () => {
    // The surcharge ships disabled (0) by design — it is a setting the office turns on.
    const r = suggestDeliveryFee(
      { delivery_address: "1 Main, McAllen TX", route_miles: 20, delivery_date: today },
      { same_day_surcharge: 0 },
      now
    );
    expect(r.sameDay).toBe(false);
    expect(r.sameDaySurcharge).toBe(0);
    expect(r.list).toBe(140);
  });

  it("ignores a negative surcharge rather than discounting the order", () => {
    const r = suggestDeliveryFee(
      { delivery_address: "1 Main, McAllen TX", route_miles: 20, delivery_date: today },
      { same_day_surcharge: -50 },
      now
    );
    expect(r.sameDaySurcharge).toBe(0);
    expect(r.list).toBe(140);
  });
});
