import { describe, it, expect } from "vitest";

import { periodStartOf } from "./period";

// El periodo de pago es de VIERNES a jueves en los dos modulos (comprobado: clock-in lo
// calcula asi, y timetracker tiene weekStartDay = 5 en sus ajustes). La vista period_hours
// depende de que la pantalla calcule el mismo viernes que la base, o el selector enseñaria
// un periodo y la consulta traeria otro — sin dar ningun error.
//
// Hasta D-NEXT esta prueba REIMPLEMENTABA la funcion en vez de importarla, asi que pasaba
// aunque la pagina calculara otra cosa. Ahora llama a la de verdad. La funcion recibe un
// instante, no un dia: se le da el mediodia UTC (07:00 en Chicago) para que caiga en el
// dia del calendario que dice el ISO.
const p = (iso: string) => periodStartOf(new Date(iso + "T12:00:00Z"));

describe("periodo de pago viernes-jueves", () => {
  it("un viernes es su propio inicio de periodo", () => {
    expect(p("2026-08-21")).toBe("2026-08-21"); // viernes
    expect(p("2026-08-28")).toBe("2026-08-28");
  });

  it("de sabado a jueves se cae al viernes anterior", () => {
    expect(p("2026-08-22")).toBe("2026-08-21"); // sabado
    expect(p("2026-08-24")).toBe("2026-08-21"); // lunes
    expect(p("2026-08-27")).toBe("2026-08-21"); // jueves, ultimo dia
  });

  it("el jueves y el viernes siguiente caen en periodos DISTINTOS", () => {
    // El limite: si esto se corriera un dia, la ultima jornada de la semana se pagaria
    // en la siguiente.
    expect(p("2026-08-27")).not.toBe(p("2026-08-28"));
  });

  it("cruza el fin de mes y el fin de año sin romperse", () => {
    expect(p("2026-09-01")).toBe("2026-08-28");
    expect(p("2027-01-01")).toBe("2027-01-01"); // 1 de enero de 2027 es viernes
  });
});
