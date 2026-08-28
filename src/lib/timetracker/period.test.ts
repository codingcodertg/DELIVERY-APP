import { describe, it, expect } from "vitest";

// El periodo de pago es de VIERNES a jueves en los dos modulos (comprobado: clock-in lo
// calcula asi, y timetracker tiene weekStartDay = 5 en sus ajustes). La vista period_hours
// depende de que la pantalla calcule el mismo viernes que la base, o el selector enseñaria
// un periodo y la consulta traeria otro — sin dar ningun error.
function periodStartOf(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const sinceFriday = (d.getUTCDay() - 5 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - sinceFriday);
  return d.toISOString().slice(0, 10);
}

describe("periodo de pago viernes-jueves", () => {
  it("un viernes es su propio inicio de periodo", () => {
    expect(periodStartOf("2026-08-21")).toBe("2026-08-21"); // viernes
    expect(periodStartOf("2026-08-28")).toBe("2026-08-28");
  });

  it("de sabado a jueves se cae al viernes anterior", () => {
    expect(periodStartOf("2026-08-22")).toBe("2026-08-21"); // sabado
    expect(periodStartOf("2026-08-24")).toBe("2026-08-21"); // lunes
    expect(periodStartOf("2026-08-27")).toBe("2026-08-21"); // jueves, ultimo dia
  });

  it("el jueves y el viernes siguiente caen en periodos DISTINTOS", () => {
    // El limite: si esto se corriera un dia, la ultima jornada de la semana se pagaria
    // en la siguiente.
    expect(periodStartOf("2026-08-27")).not.toBe(periodStartOf("2026-08-28"));
  });

  it("cruza el fin de mes y el fin de año sin romperse", () => {
    expect(periodStartOf("2026-09-01")).toBe("2026-08-28");
    expect(periodStartOf("2027-01-01")).toBe("2027-01-01"); // 1 de enero de 2027 es viernes
  });
});
