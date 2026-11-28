import { describe, expect, it } from "vitest";
import { dejaAntesDeRecoger } from "./deja-antes-de-recoger";
import { validaLaRuta } from "./validador";
import type { OrdenEntrada, ParadaRef } from "./types";

const o = (id: string, origen: string, destino: string): OrdenEntrada => ({ id, origen, destino, pallets: 1, ventana: null, servicioRecogidaMin: 0, servicioEntregaMin: 0 }) as OrdenEntrada;
const ordenes = [o("A", "pharr", "mcallen"), o("B", "mcallen", "edinburg"), o("C", "pharr", "cliente-1")];
const P = (orden: string): ParadaRef => ({ orden, tipo: "P" });
const D = (orden: string): ParadaRef => ({ orden, tipo: "D" });
const txt = (s: ParadaRef[]) => s.map((p) => p.tipo + p.orden).join(" ");

describe("D-1212 · deja antes de recoger en la misma tienda", () => {
  // Lleva A para McAllen, recoge B en McAllen y deja A después: mal.
  const mala = [P("A"), P("C"), P("B"), D("C"), D("A"), D("B")];

  it("the validator flags picking up at a store while carrying something for it", () => {
    const r = validaLaRuta({ chofer: { id: "x", capacidad: 10 } as never, secuencia: mala, ordenes });
    expect(r.violaciones.some((v) => v.clave === "recoge_llevando_para_esa_tienda")).toBe(true);
  });
  it("the repair drops A at McAllen right before picking up B", () => {
    expect(txt(dejaAntesDeRecoger(mala, ordenes))).toBe("PA PC DA PB DC DB");
  });
  it("a good route is left alone, and it is idempotent", () => {
    const buena = [P("A"), D("A"), P("B"), D("B")];
    expect(txt(dejaAntesDeRecoger(buena, ordenes))).toBe(txt(buena));
    const una = dejaAntesDeRecoger(mala, ordenes);
    expect(txt(dejaAntesDeRecoger(una, ordenes))).toBe(txt(una));
  });
  it("fixed (done) stops are not moved", () => {
    expect(txt(dejaAntesDeRecoger(mala, ordenes, 6))).toBe(txt(mala));
  });
});
