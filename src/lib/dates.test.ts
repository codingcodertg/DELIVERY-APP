import { describe, it, expect, vi, afterEach } from "vitest";
import { localISO, todayISO, isToday, isOverdue, deliveryRisk, withinRetention, awaitingDriver } from "@/lib/utils";
import { mkDelivery } from "@/lib/__fixtures";

// Regression cover for a real bug: dates were derived with toISOString(), which
// converts to UTC. West of Greenwich that rolls the calendar day forward late in
// the evening — 7pm CDT is already "tomorrow" in UTC — so "today" and overdue
// checks silently disagreed with the user's actual date after ~7pm.

afterEach(() => vi.useRealTimers());

describe("localISO", () => {
  it("uses local calendar parts, not UTC", () => {
    // 19:30 on 15 Jul, local. In UTC (behind Greenwich) this is already 16 Jul.
    const d = new Date(2026, 6, 15, 19, 30, 0);
    expect(localISO(d)).toBe("2026-07-15");
  });

  it("zero-pads month and day", () => {
    expect(localISO(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });

  it("holds at 23:59 local — the worst case for a UTC shift", () => {
    expect(localISO(new Date(2026, 6, 15, 23, 59, 59))).toBe("2026-07-15");
  });

  it("holds at 00:01 local", () => {
    expect(localISO(new Date(2026, 6, 15, 0, 1, 0))).toBe("2026-07-15");
  });
});

describe("todayISO at a late-evening clock", () => {
  it("still reports today, not tomorrow", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 19, 30, 0));
    expect(todayISO()).toBe("2026-07-15");
  });
});

describe("isToday / isOverdue agree with the local date late in the day", () => {
  it("treats today's order as today at 19:30", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 19, 30, 0));
    expect(isToday("2026-07-15")).toBe(true);
    expect(isOverdue(mkDelivery({ stage: "ready", delivery_date: "2026-07-15" }))).toBe(false);
  });

  it("marks yesterday's undelivered order overdue at 19:30", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 19, 30, 0));
    expect(isOverdue(mkDelivery({ stage: "ready", delivery_date: "2026-07-14" }))).toBe(true);
  });

  it("never marks a delivered or canceled order overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 19, 30, 0));
    expect(isOverdue(mkDelivery({ stage: "delivered", delivery_date: "2026-07-01" }))).toBe(false);
    expect(isOverdue(mkDelivery({ stage: "canceled", delivery_date: "2026-07-01" }))).toBe(false);
  });
});

describe("deliveryRisk", () => {
  it("carries no risk for a delivered order", () => {
    expect(deliveryRisk(mkDelivery({ stage: "delivered", delivery_date: "2020-01-01" }))).toBeNull();
  });
  it("is overdue when a past day is still open", () => {
    expect(deliveryRisk(mkDelivery({ stage: "ready", delivery_date: "2020-01-01" }))).toBe("overdue");
  });
  it("is overdue when today's window has already closed", () => {
    const now = new Date(); now.setHours(15, 0, 0, 0);
    const d = mkDelivery({ stage: "ready", delivery_date: todayISO(), delivery_windows: "1000-1200" });
    expect(deliveryRisk(d, now)).toBe("overdue");
  });
  it("is at risk when today's window closes within the hour", () => {
    const now = new Date(); now.setHours(11, 30, 0, 0);
    const d = mkDelivery({ stage: "ready", delivery_date: todayISO(), delivery_windows: "1000-1200" });
    expect(deliveryRisk(d, now)).toBe("at_risk");
  });
  it("is clear when today's window is comfortably ahead", () => {
    const now = new Date(); now.setHours(8, 0, 0, 0);
    const d = mkDelivery({ stage: "ready", delivery_date: todayISO(), delivery_windows: "1400-1600" });
    expect(deliveryRisk(d, now)).toBeNull();
  });
});

