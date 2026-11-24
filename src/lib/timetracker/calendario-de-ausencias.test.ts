import { describe, it, expect } from "vitest";
import { ausentesPorDia, cuadriculaDelMes, mesVecino, recorteDeDia, sumarDias, type Ausencia } from "./calendario-de-ausencias";

const fila = (over: Partial<Ausencia>): Ausencia => ({
  id: "x", nombre: "Ana", type: "vacation", start_date: "2026-11-10", end_date: "2026-11-10", status: "approved", ...over,
});

describe("cuadriculaDelMes: 6 semanas, domingo primero", () => {
  it("un mes que empieza en domingo no retrocede ninguna casilla", () => {
    // 1 de noviembre de 2026 es domingo.
    const c = cuadriculaDelMes(2026, 11, "2026-11-24");
    expect(c).toHaveLength(42);
    expect(c[0].fecha).toBe("2026-11-01");
    expect(c.filter((d) => d.delMes)).toHaveLength(30);
  });

  it("un mes que empieza en jueves completa la semana con el domingo anterior", () => {
    // 1 de enero de 2026 es jueves: la primera casilla es el domingo 28 de diciembre.
    const c = cuadriculaDelMes(2026, 1, "2026-01-01");
    expect(c[0].fecha).toBe("2025-12-28");
    expect(c[0].delMes).toBe(false);
    expect(c[4].fecha).toBe("2026-01-01");
    expect(c[4].delMes).toBe(true);
  });

  it("un mes que empieza en sábado deja el domingo anterior como primera casilla", () => {
    // 1 de agosto de 2026 es sábado.
    const c = cuadriculaDelMes(2026, 8, "2026-08-01");
    expect(c[0].fecha).toBe("2026-07-26");
    expect(c[6].fecha).toBe("2026-08-01");
    expect(c[6].delMes).toBe(true);
  });

  it("marca solo el día de hoy", () => {
    const c = cuadriculaDelMes(2026, 11, "2026-11-24");
    expect(c.filter((d) => d.hoy).map((d) => d.fecha)).toEqual(["2026-11-24"]);
  });

  it("febrero de un año bisiesto tiene 29 días", () => {
    const c = cuadriculaDelMes(2028, 2, "2028-02-01");
    expect(c.filter((d) => d.delMes)).toHaveLength(29);
  });
});

describe("mesVecino y sumarDias", () => {
  it("cruza el año en los dos sentidos", () => {
    expect(mesVecino(2026, 12, 1)).toEqual({ anio: 2027, mes: 1 });
    expect(mesVecino(2026, 1, -1)).toEqual({ anio: 2025, mes: 12 });
    expect(mesVecino(2026, 11, 1)).toEqual({ anio: 2026, mes: 12 });
  });

  it("suma días sin que la zona horaria mueva el día", () => {
    expect(sumarDias("2026-02-28", 1)).toBe("2026-03-01");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("ausentesPorDia", () => {
  it("una solicitud cubre cada día de start_date a end_date, los dos incluidos", () => {
    const m = ausentesPorDia([fila({ start_date: "2026-11-10", end_date: "2026-11-12" })],
      ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect([...m.keys()]).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
  });

  it("una solicitud que cruza dos meses se ve en los dos, cada uno en su cuadrícula", () => {
    const solicitud = fila({ start_date: "2026-01-30", end_date: "2026-02-02" });
    // La cuadrícula de enero llega hasta el 7 de febrero, así que también enseña el 1 y el 2.
    const enero = ausentesPorDia([solicitud], cuadriculaDelMes(2026, 1, "2026-01-01").map((d) => d.fecha));
    const febrero = ausentesPorDia([solicitud], cuadriculaDelMes(2026, 2, "2026-02-01").map((d) => d.fecha));
    expect([...enero.keys()]).toEqual(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
    expect([...febrero.keys()]).toEqual(["2026-02-01", "2026-02-02"]);
  });

  it("distingue pendiente de aprobada", () => {
    const m = ausentesPorDia([fila({ id: "a", status: "approved" }), fila({ id: "p", nombre: "Luis", status: "pending", type: "sick" })], ["2026-11-10"]);
    expect(m.get("2026-11-10")).toEqual([
      { id: "a", nombre: "Ana", pendiente: false, tipo: "vacation" },
      { id: "p", nombre: "Luis", pendiente: true, tipo: "sick" },
    ]);
  });

  it("deja fuera las denegadas, las canceladas, los cambios de horario y los intercambios de turno", () => {
    const m = ausentesPorDia([
      fila({ id: "d", status: "denied" }),
      fila({ id: "c", status: "cancelled" }),
      fila({ id: "h", type: "schedule_change" }),
      fila({ id: "s", type: "shift_swap" }),
    ], ["2026-11-10"]);
    expect(m.size).toBe(0);
  });

  it("ordena por nombre dentro de un día", () => {
    const m = ausentesPorDia([fila({ id: "1", nombre: "Zoe" }), fila({ id: "2", nombre: "Ana", type: "sick" })], ["2026-11-10"]);
    expect(m.get("2026-11-10")!.map((x) => x.nombre)).toEqual(["Ana", "Zoe"]);
  });
});

describe("recorteDeDia: el «+N más»", () => {
  const cinco = ["A", "B", "C", "D", "E"].map((n, i) => ({ id: String(i), nombre: n, pendiente: false, tipo: "vacation" }));

  it("con más de tres, enseña tres y cuenta el resto", () => {
    const r = recorteDeDia(cinco);
    expect(r.visibles.map((x) => x.nombre)).toEqual(["A", "B", "C"]);
    expect(r.restantes).toBe(2);
  });

  it("con tres o menos, no corta nada", () => {
    const r = recorteDeDia(cinco.slice(0, 3));
    expect(r.visibles).toHaveLength(3);
    expect(r.restantes).toBe(0);
  });
});
