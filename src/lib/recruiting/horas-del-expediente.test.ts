import { describe, expect, it } from "vitest";
import { pagosDelEmpleado, semanasDeHoras, totalesDeHoras, totalesDePagos, type FilaLote, type FilaTalon } from "./horas-del-expediente";

const lote = (p: Partial<FilaLote>): FilaLote => ({
  id: "L", week_of: "2026-10-02", method: "zelle", total: 100, paid: true, paid_at: null, draft: false,
  created_at: "2026-10-03T00:00:00Z", ...p,
});
const talon = (p: Partial<FilaTalon>): FilaTalon => ({
  id: "T", kind: "onsite", period_start: "2026-10-09", period_end: "2026-10-15", pay_date: "2026-10-16",
  method: "check", regular_hours: 40, ot_hours: "2.5", gross: 500, net: "450.10", payroll_id: null, ...p,
});

describe("horas del expediente", () => {
  it("ordena las semanas de la más reciente a la más vieja y suma con texto numérico", () => {
    const s = semanasDeHoras([
      { period_start: "2026-09-25", period_end: "2026-10-01", horas_fichaje: "10.5", horas_proyecto: 0, revisar: false },
      { period_start: "2026-10-09", period_end: "2026-10-15", horas_fichaje: 0, horas_proyecto: "3.25", revisar: null },
      { period_start: "2026-10-02", period_end: "2026-10-08", horas_fichaje: 8, horas_proyecto: 2, revisar: true },
    ]);
    expect(s.map((x) => x.desde)).toEqual(["2026-10-09", "2026-10-02", "2026-09-25"]);
    expect(s[1].revisar).toBe(true);
    expect(totalesDeHoras(s)).toEqual({ fichaje: 18.5, proyecto: 5.25, semanas: 3 });
  });

  it("un lote con talón sale una sola vez y los borradores no son pagos", () => {
    const p = pagosDelEmpleado(
      [lote({ id: "L1" }), lote({ id: "L2", draft: true }), lote({ id: "L3", week_of: "2026-10-23", paid: false, total: "30" })],
      [talon({ id: "T1", payroll_id: "L1" })],
    );
    expect(p.map((x) => `${x.origen}:${x.id}`)).toEqual(["lote:L3", "talon:T1"]);
    expect(p[1]).toMatchObject({ horas: 42.5, monto: 450.1, pagado: true });
    expect(totalesDePagos(p)).toEqual({ pagado: 450.1, pendiente: 30 });
  });

  it("ordena los pagos por fecha de pago, no por el orden de llegada", () => {
    const p = pagosDelEmpleado([lote({ id: "viejo", paid_at: "2026-01-05T10:00:00Z" })], [talon({ id: "nuevo" })]);
    expect(p.map((x) => x.id)).toEqual(["nuevo", "viejo"]);
    expect(p[1].fecha).toBe("2026-01-05");
  });
});
