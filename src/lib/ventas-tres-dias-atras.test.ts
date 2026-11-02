import { describe, expect, it } from "vitest";
import { DIAS_ATRAS_DE_VENTAS_EN_TODAS, enLaVentanaDeOrdenes, pasaLaVentana, type ContextoDeLista } from "./ordenes-visibles";
import { shiftDateISO, todayISO } from "./utils";
import type { Delivery } from "./types";

/** D-NEXT: ventas con «Todas» ve hasta tres días atrás; con «Hoy»/«Mañana», el corte de ayer de siempre. */
const HOY = "2026-10-12";
const orden = (fecha: string) => ({ delivery_date: fecha, stage: "delivered" }) as unknown as Delivery;
const ctx = (chip: string, role = "sales"): ContextoDeLista => ({
  me: { id: "v", role, store: "RDZ Pharr", permissions: [] } as ContextoDeLista["me"], teaching: false, veTodoElHistorial: false,
  busqueda: "", reglas: {} as ContextoDeLista["reglas"], tiendas: [], tiendasDeAlmacen: [], chip,
});

describe("tres días atrás para ventas en «Todas»", () => {
  it("enLaVentanaDeOrdenes con diasAtras: el suelo baja a hoy − N", () => {
    expect(DIAS_ATRAS_DE_VENTAS_EN_TODAS).toBe(3);
    expect(enLaVentanaDeOrdenes(orden("2026-10-09"), HOY, 3)).toBe(true);
    expect(enLaVentanaDeOrdenes(orden("2026-10-08"), HOY, 3)).toBe(false);
    expect(enLaVentanaDeOrdenes(orden("2026-10-09"), HOY)).toBe(false); // sin N, el de siempre (ayer)
  });
  it("pasaLaVentana: ventas + «Todas» → tres días; «Hoy» o «Mañana», o un gerente → ayer", () => {
    const hoy = todayISO();
    const haceTres = orden(shiftDateISO(hoy, -3)); const haceCuatro = orden(shiftDateISO(hoy, -4)); const anteayer = orden(shiftDateISO(hoy, -2));
    expect(pasaLaVentana(haceTres, ctx("all"))).toBe(true);
    expect(pasaLaVentana(haceCuatro, ctx("all"))).toBe(false);
    expect(pasaLaVentana(anteayer, ctx("today"))).toBe(false);
    expect(pasaLaVentana(anteayer, ctx("all", "manager"))).toBe(false);
  });
});
