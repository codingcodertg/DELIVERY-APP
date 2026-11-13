import { describe, expect, it } from "vitest";
import { lecturaConLoHecho } from "./route-plan/lectura-del-gestor";
import { filasConLoHecho, type OrdenHecha } from "./hechas-del-gestor";
import { escrituraDeLaLista, llevaEnLaLista, mueveEnLaLista, type ParadaDeLaLista } from "./lista-unica";
import { numeracionConHechas, puestoEn } from "./mover-parada";

/**
 * Regresion (Routes Manager, 13 nov 2026): la ruta de un chofer con dos entregas HECHAS entre la D5 (#FW577) y la D6 (149110).
 * Mover la D5 a despues de la D6 tiene que dejarla justo detras de la D6 y delante de la D7; las hechas no cambian de sitio.
 *
 * Fixture = la tarjeta del dueno: P5 FW577 · P6 149110 · D4 149108 (ya recogida, en el camion) · P7 172110 · D5 FW577 ·
 * [hechas 100426 y 100408] · D6 149110 · D7 172110. Los puestos (`route_seq`) son los que dejo la app al guardar: D5=4, D6=7,
 * D7=8, hechas 5 y 6. Como en la pantalla: la lectura solo mira lo entregado (`hechasDeLaRuta`); la tarjeta pinta, ademas,
 * lo recogido (`hechasQueSePintan`).
 */
interface O {
  id: string; stage: string; route_seq: number | null; pickup_seq: number | null; load_no: null; store: string;
  pickup_name: string; est_pallets: number; delivery_address: string; assigned_driver: string; delivery_date: string;
}
const orden = (id: string, stage: string, route_seq: number | null, pickup_seq: number | null, store: string, addr: string): O =>
  ({ id, stage, route_seq, pickup_seq, load_no: null, store, pickup_name: store, est_pallets: 1, delivery_address: addr, assigned_driver: "Diego Driver", delivery_date: "2026-11-13" });
const fixture = (): O[] => [
  orden("FW577", "ready", 4, 0, "McAllen", "Weslaco"),
  orden("149110", "ready", 7, 1, "McAllen", "Weslaco"),
  orden("149108", "picked_up", 2, null, "McAllen", "Pharr"),
  orden("172110", "ready", 8, 3, "RDZ Pharr", "Donna"),
  // Hechas: su recogida (✓P) va justo detras de la D5 y delante de su entrega (✓D), como en la pantalla.
  orden("100426", "delivered", 5, 4.25, "McAllen", "Mission"),
  orden("100408", "delivered", 6, 4.5, "McAllen", "Edinburg"),
];

const pendientesDe = (todas: O[]) => todas.filter((o) => o.stage !== "delivered");
/** Lo entregado: lo que la lectura de la ruta toma como «hecho» (`hechasDeLaRuta`). */
const entregadasDe = (todas: O[]) => todas.filter((o) => o.stage === "delivered") as unknown as OrdenHecha[];
/** Lo recogido o entregado: lo que la tarjeta pinta como hecho (`hechasQueSePintan`). */
const pintadasDe = (todas: O[]) => todas.filter((o) => o.stage === "delivered" || o.stage === "picked_up") as unknown as OrdenHecha[];

/** Lo que el dueno ve en la tarjeta: las filas en su orden, con ✓ en las hechas. */
function tarjeta(todas: O[]): string[] {
  const pend = pendientesDe(todas);
  const lectura = lecturaConLoHecho(pend, 12, null, entregadasDe(todas));
  return filasConLoHecho(lectura, pend, pintadasDe(todas), 12, null).map((f) => (f.hecha
    ? `✓${f.tipo}${f.orden}`
    : f.fila.tipo === "P" ? `P${f.fila.ordenes[0]}` : `D${f.fila.orden}`));
}

/** Lo que guarda la pantalla (`guardaLaLista`): las pendientes en su nuevo orden, con la numeracion de siempre. */
function guarda(todas: O[], paradas: ParadaDeLaLista[]): O[] {
  const desde = numeracionConHechas(entregadasDe(todas), pendientesDe(todas));
  const e = escrituraDeLaLista(paradas, desde);
  return todas.map((o) => {
    const i = e.ids.indexOf(o.id);
    return i >= 0 ? { ...o, route_seq: puestoEn(desde, i), pickup_seq: e.pickupSeqById[o.id] ?? null } : o;
  });
}
const listaDe = (todas: O[]) => lecturaConLoHecho(pendientesDe(todas), 12, null, entregadasDe(todas)).paradas;
const idx = (lista: readonly ParadaDeLaLista[], tipo: "P" | "D", id: string) =>
  lista.findIndex((p) => (tipo === "D" ? p.tipo === "D" && p.orden === id : p.tipo === "P" && p.ordenes.includes(id)));
