import { describe, expect, it } from "vitest";
import { botonesConLlegada, llegadaDeLaOrden, seRecogeDeUnToque, siguienteDeMiRuta, textoDePosicion } from "./siguiente-de-mi-ruta";
import type { FilaDeLaRuta } from "@/lib/route-plan/lectura-de-ruta";
import type { LlegadaDeParada } from "@/lib/acciones-parada";

// D-533 · El dueño, 2026-10-12, con dos recogidas (179500 y 179510) en la misma tienda:
// «next stop 1 of 5 and pickup will be one of two … when you press arrived, it should be arrived for both pickup. And when
//  you press pickup, it should pick up number one and then take you to the next order».

const t = (en: string) => en;
const P = (ordenes: string[], etiqueta = "P1"): FilaDeLaRuta => ({ tipo: "P", ordenes, lugar: "RDZ Brownsville", etiqueta } as unknown as FilaDeLaRuta);
const D = (orden: string, etiqueta = "D1"): FilaDeLaRuta => ({ tipo: "D", orden, etiqueta } as unknown as FilaDeLaRuta);

// La ruta del caso: dos recogidas en la tienda (UNA parada, la 1) y dos entregas (paradas 2 y 3).
const filas = [P(["o1"], "P1"), P(["o2"], "P2"), D("o1", "D1"), D("o2", "D2")];
const numeradas = {
  deFila: [1, 1, 2, 3],
  paradas: [
    { numero: 1, tipo: "P" as const, filas: [0, 1], etiquetas: ["P1", "P2"], ordenes: ["o1", "o2"], lugar: "RDZ Brownsville" },
    { numero: 2, tipo: "D" as const, filas: [2], etiquetas: ["D1"], ordenes: ["o1"], lugar: null },
    { numero: 3, tipo: "D" as const, filas: [3], etiquetas: ["D2"], ordenes: ["o2"], lugar: null },
  ],
};
const etapas = (e: Record<string, string>) => (id: string) => e[id];
const sin = new Map<string, unknown>();

