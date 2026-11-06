import { describe, it, expect } from "vitest";
import { camionesDelDia, fechaValida, peticionValida, planDeCamion, puedeVerPosicionDeChoferes, repartoParaElMapa, type CamionDeUnDia, type CamionHabitual, type PasoDeCamion } from "./camion-del-dia";

/** Qué camión lleva cada chofer cada día (D-NEXT): el habitual de Ajustes, la excepción del día y la regla de «un camión, un chofer». */

const T1 = "111111111111111", T2 = "222222222222222", T3 = "333333333333333";
const ANA = "aaaaaaaa-0000-4000-8000-000000000001", LUIS = "aaaaaaaa-0000-4000-8000-000000000002", EVA = "aaaaaaaa-0000-4000-8000-000000000003";
const HABITUALES: CamionHabitual[] = [{ imei: T1, driver_id: ANA }, { imei: T2, driver_id: LUIS }, { imei: T3, driver_id: null }];

/** Aplica los pasos como lo haría la base, comprobando en CADA paso que ningún camión queda con dos choferes. */
function aplica(delDia: CamionDeUnDia[], pasos: PasoDeCamion[]): CamionDeUnDia[] {
  let filas = [...delDia];
  for (const p of pasos) {
    filas = filas.filter((f) => f.driver_id !== p.driver_id);
    if (p.op === "pon") filas.push({ driver_id: p.driver_id, imei: p.imei });
    const usados = filas.flatMap((f) => (f.imei ? [f.imei] : []));
    expect(new Set(usados).size, "el índice único (day, imei) no se rompe a medio camino").toBe(usados.length);
  }
  return filas;
}
const camionDe = (delDia: CamionDeUnDia[], chofer: string) => camionesDelDia(HABITUALES, delDia).get(chofer)?.imei ?? null;

describe("camionesDelDia", () => {
  it("sin nada ese día, cada chofer lleva su habitual", () => {
    const r = camionesDelDia(HABITUALES, []);
    expect(r.get(ANA)).toEqual({ imei: T1, origen: "usual" });
    expect(r.get(LUIS)).toEqual({ imei: T2, origen: "usual" });
    expect(r.has(EVA)).toBe(false);
  });

  it("lo del día manda, y «sin camión» se respeta", () => {
    const r = camionesDelDia(HABITUALES, [{ driver_id: ANA, imei: T3 }, { driver_id: LUIS, imei: null }]);
    expect(r.get(ANA)).toEqual({ imei: T3, origen: "day" });
    expect(r.get(LUIS)).toEqual({ imei: null, origen: "day" });
  });

  it("si a otro se le dio mi habitual ese día, yo quedo sin camión: nunca un camión con dos choferes", () => {
    const r = camionesDelDia(HABITUALES, [{ driver_id: EVA, imei: T1 }]);
    expect(r.get(EVA)?.imei).toBe(T1);
    expect(r.has(ANA)).toBe(false);
    const todos = [...r.values()].flatMap((c) => (c.imei ? [c.imei] : []));
    expect(new Set(todos).size).toBe(todos.length);
  });

  it("dos rastreadores enlazados al mismo chofer: el habitual es siempre el mismo (IMEI menor)", () => {
    expect(camionesDelDia([{ imei: T2, driver_id: ANA }, { imei: T1, driver_id: ANA }], []).get(ANA)?.imei).toBe(T1);
  });
});

