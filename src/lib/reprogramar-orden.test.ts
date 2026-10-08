import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fechaPropuesta, notaDeReprogramacion, puedeReprogramar, reprogramacionValida } from "./reprogramar-orden";

describe("«📅 Reprogramar» en el Gestor (D-500)", () => {
  it("quién puede: logística, gerente y oficina en las etapas abiertas; admin también en camino; nadie en entregada o anulada", () => {
    for (const rol of ["logistics", "manager", "accounting"]) {
      for (const etapa of ["draft", "pending", "approved", "fulfilling", "ready"]) expect([rol, etapa, puedeReprogramar(rol, etapa)]).toEqual([rol, etapa, true]);
      expect(puedeReprogramar(rol, "picked_up")).toBe(false);
    }
    expect(puedeReprogramar("admin", "picked_up")).toBe(true);
    for (const rol of ["admin", "logistics"]) {
      expect(puedeReprogramar(rol, "delivered")).toBe(false);
      expect(puedeReprogramar(rol, "canceled")).toBe(false);
    }
    expect(puedeReprogramar("sales", "approved")).toBe(false);
    expect(puedeReprogramar("driver", "ready")).toBe(false);
    expect(puedeReprogramar("logistics", null)).toBe(false);
  });

  it("la fecha que propone: el día siguiente al más tarde entre hoy y la que tiene", () => {
    expect(fechaPropuesta("2026-10-05", "2026-10-08")).toBe("2026-10-09");
    expect(fechaPropuesta("2026-10-12", "2026-10-08")).toBe("2026-10-13");
    expect(fechaPropuesta(null, "2026-10-08")).toBe("2026-10-09");
  });

  it("se guarda con fecha válida, no antes de hoy, distinta de la actual y con nota", () => {
    expect(reprogramacionValida("2026-10-09", "2026-10-08", "2026-10-08", "cliente no está")).toBe(true);
    expect(reprogramacionValida("2026-10-07", "2026-10-05", "2026-10-08", "cliente no está")).toBe(false);
    expect(reprogramacionValida("2026-10-08", "2026-10-08", "2026-10-08", "cliente no está")).toBe(false);
    expect(reprogramacionValida("2026-10-09", "2026-10-08", "2026-10-08", " x ")).toBe(false);
    expect(reprogramacionValida("", "2026-10-08", "2026-10-08", "cliente no está")).toBe(false);
    expect(reprogramacionValida("2026-10-08", null, "2026-10-08", "sin fecha antes")).toBe(true);
  });

  it("la nota del historial dice de dónde a dónde y por qué", () => {
    expect(notaDeReprogramacion("2026-10-08", "2026-10-09", "  cliente   no está ", "es")).toBe("Reprogramada de 2026-10-08 a 2026-10-09: cliente no está");
    expect(notaDeReprogramacion(null, "2026-10-09", "site closed", "en")).toBe("Rescheduled from no date to 2026-10-09: site closed");
  });

  it("la tabla del Gestor lleva el botón en las filas que se pueden reprogramar, y no en solo lectura", () => {
    const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8");
    expect(pagina).toContain("{!hecha && !soloLectura && puedeReprogramar(me?.role, d.stage) && (");
    expect(pagina).toContain("<ReprogramarOrden pedido={d}");
  });
});