describe("withinRetention — yesterday, today, and everything ahead", () => {
  const TODAY = "2026-07-15";

  it("shows yesterday and today", () => {
    // Yesterday stays because a stop that slipped past midnight is still work.
    expect(withinRetention(mkDelivery({ stage: "ready", delivery_date: "2026-07-14" }), TODAY)).toBe(true);
    expect(withinRetention(mkDelivery({ stage: "ready", delivery_date: "2026-07-15" }), TODAY)).toBe(true);
  });

  it("shows the future, however far out", () => {
    // There is deliberately no ceiling: a driver wanting to see what's coming
    // had no way to, and a warehouse preparing ahead couldn't either.
    expect(withinRetention(mkDelivery({ stage: "ready", delivery_date: "2026-07-16" }), TODAY)).toBe(true);
    expect(withinRetention(mkDelivery({ stage: "ready", delivery_date: "2026-08-20" }), TODAY)).toBe(true);
    expect(withinRetention(mkDelivery({ stage: "ready", delivery_date: "2027-01-01" }), TODAY)).toBe(true);
  });

  it("cuts off the day before yesterday ONCE THE ORDER IS CLOSED", () => {
    // El punto de la ventana: una lista que llega semanas atrás entierra el trabajo de hoy debajo
    // de negocio terminado. Lo que se corta es el pasado CERRADO — entregada o anulada.
    //
    // Antes esta prueba decía «whatever the stage» y usaba `ready`, o sea una orden ABIERTA y
    // vencida. Pasaba, y eso era justo el fallo: escondía trabajo vivo.
    expect(withinRetention(mkDelivery({ stage: "delivered", delivery_date: "2026-07-13" }), TODAY)).toBe(false);
    expect(withinRetention(mkDelivery({ stage: "canceled", delivery_date: "2026-06-30" }), TODAY)).toBe(false);
  });

  it("pero una ATRASADA que sigue abierta entra, tenga la fecha que tenga", () => {
    // El dueño eligió con cuatro palabras: «ayer, hoy, futuro y atrasadas». Y es la misma razón
    // que ya tenía escrita D-351 para la vista «Reciente»: una vencida sin entregar es trabajo
    // vivo, no historial, y esconderla es perderla.
    for (const stage of ["approved", "fulfilling", "ready", "picked_up"] as const) {
      expect([stage, withinRetention(mkDelivery({ stage, delivery_date: "2026-07-13" }), TODAY)])
        .toEqual([stage, true]);
      expect([stage, withinRetention(mkDelivery({ stage, delivery_date: "2026-05-01" }), TODAY)])
        .toEqual([stage, true]);
    }
  });

  it("la entregada y la abierta del MISMO día viejo se separan: ahí está la diferencia", () => {
    // Las dos con fecha del 13. Si esta prueba cayera, la ventana habría vuelto a mirar solo la
    // fecha, que es el mutante que hay que cazar.
    expect(withinRetention(mkDelivery({ stage: "ready", delivery_date: "2026-07-13" }), TODAY)).toBe(true);
    expect(withinRetention(mkDelivery({ stage: "delivered", delivery_date: "2026-07-13" }), TODAY)).toBe(false);
  });

  it("manda el `today` que se le pasa, no el reloj de la máquina", () => {
    // Un mutante que cambiaba `< today` por `< todayISO()` dentro de `isOverdue` SOBREVIVIÓ a todo
    // lo demás, y con razón: como el `TODAY` de estas pruebas es del pasado, la fecha real siempre
    // es mayor y las dos versiones contestan igual. Una prueba con un día fijo del pasado no puede
    // distinguir «usa mi día» de «usa el de hoy».
    //
    // Este caso las separa poniendo el día fijo en el FUTURO: el 10 de enero de 2027 está atrasado
    // respecto al 15, pero no respecto a hoy. Solo la versión que respeta el parámetro lo rescata.
    const futuro = "2027-01-15";
    expect(withinRetention(mkDelivery({ stage: "ready", delivery_date: "2027-01-10" }), futuro)).toBe(true);
    expect(withinRetention(mkDelivery({ stage: "delivered", delivery_date: "2027-01-10" }), futuro)).toBe(false);
    expect(isOverdue(mkDelivery({ stage: "ready", delivery_date: "2027-01-10" }), futuro)).toBe(true);
  });

  it("brings a slipped order back when it's reprogrammed into the window", () => {
    // Una entregada vieja no se ve; reprogramarla hacia delante la devuelve.
    expect(withinRetention(mkDelivery({ stage: "delivered", delivery_date: "2026-07-12" }), TODAY)).toBe(false);
    expect(withinRetention(mkDelivery({ stage: "delivered", delivery_date: "2026-07-16" }), TODAY)).toBe(true);
  });

  it("handles a month boundary", () => {
    // String comparison would be wrong here without real date maths: the day
    // before 2026-07-01 is 2026-06-30, not "2026-07-00".
    expect(withinRetention(mkDelivery({ stage: "delivered", delivery_date: "2026-06-30" }), "2026-07-01")).toBe(true);
    expect(withinRetention(mkDelivery({ stage: "delivered", delivery_date: "2026-06-29" }), "2026-07-01")).toBe(false);
  });

  it("dentro de la ventana, la etapa da igual: lo de ayer sale este como este", () => {
    // Lo que la etapa decide es solo si una orden VIEJA se rescata. Del suelo hacia delante no
    // decide nada.
    expect(withinRetention(mkDelivery({ stage: "delivered", delivery_date: "2026-07-14" }), TODAY)).toBe(true);
    expect(withinRetention(mkDelivery({ stage: "canceled", delivery_date: "2026-07-14" }), TODAY)).toBe(true);
    expect(withinRetention(mkDelivery({ stage: "ready", delivery_date: "2026-07-14" }), TODAY)).toBe(true);
  });

  it("always keeps an undated draft visible", () => {
    expect(withinRetention(mkDelivery({ stage: "draft", delivery_date: null }), TODAY)).toBe(true);
  });
});

// ---- awaitingDriver ---------------------------------------------------------
describe("awaitingDriver", () => {
  it("counts live work with nobody driving it", () => {
    expect(awaitingDriver({ assigned_driver: null, stage: "approved" })).toBe(true);
    expect(awaitingDriver({ assigned_driver: null, stage: "ready" })).toBe(true);
  });

  it("does NOT count a draft", () => {
    // The reported bug: a draft has no driver either, but nobody has submitted
    // it, so it was appearing on the "unscheduled" list as work to assign.
    expect(awaitingDriver({ assigned_driver: null, stage: "draft" })).toBe(false);
  });

  it("does not count finished or abandoned orders", () => {
    for (const stage of ["delivered", "canceled", "rejected"]) {
      expect(awaitingDriver({ assigned_driver: null, stage })).toBe(false);
    }
  });

  it("does not count an order that already has a driver", () => {
    expect(awaitingDriver({ assigned_driver: "Maximo Garza", stage: "ready" })).toBe(false);
  });

  it("treats a missing stage as not waiting, rather than guessing", () => {
    expect(awaitingDriver({ assigned_driver: null })).toBe(true);
  });
});
