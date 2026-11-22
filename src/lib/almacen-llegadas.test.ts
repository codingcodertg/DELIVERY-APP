import { describe, expect, it } from "vitest";
import { choferesDeLaTienda, estadoDelChofer, hhmm, ordenaChoferes, pasadaMasCercana, pasadas, picoDeCarga, toca, type ParadaDeAlmacen } from "./almacen-llegadas";

const P = (id: string, dr: string, seq: number, k: "P" | "D", eta: number, extra: Partial<ParadaDeAlmacen> = {}): ParadaDeAlmacen => ({
  id, dr, seq, k, eta, place: k === "P" ? "RDZ Pharr" : "", code: id, no: 1, inv: "1", type: "Customer", from: "RDZ Pharr", to: "", pal: 1, stage: "approved", win: "", city: "Pharr", ...extra,
});

// Julio: recoge 2 en Pharr a las 8:30, entrega, vuelve a Pharr a las 10:00 y le trae una intertienda a las 9:40.
const ruta = [
  P("a", "Julio", 0, "P", 510), P("b", "Julio", 1, "P", 515), P("a", "Julio", 2, "D", 540), P("b", "Julio", 3, "D", 560),
  P("c", "Julio", 4, "P", 570, { place: "RDZ McAllen", type: "Intertienda", to: "RDZ Pharr", pal: 0.5 }), P("c", "Julio", 5, "D", 580, { type: "Intertienda", to: "RDZ Pharr", pal: 0.5 }),
  P("d", "Julio", 6, "P", 600, { pal: 5 }), P("d", "Julio", 7, "D", 640, { pal: 5 }),
  P("e", "Max", 0, "P", 700, { place: "RDZ Brownsville" }), P("e", "Max", 1, "D", 760),
];
const delPlan = (p: ParadaDeAlmacen) => p.dr;

describe("almacén · llegadas (D-1125)", () => {
  it("una tienda toca al chofer por sus recogidas y por las intertiendas que le trae", () => {
    expect(toca(ruta[0], "RDZ Pharr")).toBe(true);
    expect(toca(ruta[5], "RDZ Pharr")).toBe(true);
    expect(toca(ruta[4], "RDZ Pharr")).toBe(false);
  });

  it("agrupa en pasadas lo que está a ≤ 10 min", () => {
    const [j] = choferesDeLaTienda(ruta, "RDZ Pharr", delPlan);
    expect(j.dr).toBe("Julio");
    expect(pasadas(j.aqui).map((g) => g.map((x) => x.eta))).toEqual([[510, 515], [580], [600]]);
  });

  it("solo salen los choferes que pasan por la tienda", () => {
    expect(choferesDeLaTienda(ruta, "RDZ Pharr", delPlan).map((c) => c.dr)).toEqual(["Julio"]);
    expect(choferesDeLaTienda(ruta, "RDZ Brownsville", delPlan).map((c) => c.dr)).toEqual(["Max"]);
  });

  it("estado: viene, aquí, N paradas antes, ya pasó", () => {
    const [j] = choferesDeLaTienda(ruta, "RDZ Pharr", delPlan);
    expect(estadoDelChofer(j, "RDZ Pharr", 500)).toMatchObject({ tipo: "viene", min: 10 });
    expect(estadoDelChofer(j, "RDZ Pharr", 520).tipo).toBe("aqui");
    expect(estadoDelChofer(j, "RDZ Pharr", 535)).toMatchObject({ tipo: "antes", paradas: 3 });
    expect(estadoDelChofer(j, "RDZ Pharr", 700).tipo).toBe("paso");
  });

  it("quitar una orden (sin chofer) la saca de su pasada; si la pasada queda vacía, desaparece", () => {
    const sinD = (p: ParadaDeAlmacen) => (p.id === "d" ? null : p.dr);
    const [j] = choferesDeLaTienda(ruta, "RDZ Pharr", sinD);
    expect(j.pasadas.map((g) => g[0].eta)).toEqual([510, 580]);
  });

  it("abre la pasada más cercana a la hora actual", () => {
    const [j] = choferesDeLaTienda(ruta, "RDZ Pharr", delPlan);
    expect(pasadaMasCercana(j, 500)).toBe(510);
    expect(pasadaMasCercana(j, 595)).toBe(600);
  });

  it("el que está aquí va primero en la lista", () => {
    const cs = choferesDeLaTienda(ruta, "RDZ Pharr", delPlan);
    expect(ordenaChoferes(cs, "RDZ Pharr", 512)[0].e.tipo).toBe("aqui");
  });

  it("pico de carga: suma al recoger, resta al entregar, y cuenta la que se le asignaría", () => {
    expect(picoDeCarga(ruta, "Julio", delPlan)).toBe(5);
    expect(picoDeCarga(ruta, "Max", delPlan, "d")).toBe(5);
  });

  it("hora de reloj", () => {
    expect(hhmm(513)).toBe("8:33 am");
    expect(hhmm(780)).toBe("1:00 pm");
    expect(hhmm(720)).toBe("12:00 pm");
  });
});
