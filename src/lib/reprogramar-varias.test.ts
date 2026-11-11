import { describe, expect, it } from "vitest";
import { resumenDeReprogramarVarias, separaParaReprogramar } from "./reprogramar-varias";
import { ordenesSinFecha, PESTANA_FECHA_PENDIENTE } from "./fecha-pendiente-pestana";
import { pastillasDeOrdenes } from "./pastillas-de-ordenes";
import { cuentasDeOrdenes, filasDeOrdenes } from "./filas-de-ordenes";
import type { Delivery } from "./types";

/** D-994: «reschedule multiple at a time» (Gestor) y «a tab saying Pending Delivery Date» (Órdenes), los dos de Roberto. */
describe("reprogramar varias a la vez", () => {
  const o = (id: string, stage: string, delivery_date: string | null = "2026-11-12") => ({ id, stage, delivery_date });
  it("se salta lo entregado, lo anulado y lo que ya tiene esa fecha; logística reprograma lo abierto", () => {
    const r = separaParaReprogramar([o("1", "ready"), o("2", "delivered"), o("3", "canceled"), o("4", "approved", "2026-11-14")], "2026-11-14", "logistics");
    expect(r.pueden.map((d) => d.id)).toEqual(["1"]);
    expect(r.saltadas.map((s) => `${s.d.id}:${s.motivo}`)).toEqual(["2:etapa", "3:etapa", "4:misma_fecha"]);
  });
  it("«Fecha pendiente» (sin día): lo que ya no tiene día se salta", () => {
    const r = separaParaReprogramar([o("1", "ready"), o("2", "ready", null)], null, "admin");
    expect(r.pueden.map((d) => d.id)).toEqual(["1"]);
    expect(r.saltadas[0].motivo).toBe("misma_fecha");
  });
  it("el aviso dice cuántas se movieron y por qué se saltaron las otras", () => {
    expect(resumenDeReprogramarVarias({ movidas: 3, fallidas: 0, porEtapa: 1, mismaFecha: 0 }, "2026-11-14").en)
      .toBe("Rescheduled 3 to 2026-11-14. 1 skipped (delivered, canceled or not allowed for your role).");
    expect(resumenDeReprogramarVarias({ movidas: 2, fallidas: 1, porEtapa: 0, mismaFecha: 0 }, null).es)
      .toBe("Reprogramadas 2 a Fecha pendiente. 1 no se pudieron guardar.");
  });
});

describe("la pestaña «Pending Delivery Date» de Órdenes", () => {
  const d = (id: string, stage: string, delivery_date: string | null): Delivery => ({ id, stage, delivery_date } as unknown as Delivery);
  const visibles = [d("1", "approved", null), d("2", "ready", "2026-11-12"), d("3", "canceled", null), d("4", "delivered", null)];
  const conPendientes = [d("1", "approved", null), d("5", "pending", null)];
  it("junta las sin día que siguen abiertas, sin repetir", () => {
    expect(ordenesSinFecha(visibles, conPendientes).map((x) => x.id)).toEqual(["1", "5"]);
  });
  it("sale como pastilla, al final, con su número; y al pulsarla enseña esas filas", () => {
    const listas = { visibles, conPendientes, atrasadas: [] };
    const cuentas = cuentasDeOrdenes(listas, PESTANA_FECHA_PENDIENTE, () => true, {});
    const p = pastillasDeOrdenes({ etapas: ["approved"], todasAprueban: false, cuentas, filtro: PESTANA_FECHA_PENDIENTE, pendientesSinTienda: false });
    expect(p[p.length - 1]).toMatchObject({ key: PESTANA_FECHA_PENDIENTE, cuenta: 2, activa: true });
    expect(filasDeOrdenes(listas, PESTANA_FECHA_PENDIENTE, () => false, {}).map((x) => x.id)).toEqual(["1", "5"]);
  });
});
