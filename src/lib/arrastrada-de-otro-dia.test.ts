import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arrastradaDesde } from "./arrastrada-de-otro-dia";
import { changedFieldsNote } from "./utils";

/** Un evento «edited» de la orden `o1` con esa nota, en esa hora. */
const ev = (note: string, at: string, delivery_id = "o1", kind = "edited") => ({ delivery_id, kind, note, created_at: at });
const orden = (delivery_date: string | null) => ({ id: "o1", delivery_date });

describe("arrastradaDesde: de qué día viene una orden movida a una fecha posterior", () => {
  it("movida de ayer a mañana: viene de ayer; de ayer a hoy: viene de ayer", () => {
    const eventos = [ev("Changed: Delivery Date: 2026-11-23 → 2026-11-25", "2026-11-24T10:00:00Z")];
    expect(arrastradaDesde(orden("2026-11-25"), eventos)).toBe("2026-11-23");
    expect(arrastradaDesde(orden("2026-11-23"), [])).toBeNull();
    const deAyerAHoy = [ev("Changed: Delivery Date: 2026-11-23 → 2026-11-24", "2026-11-24T10:00:00Z")];
    expect(arrastradaDesde(orden("2026-11-24"), deAyerAHoy)).toBe("2026-11-23");
  });

  it("movida hacia ATRÁS: no cuenta", () => {
    const eventos = [ev("Changed: Delivery Date: 2026-11-26 → 2026-11-24", "2026-11-23T10:00:00Z")];
    expect(arrastradaDesde(orden("2026-11-24"), eventos)).toBeNull();
  });

  it("la fecha se puso por primera vez («—» antes): no cuenta", () => {
    const eventos = [ev("Changed: Delivery Date: — → 2026-11-25", "2026-11-24T10:00:00Z")];
    expect(arrastradaDesde(orden("2026-11-25"), eventos)).toBeNull();
  });

  it("un cambio posterior la devolvió al día original: no cuenta", () => {
    const eventos = [
      ev("Changed: Delivery Date: 2026-11-24 → 2026-11-26", "2026-11-23T10:00:00Z"),
      ev("Changed: Delivery Date: 2026-11-26 → 2026-11-24", "2026-11-24T08:00:00Z"),
    ];
    expect(arrastradaDesde(orden("2026-11-24"), eventos)).toBeNull();
  });

  it("cuenta el ÚLTIMO cambio que llevó a la fecha de hoy, aunque antes hubiera otro camino", () => {
    // Primero 23 → 25 (llegó a hoy desde el 23); luego 24 → 25 (el último, desde el 24): viene del 24.
    const eventos = [
      ev("Changed: Delivery Date: 2026-11-23 → 2026-11-25", "2026-11-23T10:00:00Z"),
      ev("Changed: Delivery Date: 2026-11-24 → 2026-11-25", "2026-11-24T08:00:00Z"),
    ];
    expect(arrastradaDesde(orden("2026-11-25"), eventos)).toBe("2026-11-24");
  });

  it("los eventos de otras órdenes se ignoran, y los que no son «edited» también", () => {
    const eventos = [
      ev("Changed: Delivery Date: 2026-11-23 → 2026-11-25", "2026-11-24T10:00:00Z", "otra"),
      ev("Changed: Delivery Date: 2026-11-23 → 2026-11-25", "2026-11-24T10:00:00Z", "o1", "note"),
    ];
    expect(arrastradaDesde(orden("2026-11-25"), eventos)).toBeNull();
  });

  it("la nota puede traer otros cambios unidos con « · », y la fecha puede llevar hora", () => {
    const nota = "Changed: Assigned Driver: Ana → Luis · Delivery Date: 2026-11-24 → 2026-11-26";
    expect(arrastradaDesde(orden("2026-11-26"), [ev(nota, "2026-11-25T10:00:00Z")])).toBe("2026-11-24");
    expect(arrastradaDesde(orden("2026-11-26T00:00:00"), [ev("Changed: Delivery Date: 2026-11-24 → 2026-11-26T00:00:00", "2026-11-25T10:00:00Z")])).toBe("2026-11-24");
    expect(arrastradaDesde(orden("2026-11-26 00:00:00+00"), [ev("Changed: Delivery Date: 2026-11-24 → 2026-11-26 00:00:00+00", "2026-11-25T10:00:00Z")])).toBe("2026-11-24");
  });

  it("sin fecha en la orden, no hay nada que decir", () => {
    expect(arrastradaDesde(orden(null), [ev("Changed: Delivery Date: 2026-11-23 → 2026-11-25", "2026-11-24T10:00:00Z")])).toBeNull();
  });

  it("lee lo que escribe de verdad `changedFieldsNote` (la edición de la ficha)", () => {
    const nota = changedFieldsNote({ delivery_date: "2026-11-23", assigned_driver: "A" }, { assigned_driver: "B", delivery_date: "2026-11-25" });
    expect(nota).toBe("Changed: Assigned Driver: A → B · Delivery Date: 2026-11-23 → 2026-11-25");
    expect(arrastradaDesde(orden("2026-11-25"), [ev(nota, "2026-11-24T10:00:00Z")])).toBe("2026-11-23");
  });

  it("la reprogramación (migración 173) escribe el mismo formato en su evento «edited»", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/173_reprogramar_orden.sql"), "utf8");
    expect(sql).toContain("'Changed: Delivery Date: ' || coalesce(o.delivery_date::text, '—') || ' → ' || p_fecha::text");
    expect(arrastradaDesde(orden("2026-11-25"), [ev("Changed: Delivery Date: 2026-11-23 → 2026-11-25", "2026-11-24T10:00:00Z")])).toBe("2026-11-23");
  });
});
