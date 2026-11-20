import { describe, it, expect } from "vitest";
import type { Delivery, DriverShift } from "./types";
import type { OrderTypeRules } from "./required";
import { resumenDeChoferes, diasTardeDe, millasGpsPorChofer, MAX_DANOS_MES, GRACIA_TARDE_MIN, type EntradaDeResumen } from "./resumen-de-choferes";

// Reglas de los tipos de la demo: Customer, Intertienda, Transfer, Proveedor.
const REGLAS: OrderTypeRules = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Intertienda: { storeToStore: true, docRef: "any", homeIsDestination: true },
  Transfer: { storeToStore: true, docRef: "estimate" },
  Proveedor: { storeToStore: false, hasCustomer: false, docRef: "hidden" },
};

// Día y minuto en UTC: en las pruebas la «hora local» es la UTC, para no depender de la zona de la máquina.
const diaLocal = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const minutoLocal = (ms: number) => new Date(ms).getUTCHours() * 60 + new Date(ms).getUTCMinutes();

const orden = (p: Partial<Delivery>) =>
  ({
    id: "x", order_no: 1, stage: "delivered", order_type: "Customer", assigned_driver: "Juan",
    delivery_date: "2026-10-05", input_date: null, created_at: "2026-10-01T10:00:00Z",
    route_miles: 10, delivery_fee: 0, pod_delivered_at: null, pickup_gps_at: null, departed_at: null,
    ...p,
  }) as unknown as Delivery;

const turno = (driver_id: string, started_at: string): DriverShift =>
  ({ id: started_at, driver_id, started_at, ended_at: null, device_id: null, created_at: started_at } as unknown as DriverShift);

const base = (p: Partial<EntradaDeResumen>): EntradaDeResumen => ({
  ordenes: [], turnos: [], choferes: [{ id: "j", nombre: "Juan", entradaMin: 480 }],
  desde: "2026-10-01", hasta: "2026-10-31", reglas: REGLAS, diaLocal, minutoLocal, gps: null,
  ahora: Date.parse("2026-11-19T12:00:00Z"),
  ...p,
});

describe("resumenDeChoferes: Juan, sobre todo traslados", () => {
  const ordenes = [
    orden({ id: "1", order_type: "Intertienda", stage: "delivered", route_miles: 20 }),
    orden({ id: "2", order_type: "Intertienda", stage: "delivered", route_miles: 20, delivery_date: "2026-10-06" }),
    orden({ id: "3", order_type: "Transfer", stage: "delivered", route_miles: 20, delivery_date: "2026-10-07" }),
    orden({ id: "4", order_type: "Customer", stage: "delivered", route_miles: 10, delivery_date: "2026-10-07" }),
    orden({ id: "5", order_type: "Customer", stage: "canceled", route_miles: 10, delivery_date: "2026-10-08" }),
  ];
  const [juan] = resumenDeChoferes(base({ ordenes, turnos: [turno("j", "2026-10-05T12:00:00Z")] }));

  it("separa entregas a clientes de traslados; las canceladas no cuentan", () => {
    expect(juan.entregas).toBe(1);
    expect(juan.traslados).toBe(3);
  });

  it("sin rastro GPS, las millas son las del sistema y la fuente lo dice", () => {
    expect(juan.millas).toBe(70);
    expect(juan.fuenteMillas).toBe("sistema");
    expect(juan.diasConRastro).toBe(0);
  });

  it("los traslados no hacen puntualidad: sin entregas a cliente con ventana, no hay %", () => {
    expect(juan.aTiempoPct).toBeNull();
  });

  it("el dato de piezas dañadas no tiene fuente: siempre nulo, y el máximo es 30", () => {
    expect(juan.danos).toBeNull();
    expect(MAX_DANOS_MES).toBe(30);
  });
});

