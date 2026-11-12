import { describe, expect, it } from "vitest";
import { LATIDO_DB_MS, tocaGuardarEnBase } from "./latido-db";
import { LATIDO_MAX_MS } from "./live-session";

describe("latido a la base cada 120 s (Disk IO, D-1004)", () => {
  it("la primera vez guarda; luego espera el intervalo", () => {
    expect(tocaGuardarEnBase(null, 1_000)).toBe(true);
    expect(tocaGuardarEnBase(1_000, 1_000 + 10_000)).toBe(false);
    expect(tocaGuardarEnBase(1_000, 1_000 + LATIDO_DB_MS - 1)).toBe(false);
    expect(tocaGuardarEnBase(1_000, 1_000 + LATIDO_DB_MS)).toBe(true);
  });
  it("si el reloj retrocede, guarda", () => {
    expect(tocaGuardarEnBase(50_000, 10_000)).toBe(true);
  });
  it("muy por debajo de lo que el cron tolera sin latido", () => {
    expect(LATIDO_DB_MS * 5).toBeLessThanOrEqual(LATIDO_MAX_MS);
  });
});
