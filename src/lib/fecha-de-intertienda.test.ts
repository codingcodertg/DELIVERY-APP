import { describe, expect, it } from "vitest";
import { aplicaTipo, borradorInicial, type ContextoDelUsuario } from "./order-sites";
import { fechaPorDefectoDeIntertienda, horaEnTexas } from "./fecha-de-intertienda";
import type { NamedLocation, OrderTypeRule } from "./types";

/** D-823: Roberto, «if anyone programs intertienda past 12pm then the default date should be tomorrow, not same date». */
// El 3 de noviembre de 2026 Texas va en CST (UTC−6).
const EN_TEXAS = (hhmm: string) => new Date(`2026-11-03T${hhmm}:00-06:00`);

describe("la fecha con la que nace una Intertienda", () => {
  it("antes de las 12 del mediodía en Texas, hoy; desde las 12, mañana", () => {
    expect(horaEnTexas(EN_TEXAS("11:59"))).toBe(11);
    expect(fechaPorDefectoDeIntertienda(EN_TEXAS("08:00"))).toBe("2026-11-03");
    expect(fechaPorDefectoDeIntertienda(EN_TEXAS("11:59"))).toBe("2026-11-03");
    expect(fechaPorDefectoDeIntertienda(EN_TEXAS("12:00"))).toBe("2026-11-04");
    expect(fechaPorDefectoDeIntertienda(EN_TEXAS("15:30"))).toBe("2026-11-04");
    expect(fechaPorDefectoDeIntertienda(EN_TEXAS("23:59"))).toBe("2026-11-04");
  });
  it("mira la hora de Texas, no la del reloj del aparato: medianoche en UTC sigue siendo la tarde de ayer en Texas", () => {
    // 00:30Z del día 4 = 18:30 del día 3 en Texas → mañana = el 4.
    expect(fechaPorDefectoDeIntertienda(new Date("2026-11-04T00:30:00Z"))).toBe("2026-11-04");
    // 13:00Z del día 3 = 07:00 en Texas → hoy = el 3.
    expect(fechaPorDefectoDeIntertienda(new Date("2026-11-03T13:00:00Z"))).toBe("2026-11-03");
  });
});

const REGLAS: Record<string, OrderTypeRule> = {
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Customer: { docRef: "invoice", storeToStore: false },
};
const TIENDAS: NamedLocation[] = [{ name: "Tienda Norte", address: "100 Norte Ave" }, { name: "Tienda Sur", address: "200 Sur Blvd" }];
const quien = (rol: string, ahora: Date): ContextoDelUsuario => ({ rol, miTienda: "Tienda Norte", tipos: ["Customer", "Intertienda"], tiendas: TIENDAS, reglas: REGLAS, ahora });

describe("en el formulario", () => {
  it("la Intertienda que abre office por la tarde nace para mañana; por la mañana, para hoy", () => {
    expect(borradorInicial({}, quien("manager", EN_TEXAS("15:00"))).delivery_date).toBe("2026-11-04");
    expect(borradorInicial({}, quien("manager", EN_TEXAS("09:00"))).delivery_date).toBe("2026-11-03");
  });
  it("al cambiar a Intertienda también; a Customer no; y una fecha ya puesta no se pisa", () => {
    expect(aplicaTipo({}, "Intertienda", quien("sales", EN_TEXAS("15:00"))).delivery_date).toBe("2026-11-04");
    expect(aplicaTipo({}, "Customer", quien("sales", EN_TEXAS("15:00"))).delivery_date).toBeUndefined();
    expect(aplicaTipo({ delivery_date: "2026-11-10" }, "Intertienda", quien("sales", EN_TEXAS("15:00"))).delivery_date).toBe("2026-11-10");
    // La orden de cliente que nace por la tarde sigue sin fecha: la pone la persona.
    expect(borradorInicial({}, quien("sales", EN_TEXAS("15:00"))).delivery_date).toBeUndefined();
  });
});
