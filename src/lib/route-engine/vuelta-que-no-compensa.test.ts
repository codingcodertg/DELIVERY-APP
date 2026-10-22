import { describe, expect, it } from "vitest";
import {
  FACTOR_DE_RODEO_DE_LA_VUELTA, millasEstimadasEntre, PARAMETROS_DE_VUELTA_POR_DEFECTO, tiendasLejanas, vueltasQueNoCompensan,
  type OrdenParaLaVuelta, type TiendaConPunto,
} from "./index";
import { FACTOR_DE_RODEO } from "../route-times/proveedores";
import { siguienteDiaDeTrabajo } from "../aprobacion-por-hora-y-cupo";

/**
 * «Esa vuelta no compensa» (D-NEXT). El dueño, 2026-10-22: una carga de 0.25 pallets entre la tienda lejana y una de las
 * cercanas; «es muy poquito pallet para una vuelta tan larga; recomiendo reprogramar estas cargas».
 *
 * Tiendas con nombres inventados y puntos parecidos a los de verdad: cuatro juntas (Alfa, Bravo, Coral, Delta) y una lejos
 * (Mesa). Mesa va TERCERA en la lista y no es ni la primera ni la última por nombre: nada de la regla puede acertar por
 * posición. 2026-10-22 es jueves; el 24, sábado; el 25, domingo.
 */
const ALFA = { nombre: "Alfa", lat: 26.2034, lng: -98.23 };
const BRAVO = { nombre: "Bravo", lat: 26.1948, lng: -98.1836 };
const MESA = { nombre: "Mesa", lat: 25.9017, lng: -97.4975 };
const CORAL = { nombre: "Coral", lat: 26.3017, lng: -98.1633 };
const DELTA = { nombre: "Delta", lat: 26.1595, lng: -97.9908 };
const TIENDAS: TiendaConPunto[] = [ALFA, BRAVO, MESA, CORAL, DELTA];
/** Un pin a unas 3 millas de Mesa (en su pueblo), y otro en el valle, entre Alfa y Bravo. */
const CERCA_DE_MESA = { lat: 25.93, lng: -97.48 };
const EN_EL_VALLE = { lat: 26.2, lng: -98.2 };
/** Lejos de todas: a unas 30 millas de Mesa y más de 70 de las demás. */
const ISLA = { lat: 26.1, lng: -97.17 };

const JUEVES = "2026-10-22";
const inter = (id: string, origen: string, destino: string, pallets: number, extra: Partial<OrdenParaLaVuelta> = {}): OrdenParaLaVuelta => ({
  id, fecha: JUEVES, intertienda: true, origen, destino, pallets, urgente: false, movible: true, ...extra,
});
const cliente = (id: string, origen: string, entrega: { lat: number; lng: number }, pallets: number, extra: Partial<OrdenParaLaVuelta> = {}): OrdenParaLaVuelta => ({
  id, fecha: JUEVES, intertienda: false, origen, destino: null, entrega, pallets, urgente: false, movible: true, ...extra,
});
const recomienda = (ordenes: OrdenParaLaVuelta[], extra: { fecha?: string; tiendas?: TiendaConPunto[]; parametros?: Partial<typeof PARAMETROS_DE_VUELTA_POR_DEFECTO> } = {}) =>
  vueltasQueNoCompensan({ fecha: extra.fecha ?? JUEVES, ordenes, tiendas: extra.tiendas ?? TIENDAS, parametros: extra.parametros, siguienteDia: siguienteDiaDeTrabajo });

describe("qué tienda queda lejos: calculado de los puntos, no del nombre", () => {
  it("Mesa, y solo Mesa, aunque vaya en medio de la lista", () => {
    const l = tiendasLejanas(TIENDAS, 2);
    expect(l.map((t) => t.nombre)).toEqual(["Mesa"]);
    // Entre las otras, del orden de diez millas; Mesa, más de cuarenta.
    expect(l[0].millasEntreLasDemas).toBeLessThan(25);
    expect(l[0].millasALasDemas).toBeGreaterThan(40);
  });

  it("si los puntos se cambian de tienda, la lejana es la otra: decide el punto", () => {
    const cambiadas = [{ ...ALFA, lat: MESA.lat, lng: MESA.lng }, BRAVO, { ...MESA, lat: ALFA.lat, lng: ALFA.lng }, CORAL, DELTA];
    expect(tiendasLejanas(cambiadas, 2).map((t) => t.nombre)).toEqual(["Alfa"]);
  });

  it("con tres tiendas, dos juntas y una lejos, la lejana sale (la mediana es la de ENTRE las demás, no la de todas)", () => {
    expect(tiendasLejanas([ALFA, MESA, BRAVO], 2).map((t) => t.nombre)).toEqual(["Mesa"]);
  });

  it("el factor manda: con uno enorme, ninguna es lejana", () => {
    expect(tiendasLejanas(TIENDAS, 50)).toEqual([]);
  });

  it("las millas son las estimadas del motor: línea recta por el mismo factor de rodeo", () => {
    expect(FACTOR_DE_RODEO_DE_LA_VUELTA).toBe(FACTOR_DE_RODEO);
    expect(millasEstimadasEntre(ALFA, ALFA)).toBe(0);
  });
});

