import { describe, it, expect } from "vitest";
import { centralShiftMs, centralWallToUtc, utcToCentralInput } from "./tz";

// G-24 (D-198). /track construía los límites del día con `-05:00` fijo, que solo es Central
// en verano. Los límites pasan por este helper, que sabe de horario de verano, y aquí se fija
// con una fecha en CDT (julio) y otra en CST (enero) que la medianoche de Chicago es la que es.

describe("centralWallToUtc: la medianoche de Chicago en UTC, con horario de verano", () => {
  it("en verano (CDT, UTC-5) la medianoche del 15 de julio es 05:00Z", () => {
    expect(centralWallToUtc("2026-07-15T00:00")).toBe("2026-07-15T05:00:00.000Z");
    expect(centralShiftMs(new Date("2026-07-15T12:00:00Z"))).toBe(5 * 3600_000);
  });

  it("en invierno (CST, UTC-6) la medianoche del 15 de enero es 06:00Z — con -05:00 fijo saldría 05:00Z", () => {
    expect(centralWallToUtc("2026-01-15T00:00")).toBe("2026-01-15T06:00:00.000Z");
    expect(centralShiftMs(new Date("2026-01-15T12:00:00Z"))).toBe(6 * 3600_000);
    // La fijación de las 23:30 del 14 de enero en Chicago (05:30Z del 15) es del día 14; con el
    // offset fijo de verano el "día 15" empezaba a las 05:00Z y se la quedaba.
    const fix = "2026-01-15T05:30:00.000Z";
    expect(fix < centralWallToUtc("2026-01-15T00:00")).toBe(true);   // queda en el 14, correcto
    expect(fix < "2026-01-15T05:00:00.000Z").toBe(false);            // con -05:00 fijo caía en el 15
  });

  it("ida y vuelta: UTC → pared de Chicago → UTC devuelve el mismo instante en las dos estaciones", () => {
    for (const iso of ["2026-07-15T05:00:00.000Z", "2026-01-15T06:00:00.000Z"]) {
      expect(centralWallToUtc(utcToCentralInput(iso))).toBe(iso);
    }
  });
});

// Bug (2026-11): el caché de `centralShiftMs` se indexaba por día UTC. En un día de cambio de
// horario, la primera consulta fijaba el offset de todo el día: una hora de la mañana CST salía
// con el offset de CDT y se corría una hora. Se indexa por hora UTC, que es donde cambia.
describe("centralShiftMs en el día del cambio de horario", () => {
  it("el 8 de marzo de 2026 (cambio a CDT a las 08:00Z) no arrastra el offset de la tarde a la mañana", () => {
    expect(centralShiftMs(new Date("2026-03-08T12:00:00Z"))).toBe(5 * 3600_000); // ya CDT
    expect(centralShiftMs(new Date("2026-03-08T07:00:00Z"))).toBe(6 * 3600_000); // aún CST
    expect(utcToCentralInput("2026-03-08T07:00:00.000Z")).toBe("2026-03-08T01:00");
    expect(utcToCentralInput("2026-03-08T12:00:00.000Z")).toBe("2026-03-08T07:00");
  });

  it("el 1 de noviembre de 2026 (vuelta a CST a las 07:00Z) tampoco", () => {
    expect(centralShiftMs(new Date("2026-11-01T06:30:00Z"))).toBe(5 * 3600_000); // aún CDT
    expect(centralShiftMs(new Date("2026-11-01T07:30:00Z"))).toBe(6 * 3600_000); // ya CST
    expect(utcToCentralInput("2026-11-01T12:00:00.000Z")).toBe("2026-11-01T06:00");
  });
});

// Bug (2026-11): `centralWallToUtc` leía la pared como UTC para elegir el offset, así que una
// hora de madrugada en el día del cambio salía una hora corrida (06:00 el 8 de marzo quedaba en
// 12:00Z, cuando son las 11:00Z de CDT). Ahora se refina contra el instante real, y la ida y
// vuelta vuelve la misma pared en las 24 horas de los dos días de cambio.
describe("centralWallToUtc en el día del cambio de horario", () => {
  it("06:00 el 8 de marzo (ya CDT) son 11:00Z; el 1 de noviembre (ya CST) son 12:00Z", () => {
    expect(centralWallToUtc("2026-03-08T06:00")).toBe("2026-03-08T11:00:00.000Z");
    expect(centralWallToUtc("2026-11-01T06:00")).toBe("2026-11-01T12:00:00.000Z");
  });

  it("la ida y vuelta de cada hora de los dos días de cambio es la misma pared", () => {
    // La hora 02:00-02:59 del 8 de marzo no existe en Chicago: no tiene ida y vuelta posible.
    for (const dia of ["2026-03-08", "2026-11-01"]) {
      for (let h = 0; h < 24; h++) {
        for (const min of ["00", "30"]) {
          const pared = `${dia}T${String(h).padStart(2, "0")}:${min}`;
          if (pared.startsWith("2026-03-08T02:")) continue;
          expect(utcToCentralInput(centralWallToUtc(pared))).toBe(pared);
        }
      }
    }
  });
});
