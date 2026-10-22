import { describe, expect, it } from "vitest";
import {
  ahoraEnTexas, motivoPorCupo, motivoPorHora, motivosDeAprobacion, ocupadasPorVentana, reglasDeAprobacion,
  siguienteDiaDeTrabajo, textoDelMotivo, type FilaDeCupo, type ReglasDeAprobacion,
} from "./aprobacion-por-hora-y-cupo";
import { naceAprobada } from "./cuenta-aprobacion";
import { etapaAlEnviar } from "./enviar-borrador";
import { notificationsForStage } from "./notifications";
import type { Profile } from "./types";

// Reglas propias de la prueba: nombres de tienda inventados, para no atar el repo a los de Ajustes.
const R: ReglasDeAprobacion = { corte: "16:30", cupo: { "0830-1000": 2, "0830-1200": 1 }, tiendas_sin_cupo: ["Tienda Lejos"] };

// 2026-10-22 es jueves, en horario de verano (Texas = UTC-5): las 16:30 de Texas son las 21:30Z.
const JUEVES_1629 = new Date("2026-10-22T21:29:00Z");
const JUEVES_1630 = new Date("2026-10-22T21:30:00Z");

describe("hora de Texas", () => {
  it("lee fecha y minuto en Texas, con el cambio de horario", () => {
    expect(ahoraEnTexas(JUEVES_1630)).toEqual({ fecha: "2026-10-22", minuto: 16 * 60 + 30 });
    // En invierno Texas es UTC-6: las 21:30Z son las 15:30.
    expect(ahoraEnTexas(new Date("2026-12-03T21:30:00Z"))).toEqual({ fecha: "2026-12-03", minuto: 15 * 60 + 30 });
    // De noche en Texas ya es el día siguiente en UTC.
    expect(ahoraEnTexas(new Date("2026-10-23T03:00:00Z")).fecha).toBe("2026-10-22");
  });

  it("el siguiente día de trabajo salta el domingo", () => {
    expect(siguienteDiaDeTrabajo("2026-10-22")).toBe("2026-10-23");
    expect(siguienteDiaDeTrabajo("2026-10-24")).toBe("2026-10-26"); // sábado → lunes
    expect(siguienteDiaDeTrabajo("2026-12-31")).toBe("2027-01-01");
  });
});

describe("hora de corte", () => {
  const orden = (delivery_date: string, delivery_windows: string) => ({ delivery_date, delivery_windows });

  it("antes del corte no salta nada, ni para hoy", () => {
    expect(motivoPorHora(orden("2026-10-22", "0830-1730"), JUEVES_1629, R)).toBeNull();
    expect(motivoPorHora(orden("2026-10-23", "0830-1000"), JUEVES_1629, R)).toBeNull();
  });

  it("pasado el corte, hoy en cualquier ventana", () => {
    expect(motivoPorHora(orden("2026-10-22", "1200-1730"), JUEVES_1630, R)?.tipo).toBe("corte_hoy");
    expect(motivoPorHora(orden("2026-10-22T00:00:00", "0830-1730"), JUEVES_1630, R)?.tipo).toBe("corte_hoy");
  });

  it("pasado el corte, mañana solo en las ventanas de la mañana", () => {
    expect(motivoPorHora(orden("2026-10-23", "0830-1000"), JUEVES_1630, R)?.tipo).toBe("corte_manana");
    expect(motivoPorHora(orden("2026-10-23", "0830-1200"), JUEVES_1630, R)?.tipo).toBe("corte_manana");
    expect(motivoPorHora(orden("2026-10-23", "0830-1730"), JUEVES_1630, R)).toBeNull();
    expect(motivoPorHora(orden("2026-10-23", "1200-1730"), JUEVES_1630, R)).toBeNull();
    expect(motivoPorHora(orden("2026-10-24", "0830-1000"), JUEVES_1630, R)).toBeNull();
  });

  it("el sábado por la tarde, la mañana que cuenta es la del lunes", () => {
    const sabado = new Date("2026-10-24T22:00:00Z"); // 17:00 en Texas
    expect(motivoPorHora(orden("2026-10-26", "0830-1000"), sabado, R)?.tipo).toBe("corte_manana");
  });

  it("en invierno el corte es a las 22:30Z, no a las 21:30Z", () => {
    expect(motivoPorHora(orden("2026-12-03", "0830-1730"), new Date("2026-12-03T22:29:00Z"), R)).toBeNull();
    expect(motivoPorHora(orden("2026-12-03", "0830-1730"), new Date("2026-12-03T22:30:00Z"), R)?.tipo).toBe("corte_hoy");
  });

  it("sin fecha, o con el corte vacío en Ajustes, nada", () => {
    expect(motivoPorHora(orden("", "0830-1000"), JUEVES_1630, R)).toBeNull();
    expect(motivoPorHora(orden("2026-10-22", "0830-1000"), JUEVES_1630, { ...R, corte: "" })).toBeNull();
  });
});