describe("dos tiendas lejanas pegadas son un solo sitio", () => {
  // Muelle, a un par de millas de Mesa: las dos salen lejanas, pero «allí» es uno.
  const MUELLE = { nombre: "Muelle", lat: 25.92, lng: -97.51 };
  const CON_MUELLE = [ALFA, MUELLE, BRAVO, MESA, CORAL, DELTA];

  it("las dos son lejanas, y juntas forman un sitio", () => {
    expect(tiendasLejanas(CON_MUELLE, 2).map((t) => t.nombre).sort()).toEqual(["Mesa", "Muelle"]);
  });

  it("una sola recomendación con las cargas de las dos, a nombre de la que más sale", () => {
    const r = recomienda([inter("m", "Alfa", "Muelle", 0.1), inter("a", "Mesa", "Bravo", 0.1), inter("b", "Delta", "Mesa", 0.2)], { tiendas: CON_MUELLE });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tienda: "Mesa", ids: ["m", "a", "b"], pallets: 0.4 });
  });

  it("una intertienda entre las dos no es vuelta larga", () => {
    expect(recomienda([inter("x", "Mesa", "Muelle", 0.1)], { tiendas: CON_MUELLE })).toEqual([]);
  });
});

describe("el umbral de pallets", () => {
  it("0.25 pallets de Alfa a Mesa: se recomienda moverlos, con el porqué", () => {
    const r = recomienda([inter("a", "Alfa", "Mesa", 0.25)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tienda: "Mesa", fecha: JUEVES, ids: ["a"], pallets: 0.25 });
    expect(r[0].millasIdaYVuelta).toBeGreaterThan(80);
    expect(r[0].motivo.es).toMatch(/^0\.25 pallets para una vuelta de ~\d+ mi \(Mesa está a ~\d+ mi de las demás tiendas; entre las otras, ~\d+ mi\)/);
    expect(r[0].motivo.en).toMatch(/^0\.25 pallets for a ~\d+ mi round trip/);
  });

  it("varias chicas en las dos direcciones se suman y se mueven juntas; una entre dos cercanas no cuenta", () => {
    const r = recomienda([inter("b", "Mesa", "Bravo", 0.3), inter("x", "Alfa", "Bravo", 0.1), inter("a", "Alfa", "Mesa", 0.6)]);
    expect(r).toHaveLength(1);
    expect(r[0].ids).toEqual(["b", "a"]);
    expect(r[0].pallets).toBe(0.9);
  });

  it("si suman el umbral o más, la vuelta compensa y no se dice nada", () => {
    expect(recomienda([inter("a", "Alfa", "Mesa", 0.6), inter("b", "Mesa", "Bravo", 0.4)])).toEqual([]);
  });

  it("el umbral es un parámetro: con 0.2, los 0.25 ya compensan", () => {
    expect(recomienda([inter("a", "Alfa", "Mesa", 0.25)], { parametros: { umbralPallets: 0.2 } })).toEqual([]);
  });

  it("una intertienda sin pallets apuntados no se juzga", () => {
    expect(recomienda([inter("a", "Alfa", "Mesa", 0)])).toEqual([]);
  });

  it("sin nada que cruce, todo normal", () => {
    expect(recomienda([inter("x", "Alfa", "Coral", 0.1), cliente("c", "Bravo", EN_EL_VALLE, 0.2)])).toEqual([]);
  });
});