const ok = (r: { ok: boolean; paradas?: ParadaDeLaLista[] }): ParadaDeLaLista[] => {
  if (!r.ok || !r.paradas) throw new Error("el movimiento se rechazo");
  return r.paradas;
};

const INICIO = ["PFW577", "P149110", "✓P149108", "D149108", "P172110", "DFW577", "✓P100426", "✓P100408", "✓D100426", "✓D100408", "D149110", "D172110"];
// La D5 detras de la D6 y delante de la D7: las hechas siguen en medio de las dos, donde estaban.
const D5_DETRAS_DE_D6 = ["PFW577", "P149110", "✓P149108", "D149108", "P172110", "D149110", "✓P100426", "✓P100408", "✓D100426", "✓D100408", "DFW577", "D172110"];

describe("mover la D5 detras de la D6 con dos hechas en medio", () => {
  it("la tarjeta de partida es la del dueno", () => {
    expect(tarjeta(fixture())).toEqual(INICIO);
  });

  it("flecha de bajar una vez: la D5 queda justo detras de la D6 y delante de la D7; las hechas no cambian de sitio", () => {
    const todas = fixture();
    const despues = guarda(todas, ok(mueveEnLaLista(listaDe(todas), idx(listaDe(todas), "D", "FW577"), 1)));
    expect(tarjeta(despues)).toEqual(D5_DETRAS_DE_D6);
    expect(despues.find((o) => o.id === "100426")!.route_seq).toBe(5);
    expect(despues.find((o) => o.id === "100408")!.route_seq).toBe(6);
    expect(despues.find((o) => o.id === "149110")!.route_seq).toBe(4);
    expect(despues.find((o) => o.id === "FW577")!.route_seq).toBe(7);
  });

  it("flecha de bajar dos veces: la D5 pasa tambien a la D7", () => {
    const todas = fixture();
    const una = guarda(todas, ok(mueveEnLaLista(listaDe(todas), idx(listaDe(todas), "D", "FW577"), 1)));
    const dos = guarda(una, ok(mueveEnLaLista(listaDe(una), idx(listaDe(una), "D", "FW577"), 1)));
    expect(tarjeta(dos)).toEqual(["PFW577", "P149110", "✓P149108", "D149108", "P172110", "D149110", "✓P100426", "✓P100408", "✓D100426", "✓D100408", "D172110", "DFW577"]);
  });

  it("arrastrar la D5 justo encima de la D7 da el mismo resultado que una flecha", () => {
    const todas = fixture();
    const lista = listaDe(todas);
    const despues = guarda(todas, ok(llevaEnLaLista(lista, idx(lista, "D", "FW577"), idx(lista, "D", "172110") - 1)));
    expect(tarjeta(despues)).toEqual(D5_DETRAS_DE_D6);
  });

  it("arrastrar la D5 sobre la D6 la deja detras de ella (y delante de la D7)", () => {
    const todas = fixture();
    const lista = listaDe(todas);
    const despues = guarda(todas, ok(llevaEnLaLista(lista, idx(lista, "D", "FW577"), idx(lista, "D", "149110"))));
    expect(tarjeta(despues)).toEqual(D5_DETRAS_DE_D6);
  });

  it("mover una entrega mas arriba no cambia de sitio las hechas", () => {
    const todas = fixture();
    const lista = listaDe(todas);
    const despues = guarda(todas, ok(mueveEnLaLista(lista, idx(lista, "D", "149108"), 1)));
    expect(despues.find((o) => o.id === "100426")!.route_seq).toBe(5);
    expect(despues.find((o) => o.id === "100408")!.route_seq).toBe(6);
  });
});

describe("mover una RECOGIDA con dos hechas en medio", () => {
  it("bajar la P de la 149110 la deja detras de la P5 sin tocar las hechas", () => {
    const todas = fixture();
    const lista = listaDe(todas);
    const despues = guarda(todas, ok(mueveEnLaLista(lista, idx(lista, "P", "149110"), 1)));
    const t = tarjeta(despues);
    expect(t.filter((x) => x.startsWith("✓"))).toEqual(["✓P149108", "✓P100426", "✓P100408", "✓D100426", "✓D100408"]);
    expect(t.indexOf("P149110")).toBeGreaterThan(t.indexOf("PFW577"));
    expect(despues.find((o) => o.id === "100426")!.route_seq).toBe(5);
  });

  it("subir la P de la 149110 la deja delante de la P5 sin tocar las hechas", () => {
    const todas = fixture();
    const lista = listaDe(todas);
    const despues = guarda(todas, ok(mueveEnLaLista(lista, idx(lista, "P", "149110"), -1)));
    expect(tarjeta(despues).slice(0, 2)).toEqual(["P149110", "PFW577"]);
    expect(despues.find((o) => o.id === "100408")!.route_seq).toBe(6);
  });
});