describe("cupo de la mañana", () => {
  const fila = (id: string, delivery_windows: string, extra: Partial<FilaDeCupo> = {}): FilaDeCupo =>
    ({ id, store: "Tienda Centro", delivery_windows, stage: "approved", ...extra });

  it("cuenta las vivas, también las pendientes, y no las muertas, las de práctica, las de fuera ni la propia", () => {
    const filas = [
      fila("a", "0830-1000"),
      fila("b", "0830-1000", { stage: "pending" }),
      fila("c", "0830-1000", { stage: "draft" }),
      fila("d", "0830-1000", { stage: "canceled" }),
      fila("e", "0830-1000", { stage: "rejected" }),
      fila("f", "0830-1000", { is_training: true }),
      fila("g", "0830-1000", { store: " tienda lejos " }),
      fila("h", "0830-1200", { stage: "delivered" }),
      fila("i", "0830-1730"),
    ];
    expect(ocupadasPorVentana(filas, R)).toEqual({ "0830-1000": 2, "0830-1200": 1 });
    expect(ocupadasPorVentana(filas, R, "a")).toEqual({ "0830-1000": 1, "0830-1200": 1 });
  });

  it("la tercera de 8:30-10 y la segunda de 8:30-12 van a aprobación; la anterior, no", () => {
    expect(motivoPorCupo({ store: "Tienda Centro", delivery_windows: "0830-1000" }, { "0830-1000": 1, "0830-1200": 0 }, R)).toBeNull();
    expect(motivoPorCupo({ store: "Tienda Centro", delivery_windows: "0830-1000" }, { "0830-1000": 2, "0830-1200": 0 }, R))
      .toEqual({ tipo: "cupo", ventana: "0830-1000", tope: 2, ocupadas: 2 });
    expect(motivoPorCupo({ store: "Tienda Centro", delivery_windows: "0830-1200" }, { "0830-1000": 0, "0830-1200": 0 }, R)).toBeNull();
    expect(motivoPorCupo({ store: "Tienda Centro", delivery_windows: "0830-1200" }, { "0830-1000": 0, "0830-1200": 1 }, R)?.tipo).toBe("cupo");
  });

  it("no aplica a la tienda de fuera, a una ventana sin cupo, ni sin el conteo", () => {
    expect(motivoPorCupo({ store: "Tienda Lejos", delivery_windows: "0830-1000" }, { "0830-1000": 9 }, R)).toBeNull();
    expect(motivoPorCupo({ store: "Tienda Centro", delivery_windows: "0830-1730" }, { "0830-1730": 9 }, R)).toBeNull();
    expect(motivoPorCupo({ store: "Tienda Centro", delivery_windows: "0830-1000" }, null, R)).toBeNull();
  });

  it("los dos motivos juntos, primero la hora", () => {
    const m = motivosDeAprobacion({ delivery_date: "2026-10-23", delivery_windows: "0830-1000", store: "Tienda Centro" }, JUEVES_1630, { "0830-1000": 2 }, R);
    expect(m.map((x) => x.tipo)).toEqual(["corte_manana", "cupo"]);
  });
});

describe("lo que se guarda en Ajustes", () => {
  it("campo a campo encima de los defectos", () => {
    const def = reglasDeAprobacion(null);
    expect(def.corte).toBe("16:30");
    expect(def.cupo).toEqual({ "0830-1000": 2, "0830-1200": 1 });
    const r = reglasDeAprobacion({ corte: "17:00" });
    expect(r.corte).toBe("17:00");
    expect(r.cupo).toEqual(def.cupo);
    expect(r.tiendas_sin_cupo).toEqual(def.tiendas_sin_cupo);
    expect(reglasDeAprobacion({ cupo: { "0830-1000": 3 } }).cupo).toEqual({ "0830-1000": 3 });
  });
});

describe("el texto para el vendedor", () => {
  it("con la hora y la ventana en 12 horas", () => {
    expect(textoDelMotivo({ tipo: "corte_manana", corte: "16:30" }, false)).toBe("It's for tomorrow morning and it's past 4:30 pm");
    expect(textoDelMotivo({ tipo: "corte_hoy", corte: "16:30" }, true)).toBe("Es para hoy y ya pasaron las 4:30 pm");
    expect(textoDelMotivo({ tipo: "cupo", ventana: "0830-1000", tope: 2, ocupadas: 2 }, false))
      .toBe("The 8:30 am-10:00 am window already has 2 of 2 orders that day");
  });
});

describe("quién aprueba", () => {
  const base = { creaComoOficina: false, tiendaAutoAprueba: true, cuentaPideAprobacion: false, intertiendaSinPo: false };

  it("la tienda que aprueba sola deja de hacerlo con un motivo; la oficina sigue aprobando", () => {
    expect(naceAprobada(base)).toBe(true);
    expect(naceAprobada({ ...base, fueraDeHoraOCupo: true })).toBe(false);
    expect(naceAprobada({ ...base, creaComoOficina: true, fueraDeHoraOCupo: true })).toBe(true);
    expect(etapaAlEnviar("sales", { ...base, fueraDeHoraOCupo: true })).toBe("pending");
    expect(etapaAlEnviar("sales", base)).toBe("approved");
  });

  it("el aviso de pendiente llega también a Office, con el motivo", () => {
    const users = [
      { id: "m", role: "manager" }, { id: "o", role: "accounting" }, { id: "s", role: "sales" },
    ] as Profile[];
    const seeds = notificationsForStage({ stage: "pending", order_no: 7, order_code: "FV1", delivery_id: "x", creatorId: "s", actorId: "s", users, reason: "It's for today and it's past 4:30 pm" });
    expect(seeds.map((s) => s.user_id).sort()).toEqual(["m", "o"]);
    expect(seeds[0].message).toBe("Order #FV1 is awaiting your approval: It's for today and it's past 4:30 pm");
  });
});