describe("si el viaje va igual, las chicas van de paso", () => {
  it("una urgente con esa tienda: el viaje ocurre y no se mueve nada (ni la urgente)", () => {
    expect(recomienda([inter("a", "Alfa", "Mesa", 0.25), inter("u", "Bravo", "Mesa", 0.1, { urgente: true })])).toEqual([]);
  });

  it("una que ya salió (no movible) también hace que el viaje ocurra", () => {
    expect(recomienda([inter("a", "Alfa", "Mesa", 0.25), inter("s", "Mesa", "Delta", 0.1, { movible: false })])).toEqual([]);
  });

  it("una entrega de cliente cerca de Mesa desde el valle: el camión baja igual", () => {
    expect(recomienda([inter("a", "Alfa", "Mesa", 0.25), cliente("c", "Coral", CERCA_DE_MESA, 0.5)])).toEqual([]);
  });

  it("pero una de cliente de Mesa en su propio pueblo no baja a nadie del valle: se recomienda igual", () => {
    const r = recomienda([inter("a", "Alfa", "Mesa", 0.25), cliente("c", "Mesa", CERCA_DE_MESA, 0.5)]);
    expect(r.map((x) => x.ids)).toEqual([["a"]]);
  });

  it("una de cliente de Mesa entregada en el valle: alguien sube igual, y las chicas van con él", () => {
    expect(recomienda([inter("a", "Alfa", "Mesa", 0.25), cliente("c", "Mesa", EN_EL_VALLE, 0.5)])).toEqual([]);
  });

  it("una de cliente de Mesa a un sitio que no está cerca de ninguna tienda (la isla, o un pin perdido) no sube a nadie", () => {
    expect(recomienda([inter("a", "Alfa", "Mesa", 0.25), cliente("c", "Mesa", ISLA, 1)]).map((x) => x.ids)).toEqual([["a"]]);
    expect(recomienda([inter("a", "Alfa", "Mesa", 0.25), cliente("c", "Mesa", { lat: 40, lng: -90 }, 1)]).map((x) => x.ids)).toEqual([["a"]]);
  });

  it("y una de cliente del valle en el valle, tampoco", () => {
    const r = recomienda([inter("a", "Alfa", "Mesa", 0.25), cliente("c", "Coral", EN_EL_VALLE, 3)]);
    expect(r.map((x) => x.ids)).toEqual([["a"]]);
  });

  it("el radio es un parámetro: con 1 milla, el pin a unas 3 de Mesa ya no es «allí» y no hace bajar a nadie", () => {
    const r = recomienda([inter("a", "Alfa", "Mesa", 0.25), cliente("c", "Coral", CERCA_DE_MESA, 0.5)], { parametros: { radioMi: 1 } });
    // Con radio 1 el pin no está en Mesa: la orden de cliente va del valle a «fuera de Mesa», no cruza.
    expect(r.map((x) => x.ids)).toEqual([["a"]]);
  });

  it("una orden de cliente nunca se recomienda mover, aunque sea chica y cruce", () => {
    expect(recomienda([cliente("c", "Alfa", CERCA_DE_MESA, 0.1)])).toEqual([]);
  });
});

describe("a qué día", () => {
  it("el sábado sin nada después: el lunes, no el domingo, y el motivo dice que se junta con lo que salga", () => {
    const r = recomienda([inter("a", "Alfa", "Mesa", 0.25, { fecha: "2026-10-24" })], { fecha: "2026-10-24" });
    expect(r[0].fechaSugerida).toBe("2026-10-26");
    expect(r[0].seJuntaCon).toBe("nada");
    expect(r[0].motivo.es).toContain("se juntarán con lo que salga el lunes 2026-10-26");
  });

  it("prefiere el día en que el viaje ya va, aunque haya otro antes con alguna carga chica", () => {
    const r = recomienda([
      inter("a", "Alfa", "Mesa", 0.25),
      inter("v", "Mesa", "Alfa", 0.1, { fecha: "2026-10-23" }),
      inter("s1", "Bravo", "Mesa", 3.7, { fecha: "2026-10-24" }), inter("s2", "Mesa", "Delta", 2, { fecha: "2026-10-24" }),
    ]);
    expect(r[0]).toMatchObject({ fechaSugerida: "2026-10-24", seJuntaCon: "viaje", palletsEseDia: 5.7 });
    expect(r[0].motivo.es).toContain("El sábado 2026-10-24 ya hay 5.7 pallets con Mesa.");
  });

  it("sin viaje en los próximos días, el primero con alguna carga, y se juntan", () => {
    const r = recomienda([inter("a", "Alfa", "Mesa", 0.25), inter("v", "Mesa", "Alfa", 0.1, { fecha: "2026-10-24" })]);
    expect(r[0]).toMatchObject({ fechaSugerida: "2026-10-24", seJuntaCon: "cargas", palletsEseDia: 0.1 });
  });

  it("lo que ya hay más lo que se mueve llega al umbral: ese día el viaje compensa", () => {
    const r = recomienda([inter("a", "Alfa", "Mesa", 0.5), inter("v", "Mesa", "Alfa", 0.2, { fecha: "2026-10-23" }), inter("w", "Mesa", "Alfa", 0.5, { fecha: "2026-10-24" })]);
    expect(r[0]).toMatchObject({ fechaSugerida: "2026-10-24", seJuntaCon: "viaje" });
  });

  it("solo mira los días de trabajo que dice el parámetro: con uno, el viernes, aunque el viaje vaya el sábado", () => {
    const r = recomienda([inter("a", "Alfa", "Mesa", 0.25), inter("s", "Bravo", "Mesa", 4, { fecha: "2026-10-24" })], { parametros: { diasAdelante: 1 } });
    expect(r[0]).toMatchObject({ fechaSugerida: "2026-10-23", seJuntaCon: "nada" });
  });
});