describe("millas: GPS primero, sistema si no hay rastro", () => {
  const ordenes = [orden({ id: "1", order_type: "Customer", delivery_fee: 100, route_miles: 50 })];
  const turnos = [turno("j", "2026-10-05T12:00:00Z")];

  it("usa las millas GPS cuando el chofer tiene días con rastro, y calcula el ingreso por milla sobre ellas", () => {
    const gps = millasGpsPorChofer([{ chofer: "Juan", millas: 25, diasConRastro: 1, dias: 1 }]);
    const [juan] = resumenDeChoferes(base({ ordenes, turnos, gps }));
    expect(juan.millas).toBe(25);
    expect(juan.fuenteMillas).toBe("gps");
    expect(juan.diasConRastro).toBe(1);
    expect(juan.ingresoPorMilla).toBe(4);
  });

  it("si el GPS no tiene ningún día con rastro, cae a las del sistema", () => {
    const gps = millasGpsPorChofer([{ chofer: "Juan", millas: null, diasConRastro: 0, dias: 1 }]);
    const [juan] = resumenDeChoferes(base({ ordenes, turnos, gps }));
    expect(juan.millas).toBe(50);
    expect(juan.fuenteMillas).toBe("sistema");
    expect(juan.ingresoPorMilla).toBe(2);
  });
});

describe("asistencia: días trabajados y días tarde", () => {
  it("cuenta días con turno y días cuyo primer turno pasó la hora de entrada más el margen", () => {
    const turnos = [
      turno("j", "2026-10-02T07:50:00Z"), // a tiempo
      turno("j", "2026-10-03T08:30:00Z"), // tarde
      turno("j", "2026-10-03T13:00:00Z"), // segundo turno del mismo día: no cuenta otra vez
      turno("j", `2026-10-04T08:${String(GRACIA_TARDE_MIN + 1).padStart(2, "0")}:00Z`), // justo fuera del margen: tarde
      turno("j", `2026-10-05T08:${String(GRACIA_TARDE_MIN).padStart(2, "0")}:00Z`), // justo en el margen: a tiempo
    ];
    const [juan] = resumenDeChoferes(base({ turnos }));
    expect(juan.diasTrabajados).toBe(4);
    expect(juan.diasTarde).toBe(2);
  });

  it("sin hora de entrada en Ajustes, los días tarde son nulos (no se inventan)", () => {
    expect(diasTardeDe([turno("j", "2026-10-03T09:00:00Z")], null, diaLocal, minutoLocal)).toBeNull();
  });

  it("el primer turno del día es el que cuenta, aunque llegue en otro orden", () => {
    const turnos = [turno("j", "2026-10-03T13:00:00Z"), turno("j", "2026-10-03T07:45:00Z")];
    expect(diasTardeDe(turnos, 480, diaLocal, minutoLocal)).toBe(0);
  });
});

describe("rango del mes", () => {
  it("una orden de septiembre no entra en octubre; el turno de noviembre tampoco", () => {
    const ordenes = [
      orden({ id: "sep", delivery_date: "2026-09-30", order_type: "Customer" }),
      orden({ id: "oct", delivery_date: "2026-10-15", order_type: "Customer" }),
    ];
    const turnos = [turno("j", "2026-11-02T12:00:00Z")];
    const filas = resumenDeChoferes(base({ ordenes, turnos }));
    expect(filas).toHaveLength(1);
    expect(filas[0].entregas).toBe(1);
    expect(filas[0].diasTrabajados).toBe(0);
  });
});

describe("productividad: el tiempo activo incluye traslados, el conteo no", () => {
  it("suma el tiempo de salida→entregado de traslados y entregas, sobre el tiempo en turno", () => {
    const turnos = [turno("j", "2026-10-05T08:00:00Z")];
    // Turno de 08:00 a 16:00 sin cerrar: 8h en turno hasta `ahora`. Se fija `ahora` para que sea 8h exactas.
    const ordenes = [
      orden({ id: "c", order_type: "Customer", pickup_gps_at: "2026-10-05T09:00:00Z", pod_delivered_at: "2026-10-05T11:00:00Z" }),
      orden({ id: "t", order_type: "Intertienda", pickup_gps_at: "2026-10-05T12:00:00Z", pod_delivered_at: "2026-10-05T13:00:00Z" }),
    ];
    const [juan] = resumenDeChoferes(base({ ordenes, turnos, ahora: Date.parse("2026-10-05T16:00:00Z") }));
    // Activo 3h de 8h en turno = 38 %.
    expect(juan.productivoPct).toBe(38);
  });
});

describe("filas", () => {
  it("un chofer sin nada en el mes no sale", () => {
    expect(resumenDeChoferes(base({}))).toEqual([]);
  });
});