describe("planDeCamion — un camión no va con dos choferes el mismo día", () => {
  it("un camión libre se da sin más", () => {
    const plan = planDeCamion(HABITUALES, [], { driverId: EVA, imei: T3 });
    expect(plan).toEqual({ ok: true, pasos: [{ op: "pon", driver_id: EVA, imei: T3 }] });
  });

  it("el camión que lleva otro NO se pisa: conflicto, con quién lo tiene y qué recibiría a cambio", () => {
    expect(planDeCamion(HABITUALES, [], { driverId: ANA, imei: T2 })).toEqual({ ok: false, conflicto: { driverId: LUIS, imei: T2, aCambio: T1 } });
    expect(planDeCamion(HABITUALES, [], { driverId: EVA, imei: T2 })).toEqual({ ok: false, conflicto: { driverId: LUIS, imei: T2, aCambio: null } });
    // También cuando el otro lo tiene por una asignación del día, no por habitual.
    expect(planDeCamion(HABITUALES, [{ driver_id: EVA, imei: T3 }], { driverId: ANA, imei: T3 })).toMatchObject({ ok: false, conflicto: { driverId: EVA } });
  });

  it("intercambio entre dos habituales: cada uno acaba con el del otro", () => {
    const plan = planDeCamion(HABITUALES, [], { driverId: ANA, imei: T2, intercambia: true });
    expect(plan.ok).toBe(true);
    const filas = aplica([], plan.ok ? plan.pasos : []);
    expect(camionDe(filas, ANA)).toBe(T2);
    expect(camionDe(filas, LUIS)).toBe(T1);
  });

  it("intercambio cuando yo no tenía camión: el otro queda SIN camión, dicho con una fila", () => {
    const plan = planDeCamion(HABITUALES, [], { driverId: EVA, imei: T2, intercambia: true });
    const filas = aplica([], plan.ok ? plan.pasos : []);
    expect(camionDe(filas, EVA)).toBe(T2);
    expect(camionDe(filas, LUIS)).toBeNull();
  });

  it("deshacer un intercambio con otro intercambio deja a cada uno con su habitual", () => {
    const ida = planDeCamion(HABITUALES, [], { driverId: ANA, imei: T2, intercambia: true });
    const filas = aplica([], ida.ok ? ida.pasos : []);
    const vuelta = planDeCamion(HABITUALES, filas, { driverId: ANA, imei: T1, intercambia: true });
    const fin = aplica(filas, vuelta.ok ? vuelta.pasos : []);
    expect(camionDe(fin, ANA)).toBe(T1);
    expect(camionDe(fin, LUIS)).toBe(T2);
  });

  it("«sin camión» y «el habitual»", () => {
    expect(planDeCamion(HABITUALES, [], { driverId: ANA, imei: null })).toEqual({ ok: true, pasos: [{ op: "pon", driver_id: ANA, imei: null }] });
    // Quien no tiene habitual no necesita una fila para ir sin camión.
    expect(planDeCamion(HABITUALES, [{ driver_id: EVA, imei: T3 }], { driverId: EVA, imei: null })).toEqual({ ok: true, pasos: [{ op: "quita", driver_id: EVA }] });
    expect(planDeCamion(HABITUALES, [{ driver_id: ANA, imei: T3 }], { driverId: ANA, imei: "usual" })).toEqual({ ok: true, pasos: [{ op: "quita", driver_id: ANA }] });
    // Pedir a mano justo el habitual es lo mismo.
    expect(planDeCamion(HABITUALES, [{ driver_id: ANA, imei: null }], { driverId: ANA, imei: T1 })).toEqual({ ok: true, pasos: [{ op: "quita", driver_id: ANA }] });
  });

  it("volver al habitual cuando hoy lo lleva otro: conflicto, no se lo quita en silencio", () => {
    const delDia = [{ driver_id: EVA, imei: T1 }];
    expect(planDeCamion(HABITUALES, delDia, { driverId: ANA, imei: "usual" })).toMatchObject({ ok: false, conflicto: { driverId: EVA, imei: T1, aCambio: null } });
    const plan = planDeCamion(HABITUALES, delDia, { driverId: ANA, imei: "usual", intercambia: true });
    const fin = aplica(delDia, plan.ok ? plan.pasos : []);
    expect(camionDe(fin, ANA)).toBe(T1);
    expect(camionDe(fin, EVA)).toBeNull();
  });
});

describe("repartoParaElMapa — los camiones sin chofer ese día no se pintan", () => {
  const asignaciones = [
    { driverId: ANA, driver: "Ana", imei: T1, origin: "usual" as const },
    { driverId: LUIS, driver: "Luis", imei: T2, origin: "usual" as const },
  ];
  it("habitual + ruta ese día = asignado; habitual SIN ruta ese día = sin asignar; sin chofer = sin asignar", () => {
    const r = repartoParaElMapa([T1, T2, T3], asignaciones, new Set([ANA]));
    expect([...r.asignados.keys()]).toEqual([T1]);
    expect(r.asignados.get(T1)).toEqual({ driverId: ANA, driver: "Ana" });
    expect(r.sinAsignar).toEqual([T2, T3]);
  });
  it("el que alguien puso a mano ese día cuenta como asignado aunque el chofer aún no tenga paradas", () => {
    const r = repartoParaElMapa([T1, T2, T3], [...asignaciones, { driverId: EVA, driver: "Eva", imei: T3, origin: "day" as const }], new Set());
    expect([...r.asignados.keys()]).toEqual([T3]);
    expect(r.sinAsignar).toEqual([T1, T2]);
  });
  it("«sin camión ese día» no asigna nada", () => {
    expect(repartoParaElMapa([T1], [{ driverId: ANA, driver: "Ana", imei: null, origin: "day" as const }], new Set([ANA])).sinAsignar).toEqual([T1]);
  });
});

describe("lo que llega del selector", () => {
  it("fechas de verdad", () => {
    expect(fechaValida("2026-11-06")).toBe(true);
    for (const mala of ["2026-02-31", "06/11/2026", "", null, 20261106]) expect(fechaValida(mala)).toBe(false);
  });
  it("valida chofer y camión; «usual», null y un IMEI", () => {
    expect(peticionValida({ date: "2026-11-06", driver_id: ANA, imei: T1, swap: true })).toEqual({ ok: true, fecha: "2026-11-06", peticion: { driverId: ANA, imei: T1, intercambia: true } });
    expect(peticionValida({ date: "2026-11-06", driver_id: ANA, imei: null })).toMatchObject({ ok: true, peticion: { imei: null, intercambia: false } });
    expect(peticionValida({ date: "2026-11-06", driver_id: ANA, imei: "usual" })).toMatchObject({ ok: true, peticion: { imei: "usual" } });
    expect(peticionValida({ date: "2026-11-06", driver_id: "x", imei: T1 }).ok).toBe(false);
    expect(peticionValida({ date: "2026-11-06", driver_id: ANA, imei: "'; drop table" }).ok).toBe(false);
    expect(peticionValida({ date: "ayer", driver_id: ANA, imei: T1 }).ok).toBe(false);
    expect(peticionValida(null).ok).toBe(false);
  });
  it("la posición de los choferes: los mismos roles que leen driver_locations", () => {
    expect(["admin", "logistics", "manager", "warehouse"].every(puedeVerPosicionDeChoferes)).toBe(true);
    expect(["sales", "driver", "", null, undefined].some(puedeVerPosicionDeChoferes)).toBe(false);
  });
});
