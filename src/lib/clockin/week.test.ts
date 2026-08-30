import { describe, it, expect } from "vitest";
import { weekDates, payPeriodDates } from "./schedule";

// D-133. `weekDates` calculaba lunes→domingo a mano y era la ÚNICA definición de semana
// distinta que quedaba: nómina, horario y Time Tracker ya contaban viernes→jueves. En pantalla
// eso salía como "esta semana 20.8 h" en fichaje y "0 h" en Time Tracker — las dos ciertas para
// su ventana, ninguna comparable. Esta prueba impide que vuelvan a separarse.
describe("una sola semana en toda la app", () => {
  it("weekDates y payPeriodDates devuelven lo mismo", () => {
    for (const iso of ["2026-08-30", "2026-08-28", "2026-08-27", "2026-01-01", "2026-12-31"]) {
      const d = new Date(`${iso}T18:00:00Z`);
      expect(weekDates(d), `difieren en ${iso}`).toEqual(payPeriodDates(d));
    }
  });

  it("y esa semana empieza en VIERNES y dura siete días", () => {
    const w = payPeriodDates(new Date("2026-08-30T18:00:00Z"));
    expect(w).toHaveLength(7);
    // getUTCDay: 0=Dom … 5=Vie. Se comprueba con la fecha a mediodía UTC para que el día no
    // se corra por la zona horaria.
    expect(new Date(`${w[0]}T12:00:00Z`).getUTCDay()).toBe(5);
    expect(new Date(`${w[6]}T12:00:00Z`).getUTCDay()).toBe(4); // jueves
  });
});
