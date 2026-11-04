import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decideTurnoAutomatico, NOTA_TURNO_AUTOMATICO, ordenesCargadasDe } from "./turno-automatico";
import { HEARTBEAT_MS, MIN_INTERVAL_MS, MIN_MOVE_M } from "./location-filter";

/** D-831: el turno del chofer empieza al cargar la primera orden y termina con la última entrega. */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const O = (assigned_driver: string | null, stage: string) => ({ assigned_driver, stage });
const auto = { note: NOTA_TURNO_AUTOMATICO, ended_at: null };
const manual = { note: null, ended_at: null };

describe("órdenes cargadas de un chofer", () => {
  it("cuenta las suyas en picked_up, por nombre y sin espacios de más", () => {
    const ordenes = [O("Juan Pérez", "picked_up"), O("Juan Pérez ", "picked_up"), O("Juan Pérez", "delivered"), O("Otro", "picked_up")];
    expect(ordenesCargadasDe(ordenes, "Juan Pérez")).toBe(2);
    expect(ordenesCargadasDe(ordenes, null)).toBe(0);
  });
});

describe("decideTurnoAutomatico", () => {
  it("abre al cargar la primera orden si no hay turno; no abre dos veces", () => {
    expect(decideTurnoAutomatico({ ordenes: [O("Juan", "picked_up")], nombre: "Juan", turnoAbierto: null, nativa: true })).toBe("abrir");
    expect(decideTurnoAutomatico({ ordenes: [O("Juan", "picked_up")], nombre: "Juan", turnoAbierto: auto, nativa: true })).toBeNull();
    expect(decideTurnoAutomatico({ ordenes: [O("Juan", "picked_up")], nombre: "Juan", turnoAbierto: manual, nativa: true })).toBeNull();
  });
  it("cierra con la última entrega, solo si el turno es automático", () => {
    const todo = [O("Juan", "delivered"), O("Juan", "delivered")];
    expect(decideTurnoAutomatico({ ordenes: todo, nombre: "Juan", turnoAbierto: auto, nativa: true })).toBe("cerrar");
    expect(decideTurnoAutomatico({ ordenes: todo, nombre: "Juan", turnoAbierto: manual, nativa: true })).toBeNull();
    expect(decideTurnoAutomatico({ ordenes: todo, nombre: "Juan", turnoAbierto: null, nativa: true })).toBeNull();
  });
  it("fuera de la app Android no decide nada: ahí no hay GPS que valga", () => {
    expect(decideTurnoAutomatico({ ordenes: [O("Juan", "picked_up")], nombre: "Juan", turnoAbierto: null, nativa: false })).toBeNull();
    expect(decideTurnoAutomatico({ ordenes: [], nombre: "Juan", turnoAbierto: auto, nativa: false })).toBeNull();
  });
  it("una orden lista pero aún no cargada no abre turno", () => {
    expect(decideTurnoAutomatico({ ordenes: [O("Juan", "ready")], nombre: "Juan", turnoAbierto: null, nativa: true })).toBeNull();
  });
});

describe("precisión del recorrido (D-831: «exacto y preciso»)", () => {
  it("un punto cada 10 m o cada 5 s en movimiento, y cada minuto parado", () => {
    expect(MIN_MOVE_M).toBe(10);
    expect(MIN_INTERVAL_MS).toBe(5_000);
    expect(HEARTBEAT_MS).toBe(60_000);
    expect(leer("src/lib/useLiveLocation.ts")).toContain("const TIMED_INTERVAL_MS = 15_000;");
  });
});

describe("cableado", () => {
  it("LocationTracker aplica la regla y el turno automático nace con su nota", () => {
    const lt = leer("src/components/LocationTracker.tsx");
    expect(lt).toContain("decideTurnoAutomatico(");
    expect(lt).toContain("clockIn(me.id, NOTA_TURNO_AUTOMATICO)");
    expect(lt).toContain("clockOut(me.id)");
    const dp = leer("src/lib/data-provider.tsx");
    expect(dp).toContain("clockIn: (driverId: string, note?: string | null) => Promise<void>;");
    expect(dp).toContain("started_at: at, app: appActual(), note: note ?? null");
  });
});