describe("siguienteDeMiRuta: fila por fila, parada por parada", () => {
  it("las dos en la tienda: recogida 1 de 2, parada 1 de 3", () => {
    expect(siguienteDeMiRuta(filas, numeradas, etapas({ o1: "ready", o2: "ready" }), sin))
      .toEqual({ id: "o1", tipo: "P", parada: 1, totalParadas: 3, posicion: 1, deLaParada: 2 });
  });
  it("recogida la primera, toca la SEGUNDA recogida (no la entrega de la primera): recogida 2 de 2", () => {
    expect(siguienteDeMiRuta(filas, numeradas, etapas({ o1: "picked_up", o2: "ready" }), sin))
      .toEqual({ id: "o2", tipo: "P", parada: 1, totalParadas: 3, posicion: 2, deLaParada: 2 });
  });
  it("las dos en el camión: la entrega de la primera, parada 2 de 3, sin «1 de 1»", () => {
    const s = siguienteDeMiRuta(filas, numeradas, etapas({ o1: "picked_up", o2: "picked_up" }), sin);
    expect(s).toEqual({ id: "o1", tipo: "D", parada: 2, totalParadas: 3, posicion: 1, deLaParada: 1 });
    expect(textoDePosicion(s!, t)).toBeNull();
  });
  it("entregada la primera: la entrega de la segunda; entregadas las dos: nada", () => {
    expect(siguienteDeMiRuta(filas, numeradas, etapas({ o1: "delivered", o2: "picked_up" }), sin)?.id).toBe("o2");
    expect(siguienteDeMiRuta(filas, numeradas, etapas({ o1: "delivered", o2: "delivered" }), sin)).toBeNull();
  });
  it("una rechazada por el cliente no toca; una anulada tampoco; una que no se encuentra, tampoco", () => {
    expect(siguienteDeMiRuta(filas, numeradas, etapas({ o1: "picked_up", o2: "picked_up" }), new Map([["o1", {}]]))?.id).toBe("o2");
    expect(siguienteDeMiRuta(filas, numeradas, etapas({ o1: "canceled", o2: "ready" }), sin)?.id).toBe("o2");
    expect(siguienteDeMiRuta(filas, numeradas, etapas({ o2: "ready" }), sin)?.id).toBe("o2");
  });
  it("una recogida que el almacén no tiene lista sigue siendo la siguiente (se recoge de todos modos, D-527)", () => {
    expect(siguienteDeMiRuta(filas, numeradas, etapas({ o1: "approved", o2: "ready" }), sin)?.id).toBe("o1");
    expect(siguienteDeMiRuta(filas, numeradas, etapas({ o1: "fulfilling", o2: "ready" }), sin)?.id).toBe("o1");
  });
  it("una entrega solo toca con la orden EN EL CAMIÓN: una fila de entrega de una orden aún en la tienda no es la siguiente", () => {
    const soloEntrega = [D("o1")];
    const n = { deFila: [1], paradas: [{ numero: 1, tipo: "D" as const, filas: [0], etiquetas: ["D1"], ordenes: ["o1"], lugar: null }] };
    expect(siguienteDeMiRuta(soloEntrega, n, etapas({ o1: "ready" }), sin)).toBeNull();
    expect(siguienteDeMiRuta(soloEntrega, n, etapas({ o1: "picked_up" }), sin)?.id).toBe("o1");
  });
  it("la posición cuenta las órdenes de la parada, incluidas las ya hechas: «2 de 2» tras recoger la primera", () => {
    expect(textoDePosicion({ tipo: "P", posicion: 2, deLaParada: 2 }, t)).toBe("Pickup 2 of 2");
    expect(textoDePosicion({ tipo: "D", posicion: 1, deLaParada: 3 }, t)).toBe("Delivery 1 of 3");
    expect(textoDePosicion({ tipo: "P", posicion: 1, deLaParada: 2 }, (_en, es) => es)).toBe("Recogida 1 de 2");
  });
});

describe("un solo botón que cambia", () => {
  const pendiente: LlegadaDeParada = { estado: "pendiente", tipo: "P", ordenes: ["o1", "o2"] };
  const hecha: LlegadaDeParada = { estado: "hecha", at: "2026-10-12T15:00:00Z", tipo: "P", ordenes: ["o1", "o2"], conLlegada: ["o1", "o2"] };
  it("la llegada de la parada vale para cada orden de su tramo, y para ninguna otra", () => {
    expect(llegadaDeLaOrden(pendiente, "o1")).toBe(pendiente);
    expect(llegadaDeLaOrden(pendiente, "o2")).toBe(pendiente);
    expect(llegadaDeLaOrden(pendiente, "o3")).toBeNull();
    expect(llegadaDeLaOrden(null, "o1")).toBeNull();
  });
  it("con la llegada pendiente, fuera «Recogido» y «Entregado»; «Rechazado», «Dejar» y «Deshacer recogido» se quedan", () => {
    const todos = [{ accion: "recoger" }, { accion: "entregar" }, { accion: "rechazar" }, { accion: "dejar" }, { accion: "deshacer_recogida" }];
    expect(botonesConLlegada(todos, pendiente).map((b) => b.accion)).toEqual(["rechazar", "dejar", "deshacer_recogida"]);
    expect(botonesConLlegada(todos, hecha).map((b) => b.accion)).toEqual(["recoger", "entregar", "rechazar", "dejar", "deshacer_recogida"]);
    expect(botonesConLlegada(todos, null).map((b) => b.accion)).toEqual(["recoger", "entregar", "rechazar", "dejar", "deshacer_recogida"]);
  });
  it("«Recogido» se hace de un toque solo con la carga lista", () => {
    expect(seRecogeDeUnToque("ready")).toBe(true);
    for (const s of ["approved", "fulfilling", "pending", "draft", "picked_up", null, undefined]) expect(seRecogeDeUnToque(s)).toBe(false);
  });
});
