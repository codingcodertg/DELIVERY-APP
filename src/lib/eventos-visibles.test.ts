import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eventosVisibles } from "./eventos-visibles";
import { kindDeLlegada, llegadasDeParadas } from "./acciones-parada";
import type { OrderEvent } from "./types";

/**
 * D-540. El dueño, 2026-10-13, como Ernesto y en modo enseñanza: «cuando apreto arrived en el driver view solo dice
 * arrived at the store pero no cambia». La llegada se guardaba en la capa local y la lista `events` no la llevaba.
 */

const ahora = new Date().toISOString();
const hoyEnTexas = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const ev = (id: string, kind: string, delivery_id = "o1"): OrderEvent =>
  ({ id, delivery_id, kind, note: null, created_by: "u", created_at: ahora }) as OrderEvent;

describe("los eventos que ve la app", () => {
  it("en enseñanza, los locales van delante de los reales", () => {
    const reales = [ev("r1", "note")];
    const locales = [ev("l1", kindDeLlegada("P"))];
    expect(eventosVisibles(reales, locales, true).map((e) => e.id)).toEqual(["l1", "r1"]);
  });

  it("fuera de enseñanza, solo los reales, la misma lista", () => {
    const reales = [ev("r1", "note")];
    expect(eventosVisibles(reales, [ev("l1", "note")], false)).toBe(reales);
  });

  it("la llegada marcada en enseñanza la ve «Mi ruta» (llegadasDeParadas)", () => {
    const locales = [ev("l1", kindDeLlegada("P"))];
    expect(llegadasDeParadas(eventosVisibles([], locales, true), hoyEnTexas).get("o1")?.recoger).toBe(ahora);
    // Y es justo lo que fallaba: con solo los reales, no hay llegada.
    expect(llegadasDeParadas(eventosVisibles([], locales, false), hoyEnTexas).get("o1")).toBeUndefined();
  });

  it("el proveedor reparte esta lista, no la real a secas", () => {
    const fuente = readFileSync("src/lib/data-provider.tsx", "utf8");
    expect(fuente).toContain("const effectiveEvents = useMemo(() => eventosVisibles(events, overlay.events, teaching), [events, overlay.events, teaching]);");
    expect(fuente).toContain("ensureDeliveriesSince, events: effectiveEvents, notifications,");
  });
});
