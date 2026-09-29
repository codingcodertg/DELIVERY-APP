import { describe, it, expect } from "vitest";
import { haversineMi } from "./route-batching";

// Real RGV geography, so the distances mean something.
const MCALLEN = { lat: 26.2034, lng: -98.2300 };

// Las pruebas de la agrupación por zona (`buildGeoLoads` y compañía) se fueron con ella en D-NEXT, al quitar «Optimizar».
describe("haversineMi", () => {
  it("measures a known RGV hop", () => {
    // McAllen → Brownsville is about 60 miles as the crow flies.
    const miles = haversineMi(MCALLEN, { lat: 25.9017, lng: -97.4975 });
    expect(miles).toBeGreaterThan(45);
    expect(miles).toBeLessThan(60);
  });

  it("is zero for the same point and symmetric", () => {
    expect(haversineMi(MCALLEN, MCALLEN)).toBeCloseTo(0);
    const b = { lat: 26.19, lng: -97.69 };
    expect(haversineMi(MCALLEN, b)).toBeCloseTo(haversineMi(b, MCALLEN), 9);
  });
});
