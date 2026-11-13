import { describe, expect, it } from "vitest";
import { planDeFechaDelRelevo } from "./relevo-fechas";

const paso = (id: string, step: number | null, fecha: string | null, stage = "ready") =>
  ({ id, order_no: 1554, order_code: "FW565", order_suffix: step ? "ab"[step - 1] : null, relay_step: step, is_training: false, stage, delivery_date: fecha });

describe("fechas de un relevo: el paso b nunca antes que el a (D-1018)", () => {
  const a = paso("a", 1, "2026-11-13");
  const b = paso("b", 2, "2026-11-13");
  it("una orden que no es relevo no tiene regla", () => {
    const suelta = paso("x", null, "2026-11-13");
    expect(planDeFechaDelRelevo(suelta, "2026-11-01", [suelta])).toEqual({ bloqueo: null, arrastra: [] });
  });
  it("mover b a un día ANTES que a se bloquea", () => {
    const p = planDeFechaDelRelevo(b, "2026-11-12", [a, b]);
    expect(p.bloqueo?.en).toContain("can't be scheduled before");
    expect(p.arrastra).toEqual([]);
  });
  it("mover b al mismo día o después de a se permite", () => {
    expect(planDeFechaDelRelevo(b, "2026-11-13", [a, b]).bloqueo).toBeNull();
    expect(planDeFechaDelRelevo(b, "2026-11-20", [a, b]).bloqueo).toBeNull();
  });
  it("b con día cuando a está sin día: se bloquea; b a «Fecha pendiente» siempre se puede", () => {
    const aSin = paso("a", 1, null);
    expect(planDeFechaDelRelevo(b, "2026-11-13", [aSin, b]).bloqueo?.es).toContain("no tiene día");
    expect(planDeFechaDelRelevo(b, null, [a, b])).toEqual({ bloqueo: null, arrastra: [] });
  });
  it("a entregado ya no frena a b", () => {
    const aHecho = paso("a", 1, "2026-11-13", "delivered");
    expect(planDeFechaDelRelevo(b, "2026-11-12", [aHecho, b]).bloqueo).toBeNull();
  });
  it("mover a DESPUÉS de b arrastra a b al mismo día; a «Fecha pendiente» deja a b sin día", () => {
    expect(planDeFechaDelRelevo(a, "2026-11-16", [a, b]).arrastra).toEqual([{ id: "b", fecha: "2026-11-16" }]);
    expect(planDeFechaDelRelevo(a, null, [a, b]).arrastra).toEqual([{ id: "b", fecha: null }]);
  });
  it("mover a antes o al mismo día que b no toca a b; un b que ya salió no se arrastra", () => {
    expect(planDeFechaDelRelevo(a, "2026-11-12", [a, b]).arrastra).toEqual([]);
    const bSalio = paso("b", 2, "2026-11-13", "picked_up");
    expect(planDeFechaDelRelevo(a, "2026-11-16", [a, bSalio]).arrastra).toEqual([]);
  });
  it("cadena de tres: se arrastran del último al primero", () => {
    const c = paso("c", 3, "2026-11-14");
    expect(planDeFechaDelRelevo(a, "2026-11-20", [a, b, c]).arrastra).toEqual([{ id: "c", fecha: "2026-11-20" }, { id: "b", fecha: "2026-11-20" }]);
  });
});

import { enOrdenDeRelevo } from "./reprogramar-varias";

describe("«Reprogramar N»: el orden de guardado con pasos de relevo (D-1018)", () => {
  const fila = (id: string, step: number | null, fecha: string) => ({ id, stage: "ready", delivery_date: fecha, relay_step: step });
  it("al atrasar (o quitar el día) va primero el paso b; al adelantar, primero el a", () => {
    const marcadas = [fila("a", 1, "2026-11-13"), fila("x", null, "2026-11-13"), fila("b", 2, "2026-11-13")];
    expect(enOrdenDeRelevo(marcadas, "2026-11-20").map((d) => d.id)).toEqual(["b", "a", "x"]);
    expect(enOrdenDeRelevo(marcadas, null).map((d) => d.id)).toEqual(["b", "a", "x"]);
    expect(enOrdenDeRelevo(marcadas, "2026-11-12").map((d) => d.id)).toEqual(["x", "a", "b"]);
  });
});
