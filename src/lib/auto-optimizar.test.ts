import { describe, expect, it } from "vitest";
import { huellaDeLaRuta, repartoDeLibertad, rutasAOptimizar, type CambioDeAsignacion } from "./auto-optimizar";

const c = (orden: string, dia: string | null, antes: string | null, despues: string | null): CambioDeAsignacion => ({ orden, dia, antes, despues });

describe("rutasAOptimizar", () => {
  it("una orden asignada a un chofer: una ruta, motivo «llega»", () => {
    expect(rutasAOptimizar([c("o1", "2026-11-24", null, "Ana")])).toEqual([
      { chofer: "Ana", dia: "2026-11-24", motivo: "llega", ordenes: ["o1"] },
    ]);
  });

  it("varias órdenes a un mismo chofer: UNA ruta con todas", () => {
    expect(rutasAOptimizar([
      c("o1", "2026-11-24", null, "Ana"),
      c("o2", "2026-11-24", null, "Ana"),
      c("o3", "2026-11-24", null, "Ana"),
    ])).toEqual([{ chofer: "Ana", dia: "2026-11-24", motivo: "llega", ordenes: ["o1", "o2", "o3"] }]);
  });

  it("repartir entre tres choferes: tres rutas, una por chofer, en orden de chofer", () => {
    const r = rutasAOptimizar([
      c("o1", "2026-11-24", null, "Luis"),
      c("o2", "2026-11-24", null, "Ana"),
      c("o3", "2026-11-24", null, "Marta"),
    ]);
    expect(r.map((x) => x.chofer)).toEqual(["Ana", "Luis", "Marta"]);
    expect(r.every((x) => x.motivo === "llega")).toBe(true);
    expect(r.map((x) => x.ordenes)).toEqual([["o2"], ["o1"], ["o3"]]);
  });

  it("mover de A a B: las dos rutas; A con «sale» y B con «llega»", () => {
    expect(rutasAOptimizar([c("o1", "2026-11-24", "Ana", "Luis")])).toEqual([
      { chofer: "Ana", dia: "2026-11-24", motivo: "sale", ordenes: ["o1"] },
      { chofer: "Luis", dia: "2026-11-24", motivo: "llega", ordenes: ["o1"] },
    ]);
  });

  it("un chofer que pierde y gana en el mismo lote: «ambas»", () => {
    const r = rutasAOptimizar([c("o1", "2026-11-24", "Ana", "Luis"), c("o2", "2026-11-24", "Luis", "Ana")]);
    expect(r).toEqual([
      { chofer: "Ana", dia: "2026-11-24", motivo: "ambas", ordenes: ["o1", "o2"] },
      { chofer: "Luis", dia: "2026-11-24", motivo: "ambas", ordenes: ["o1", "o2"] },
    ]);
  });

  it("el mismo chofer antes y después no cuenta", () => {
    expect(rutasAOptimizar([c("o1", "2026-11-24", "Ana", "Ana")])).toEqual([]);
  });

  it("sin día no produce ruta", () => {
    expect(rutasAOptimizar([c("o1", null, null, "Ana")])).toEqual([]);
  });

  it("sin chofer de un lado, ese lado no produce ruta", () => {
    expect(rutasAOptimizar([c("o1", "2026-11-24", "Ana", null)])).toEqual([
      { chofer: "Ana", dia: "2026-11-24", motivo: "sale", ordenes: ["o1"] },
    ]);
  });

  it("orden estable: por día y luego por chofer", () => {
    const r = rutasAOptimizar([
      c("o1", "2026-11-25", null, "Ana"),
      c("o2", "2026-11-24", null, "Luis"),
      c("o3", "2026-11-24", null, "Ana"),
    ]);
    expect(r.map((x) => `${x.dia} ${x.chofer}`)).toEqual(["2026-11-24 Ana", "2026-11-24 Luis", "2026-11-25 Ana"]);
  });
});

describe("huellaDeLaRuta", () => {
  const base = {
    chofer: "Ana",
    dia: "2026-11-24",
    paradas: [{ orden: "o1", tipo: "P" as const }, { orden: "o2", tipo: "P" as const }, { orden: "o1", tipo: "D" as const }, { orden: "o2", tipo: "D" as const }],
    ordenes: [
      { id: "o1", pallets: 2, origen: "T", destino: "X" },
      { id: "o2", pallets: 3.1, origen: "T", destino: "Y" },
    ],
  };

  it("igual para el mismo contenido, aunque las órdenes vengan en otro orden", () => {
    const otra = { ...base, ordenes: [...base.ordenes].reverse() };
    expect(huellaDeLaRuta(otra)).toBe(huellaDeLaRuta(base));
  });

  it("cambia si cambia una orden", () => {
    const otra = { ...base, ordenes: [{ ...base.ordenes[0], id: "o9" }, base.ordenes[1]] };
    expect(huellaDeLaRuta(otra)).not.toBe(huellaDeLaRuta(base));
  });

  it("cambia si cambian los pallets", () => {
    const otra = { ...base, ordenes: [{ ...base.ordenes[0], pallets: 2.5 }, base.ordenes[1]] };
    expect(huellaDeLaRuta(otra)).not.toBe(huellaDeLaRuta(base));
  });

  it("cambia si cambia el orden de las paradas", () => {
    const otra = { ...base, paradas: [base.paradas[1], base.paradas[0], base.paradas[2], base.paradas[3]] };
    expect(huellaDeLaRuta(otra)).not.toBe(huellaDeLaRuta(base));
  });

  it("cambia si cambia un sitio", () => {
    const otra = { ...base, ordenes: [{ ...base.ordenes[0], destino: "Z" }, base.ordenes[1]] };
    expect(huellaDeLaRuta(otra)).not.toBe(huellaDeLaRuta(base));
  });
});

describe("repartoDeLibertad", () => {
  const sec = [
    { orden: "a", tipo: "P" as const }, // 0: hecha
    { orden: "b", tipo: "P" as const }, // 1: fijada a mano, no del lote
    { orden: "c", tipo: "P" as const }, // 2: del lote, fijada a mano antes: se libera
    { orden: "b", tipo: "D" as const }, // 3: no fijada
    { orden: "c", tipo: "D" as const }, // 4: del lote
  ];

  it("las hechas y las fijadas a mano quedan fijas; el lote y lo no fijado quedan libres, en orden", () => {
    const r = repartoDeLibertad(sec, 1, new Set(["P:b", "P:c"]), new Set(["c"]));
    expect(r.fijas).toEqual(["P:a", "P:b"]);
    expect(r.libres).toEqual(["P:c", "D:b", "D:c"]);
  });

  it("una parada del lote ya hecha sigue fija, aunque sea del lote", () => {
    const r = repartoDeLibertad(sec, 3, new Set(), new Set(["c"]));
    expect(r.fijas).toEqual(["P:a", "P:b", "P:c"]);
    expect(r.libres).toEqual(["D:b", "D:c"]);
  });

  it("sin nada hecho ni fijado, todo es libre", () => {
    const r = repartoDeLibertad(sec, 0, new Set(), new Set());
    expect(r.fijas).toEqual([]);
    expect(r.libres).toEqual(["P:a", "P:b", "P:c", "D:b", "D:c"]);
  });
});
