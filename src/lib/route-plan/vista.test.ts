import { describe, expect, it } from "vitest";
import { horaDeReloj, vistaDelPlan, type ParadaGuardada } from "./vista";

/** La ruta de cada chofer, como se enseña (D-NEXT). Las filas son las que guarda `route_plan_stops`; llegan
 *  DESORDENADAS a propósito, que es como las puede devolver la base. */

const parada = (driver: string, seq: number, kind: "P" | "D", order_ref: string, extra: Partial<ParadaGuardada> = {}): ParadaGuardada => ({
  driver_id: driver, driver_name: `Chofer ${driver}`, seq, kind, delivery_id: order_ref.split("#")[0], order_ref, label: `${kind}?`, place: null,
  window_start: null, window_end: null, is_hard: false, eta: 480 + seq * 30, etd: 490 + seq * 30, wait_min: 0, service_min: 10, late_min: 0,
  load_after: 0, leg_minutes: seq ? 20 : 0, leg_miles: seq ? 7.25 : 0, pinned: false, ...extra,
});

describe("la ruta de un chofer, parada a parada", () => {
  // Dos viajes: recoge a y b, las entrega (queda vacío), vuelve a recoger c y la entrega.
  const filas = [
    parada("z", 5, "D", "c", { load_after: 0, late_min: 12 }),
    parada("z", 0, "P", "a", { load_after: 2 }),
    parada("z", 3, "D", "b", { load_after: 0, wait_min: 7 }),
    parada("z", 1, "P", "b", { load_after: 5.5 }),
    parada("z", 4, "P", "c", { load_after: 4 }),
    parada("z", 2, "D", "a", { load_after: 3.5 }),
  ];
  const [ruta] = vistaDelPlan(filas, [{ id: "a", builder: true }, { id: "b" }, { id: "c", builder: false }], {});

  it("en el orden de `seq`, lleguen como lleguen", () => {
    expect(ruta.paradas.map((p) => [p.seq, p.kind, p.order_ref])).toEqual([[0, "P", "a"], [1, "P", "b"], [2, "D", "a"], [3, "D", "b"], [4, "P", "c"], [5, "D", "c"]]);
  });

  it("los pallets a bordo en cada tramo: llega con lo que cargaba al salir de la parada anterior", () => {
    expect(ruta.paradas.map((p) => [p.aBordoAlLlegar, p.load_after])).toEqual([[0, 2], [2, 5.5], [5.5, 3.5], [3.5, 0], [0, 4], [4, 0]]);
  });

  it("el viaje sube cuando, ya vacío, vuelve a recoger — no al vaciarse", () => {
    expect(ruta.paradas.map((p) => p.viaje)).toEqual([1, 1, 1, 1, 2, 2]);
    expect(ruta.totales.viajes).toBe(2);
  });

  it("los totales del día", () => {
    expect(ruta.totales).toEqual({
      paradas: 6, entregas: 3, viajes: 2, inicio: 480, fin: 640, minutos: 160, manejoMin: 100, millas: 36.25, esperaMin: 7, tardeMin: 12, palletsMax: 5.5,
    });
  });

  it("builder es de la ORDEN, y se dice en sus dos paradas", () => {
    expect(ruta.paradas.filter((p) => p.builder).map((p) => `${p.kind}:${p.order_ref}`)).toEqual(["P:a", "D:a"]);
  });
});

describe("una orden repartida en cargas", () => {
  const partes = { g: ["g#a", "g#b", "g#c"] };
  const filas = [parada("z", 0, "P", "g#b", { load_after: 10 }), parada("z", 1, "D", "g#b"), parada("z", 2, "P", "g#c", { load_after: 5 }), parada("z", 3, "D", "g#c"), parada("y", 0, "P", "g#a", { load_after: 10 }), parada("y", 1, "D", "g#a")];
  const rutas = vistaDelPlan(filas, [{ id: "g", builder: true }], partes);

  it("cada parada dice qué carga es y de cuántas, aunque las lleven choferes distintos — y builder va por la orden, no por la parte", () => {
    expect(rutas.map((r) => [r.choferId, r.paradas.map((p) => p.carga && `${p.carga.numero}/${p.carga.de}`)])).toEqual([["y", ["1/3", "1/3"]], ["z", ["2/3", "2/3", "3/3", "3/3"]]]);
    expect(rutas.flatMap((r) => r.paradas).every((p) => p.builder)).toBe(true);
  });

  it("una orden entera no lleva «carga 1 de 1»", () => {
    expect(vistaDelPlan([parada("z", 0, "P", "a"), parada("z", 1, "D", "a")], [], { a: ["a"] })[0].paradas.map((p) => p.carga)).toEqual([null, null]);
    expect(vistaDelPlan([parada("z", 0, "P", "a")], [], {})[0].paradas[0].carga).toBeNull();
  });
});

describe("varios choferes, y lo que la base devuelve", () => {
  it("una ruta por chofer, por nombre; cada una con lo suyo", () => {
    const rutas = vistaDelPlan([parada("2", 0, "P", "x", { driver_name: "Ana" }), parada("1", 0, "P", "y", { driver_name: "Beto" }), parada("2", 1, "D", "x", { driver_name: "Ana" })], [], {});
    expect(rutas.map((r) => [r.chofer, r.choferId, r.paradas.length])).toEqual([["Ana", "2", 2], ["Beto", "1", 1]]);
  });

  it("los `numeric` de la base pueden llegar como texto: se suman como números", () => {
    const comoTexto = { load_after: "2.50" as unknown as number, leg_miles: "7.25" as unknown as number };
    const [r] = vistaDelPlan([parada("z", 0, "P", "a", comoTexto), parada("z", 1, "D", "a", { ...comoTexto, load_after: "0" as unknown as number })], [], {});
    expect([r.totales.millas, r.totales.palletsMax, r.paradas[1].aBordoAlLlegar, r.totales.viajes]).toEqual([14.5, 2.5, 2.5, 1]);
  });

  it("una parada cuyo chofer ya no existe (perfil borrado) se agrupa por el nombre guardado, no se pierde", () => {
    const sinPerfil = { driver_id: null as unknown as string, driver_name: "Se Fue" };
    const rutas = vistaDelPlan([parada("z", 0, "P", "a", sinPerfil), parada("z", 1, "D", "a", sinPerfil)], [], {});
    expect(rutas.map((r) => [r.chofer, r.paradas.length])).toEqual([["Se Fue", 2]]);
  });

  it("sin paradas no hay rutas", () => {
    expect(vistaDelPlan([], [], {})).toEqual([]);
  });

  it("la hora de reloj", () => {
    expect([0, 510, 1019, 1439].map(horaDeReloj)).toEqual(["00:00", "08:30", "16:59", "23:59"]);
  });
});
