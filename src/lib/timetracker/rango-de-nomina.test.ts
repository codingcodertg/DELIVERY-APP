import { describe, expect, it } from "vitest";
import { summarize, type PayEntry } from "@/lib/clockin/payroll";
import {
  combinaSemanas, diasDeLaSemana, eleccionDeRango, inicioDeSemanaDePago, parametrosDeRango,
  rangoDeLaEleccion, semanasDePagoDelRango, semanasDePagoSinRecortar, type DatosDeSemana,
} from "@/lib/timetracker/rango-de-nomina";

// 2026-11-27 es viernes (inicio de la semana de pago); 2026-12-03 jueves; 2026-11-24 martes.
const HOY = "2026-11-24";

describe("semana de pago: de viernes a jueves", () => {
  it("el inicio de la semana es el viernes que la contiene", () => {
    expect(inicioDeSemanaDePago("2026-11-27")).toBe("2026-11-27");
    expect(inicioDeSemanaDePago("2026-12-03")).toBe("2026-11-27");
    expect(inicioDeSemanaDePago("2026-11-28")).toBe("2026-11-27");
    expect(inicioDeSemanaDePago("2026-11-26")).toBe("2026-11-20");
  });

  it("los siete días van de viernes a jueves", () => {
    const d = diasDeLaSemana("2026-11-27");
    expect(d).toHaveLength(7);
    expect(d[0]).toBe("2026-11-27");
    expect(d[6]).toBe("2026-12-03");
  });
});

describe("semanasDePagoDelRango", () => {
  it("un rango que cae en una semana da esa semana", () => {
    expect(semanasDePagoSinRecortar("2026-11-24", "2026-11-24")).toEqual(["2026-11-20"]);
  });

  it("un rango que cruza semanas da cada semana que toca, la más antigua primero", () => {
    expect(semanasDePagoSinRecortar("2026-11-24", "2026-12-08")).toEqual(["2026-11-20", "2026-11-27", "2026-12-04"]);
  });

  it("un rango de más de catorce semanas se recorta a las catorce más recientes", () => {
    const todas = semanasDePagoSinRecortar("2026-01-01", "2026-12-31");
    const s = semanasDePagoDelRango("2026-01-01", "2026-12-31");
    expect(s).toHaveLength(14);
    expect(s).toEqual(todas.slice(-14));
    expect(s[13]).toBe("2026-12-25");
  });

  it("un rango al revés no da semanas", () => {
    expect(semanasDePagoSinRecortar("2026-12-01", "2026-11-01")).toEqual([]);
  });
});

describe("elección del menú y parámetros de la URL", () => {
  it("el rango de esta semana de pago es «semana» (y no «hoy», aunque coincidan)", () => {
    expect(eleccionDeRango("2026-11-20", "2026-11-26", HOY)).toEqual({ atajo: "semana", desde: "", hasta: "" });
  });

  it("un rango que no es de ningún atajo es «otro», con sus fechas", () => {
    expect(eleccionDeRango("2026-10-05", "2026-10-20", HOY)).toEqual({ atajo: "otro", desde: "2026-10-05", hasta: "2026-10-20" });
    // Octubre entero sí es «mes pasado» con HOY = 24-nov.
    expect(eleccionDeRango("2026-10-01", "2026-10-31", HOY).atajo).toBe("mes-pasado");
  });

  it("una sola semana de pago viaja como ?period=, varias como desde/hasta", () => {
    expect(parametrosDeRango({ desde: "2026-11-27", hasta: "2026-12-03" })).toEqual({ period: "2026-11-27" });
    expect(parametrosDeRango({ desde: "2026-11-01", hasta: "2026-11-30" })).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(parametrosDeRango({ desde: "", hasta: "2026-11-30" })).toBeNull();
  });

  it("«esta semana» resuelve a la semana de pago entera, de viernes a jueves", () => {
    const r = rangoDeLaEleccion({ atajo: "semana", desde: "", hasta: "" }, HOY);
    expect(r).toEqual({ desde: "2026-11-20", hasta: "2026-11-24" });
    expect(parametrosDeRango(r!)).toEqual({ period: "2026-11-20" });
  });
});

// Dos semanas de pago: A (20-nov) y B (27-nov), con dos personas.
const fichaje = (id: string, emp: string, desde: string, hasta: string | null): PayEntry => ({
  id, employee_id: emp, clock_in_at: desde, clock_out_at: hasta, lunch_minutes: null,
});
const semanaA: DatosDeSemana = {
  signedOff: true, isOwner: true, approved: ["ana", "luis"],
  people: [{ id: "ana", name: "Ana", store: "s1", scheduledMin: 2400, remote: false }, { id: "luis", name: "Luis", store: "s2", scheduledMin: 0, remote: true }],
  stores: [{ key: "s1", name: "Norte" }, { key: "s2", name: "Sur" }],
  entries: [
    fichaje("a1", "ana", "2026-11-23T14:00:00Z", "2026-11-23T22:00:00Z"), // 8 h
    fichaje("l1", "luis", "2026-11-24T14:00:00Z", "2026-11-24T16:00:00Z"), // 2 h
  ],
};
const semanaB: DatosDeSemana = {
  signedOff: false, isOwner: true, approved: ["ana"],
  people: [{ id: "ana", name: "Ana", store: "s1", scheduledMin: 2400, remote: false }],
  stores: [{ key: "s1", name: "Norte" }],
  entries: [
    fichaje("a2", "ana", "2026-11-30T14:00:00Z", "2026-11-30T19:00:00Z"), // 5 h
    fichaje("a3", "ana", "2026-12-01T14:00:00Z", "2026-12-01T16:30:00Z"), // 2.5 h
  ],
};

describe("combinaSemanas", () => {
  it("una sola semana es la misma semana (identidad)", () => {
    expect(combinaSemanas([semanaA])).toBe(semanaA);
  });

  it("el total de cada persona en dos semanas es el total de la semana A más el de la B", () => {
    const junto = combinaSemanas([semanaA, semanaB]);
    const porPersona = (id: string) => summarize(junto.entries.filter((e) => e.employee_id === id)).totalMin;
    expect(porPersona("ana")).toBe(summarize(semanaA.entries.filter((e) => e.employee_id === "ana")).totalMin + summarize(semanaB.entries).totalMin);
    expect(porPersona("ana")).toBe(480 + 300 + 150);
    expect(porPersona("luis")).toBe(120);
  });

  it("personas y horas programadas: una fila por persona, con las horas de sus semanas sumadas", () => {
    const junto = combinaSemanas([semanaA, semanaB]);
    expect(junto.people.map((p) => p.id)).toEqual(["ana", "luis"]);
    expect(junto.people[0].scheduledMin).toBe(4800);
    expect(junto.stores.map((t) => t.key)).toEqual(["s1", "s2"]);
  });

  it("aprobado solo si lo está en todas las semanas; cerrado solo si todas están cerradas", () => {
    const junto = combinaSemanas([semanaA, semanaB]);
    expect(junto.approved).toEqual(["ana"]);
    expect(junto.signedOff).toBe(false);
    expect(junto.isOwner).toBe(true);
  });
});
