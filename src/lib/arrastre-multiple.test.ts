import { describe, expect, it } from "vitest";
import { ordenSinRecoger, type ParadaDeLaLista } from "./lista-unica";
import { flechaDelBloque, mueveBloque, ordenesDelBloque } from "./arrastre-multiple";

/** Una lista de pares P/D: `pares(["o1","o2"])` = P o1, D o1, P o2, D o2. */
const pares = (ids: string[]): ParadaDeLaLista[] => ids.flatMap((id): ParadaDeLaLista[] => [
  { tipo: "P", ordenes: [id], tienda: "tienda" }, { tipo: "D", orden: id },
]);
/** La lista como texto corto: "P1 D1 P2 D2…". */
const txt = (l: readonly ParadaDeLaLista[]) => l.map((p) => (p.tipo === "P" ? `P${p.ordenes.join("+")}` : `D${p.orden}`)).join(" ");
const ids10 = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((n) => `o${n}`);

describe("ordenesDelBloque: qué arrastra una fila marcada", () => {
  it("una fila marcada con otra marcada en la lista forma bloque, en orden de lista", () => {
    const l = pares(["o1", "o2", "o3"]);
    expect(ordenesDelBloque(l, new Set(["o3", "o1"]), 4)).toEqual(["o1", "o3"]);
  });
  it("arrastrar una fila SIN marcar no forma bloque (se mueve sola)", () => {
    const l = pares(["o1", "o2", "o3"]);
    expect(ordenesDelBloque(l, new Set(["o1", "o3"]), 2)).toBeNull();
  });
  it("una sola orden marcada no forma bloque: se mueve la fila como siempre", () => {
    const l = pares(["o1", "o2"]);
    expect(ordenesDelBloque(l, new Set(["o2"]), 2)).toBeNull();
  });
});

describe("mueveBloque: el bloque de órdenes marcadas", () => {
  it("3 marcadas (las últimas) arrastradas por una a lo alto: las 3 al principio, en el mismo orden, con P y D", () => {
    const l = pares(ids10);
    // Marcadas las 3 últimas (o8, o9, o10); se arrastra la P de o9 (fila 16) a la fila 0.
    const r = mueveBloque(l, ["o8", "o9", "o10"], 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(txt(r.paradas)).toBe("Po8 Do8 Po9 Do9 Po10 Do10 Po1 Do1 Po2 Do2 Po3 Do3 Po4 Do4 Po5 Do5 Po6 Do6 Po7 Do7");
    expect(ordenSinRecoger(r.paradas)).toBeNull();
    expect(r.ordenes).toEqual(["o8", "o9", "o10"]);
  });

  it("bloque bajado: se queda DETRÁS de la fila de destino, en su orden", () => {
    const l = pares(["o1", "o2", "o3", "o4", "o5"]);
    // Marcadas o1 y o2 (filas 0-3); se sueltan sobre la D de o4 (fila 7).
    const r = mueveBloque(l, ["o1", "o2"], 7);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(txt(r.paradas)).toBe("Po3 Do3 Po4 Do4 Po1 Do1 Po2 Do2 Po5 Do5");
  });

  it("bloque con una entrega FIJA (ya entregada): no se mueve, conserva su puesto; el resto se acomoda alrededor", () => {
    const l = pares(["o1", "o2", "o3", "o4"]);
    // o2 está entregada (fija). Marcadas o1, o2 y o3: se arrastra la P de o1 a la D de o4 (fila 7), hacia abajo.
    const r = mueveBloque(l, ["o1", "o2", "o3"], 7, { fijas: new Set(["o2"]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Po2/Do2 (filas 2-3) siguen en sus puestos. El bloque sin o2 (o1 y o3) y la o4 ocupan los demás puestos.
    expect(r.paradas[2]).toEqual({ tipo: "P", ordenes: ["o2"], tienda: "tienda" });
    expect(r.paradas[3]).toEqual({ tipo: "D", orden: "o2" });
    expect(txt(r.paradas)).toBe("Po4 Do4 Po2 Do2 Po1 Do1 Po3 Do3");
  });

  it("bloque con pares recogida+entrega: la recogida de cada orden sigue antes que su entrega", () => {
    const l = pares(["o1", "o2", "o3", "o4"]);
    const r = mueveBloque(l, ["o2", "o4"], 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(txt(r.paradas)).toBe("Po2 Do2 Po4 Do4 Po1 Do1 Po3 Do3");
    expect(ordenSinRecoger(r.paradas)).toBeNull();
  });

  it("soltar dentro del propio bloque no hace nada (borde)", () => {
    const l = pares(["o1", "o2", "o3"]);
    expect(mueveBloque(l, ["o1", "o2"], 3)).toEqual({ ok: false, motivo: "borde" });
    expect(mueveBloque(l, ["o1", "o2"], 0)).toEqual({ ok: false, motivo: "borde" });
  });

  it("un bloque que ya está arriba y se sube al primer puesto no cambia nada (borde)", () => {
    const l = pares(["o1", "o2", "o3"]);
    expect(mueveBloque(l, ["o1"], 0)).toEqual({ ok: false, motivo: "borde" });
  });

  it("relevo: el paso b (o2) no puede quedar antes que la entrega de su paso a (o1); se niega y dice cuál", () => {
    const l = pares(["o1", "o2", "o3"]);
    // Se sube el bloque {o2, o3} al principio: la recogida de o2 quedaría antes que la entrega de o1.
    const r = mueveBloque(l, ["o2", "o3"], 0, { relevos: new Map([["o2", "o1"]]) });
    expect(r).toEqual({ ok: false, motivo: "relevo", orden: "o2" });
  });

  it("relevo: sin romperlo, el mismo bloque sí se mueve", () => {
    const l = pares(["o1", "o2", "o3", "o4"]);
    const r = mueveBloque(l, ["o3", "o4"], 2, { relevos: new Map([["o2", "o1"]]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(txt(r.paradas)).toBe("Po1 Do1 Po3 Do3 Po4 Do4 Po2 Do2");
  });
});

describe("flechaDelBloque: las flechas ↑ ↓ de una fila marcada", () => {
  it("↓ mueve el bloque un puesto: cruza la fila que tiene debajo", () => {
    const l = pares(["o1", "o2", "o3"]);
    const r = flechaDelBloque(l, ["o1", "o2"], 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(txt(r.paradas)).toBe("Po3 Do3 Po1 Do1 Po2 Do2");
  });
  it("↑ mueve el bloque un puesto: cruza la fila que tiene encima", () => {
    const l = pares(["o1", "o2", "o3"]);
    const r = flechaDelBloque(l, ["o2", "o3"], -1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(txt(r.paradas)).toBe("Po2 Do2 Po3 Do3 Po1 Do1");
  });
  it("↑ en lo alto de la lista, o ↓ en lo bajo, es borde", () => {
    const l = pares(["o1", "o2", "o3"]);
    expect(flechaDelBloque(l, ["o1", "o2"], -1)).toEqual({ ok: false, motivo: "borde" });
    expect(flechaDelBloque(l, ["o2", "o3"], 1)).toEqual({ ok: false, motivo: "borde" });
  });
});
