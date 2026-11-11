import { describe, it, expect } from "vitest";
import { estadoDeApp, construyeUsoPorApp, DIAS_FRESCO } from "./uso-por-app";

const AHORA = Date.parse("2026-11-10T18:00:00Z");
const haceDias = (d: number) => new Date(AHORA - d * 24 * 60 * 60 * 1000).toISOString();

describe("estadoDeApp", () => {
  it("verde si está live ahora, sin importar la última vez", () => {
    expect(estadoDeApp(haceDias(30), true, AHORA).estado).toBe("verde");
    expect(estadoDeApp(null, true, AHORA).estado).toBe("verde");
  });
  it("verde si la usó en ≤ 2 días", () => {
    expect(estadoDeApp(haceDias(1), false, AHORA).estado).toBe("verde");
    expect(estadoDeApp(haceDias(DIAS_FRESCO), false, AHORA).estado).toBe("verde");
  });
  it("gris si lleva más de 2 días, con la última vez y los minutos", () => {
    const e = estadoDeApp(haceDias(5), false, AHORA);
    expect(e.estado).toBe("gris");
    expect(e.ultimaVez).toBe(haceDias(5));
    expect(e.mins).toBe(5 * 1440);
  });
  it("gris 'nunca' si no hay último uso y no está live", () => {
    const e = estadoDeApp(null, false, AHORA);
    expect(e).toEqual({ estado: "gris", ultimaVez: null, mins: null });
  });
  it("una fecha inválida se trata como nunca", () => {
    expect(estadoDeApp("no-es-fecha", false, AHORA).estado).toBe("gris");
  });
});

describe("construyeUsoPorApp", () => {
  it("agrupa por persona y app, quedándose con el más reciente", () => {
    const m = construyeUsoPorApp([
      { user_id: "u1", app: "deliveries", last_seen_at: haceDias(3) },
      { user_id: "u1", app: "deliveries", last_seen_at: haceDias(1) },
      { user_id: "u1", app: "erp", last_seen_at: haceDias(10) },
      { user_id: "u2", app: "recruiting", last_seen_at: haceDias(0) },
    ]);
    expect(m.u1.deliveries).toBe(haceDias(1));
    expect(m.u1.erp).toBe(haceDias(10));
    expect(m.u2.recruiting).toBe(haceDias(0));
  });
  it("ignora filas incompletas", () => {
    const m = construyeUsoPorApp([{ user_id: "", app: "x", last_seen_at: haceDias(1) } as never]);
    expect(Object.keys(m)).toHaveLength(0);
  });
});
