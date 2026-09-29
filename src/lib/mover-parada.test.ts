import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hechasDelChofer, inicioDeLaSecuencia } from "./mover-parada";
import { fotoTrasReordenar } from "./arrastre-de-paradas";
import { escrituraDeLaLista, listaDelChofer, mueveEnLaLista } from "./lista-unica";

/**
 * Mover una parada a mano en la tarjeta del Gestor (D-433). Desde D-NEXT no hay viajes: el selector «Viaje N», las flechas
 * por viaje y «mover un viaje entero» se fueron (sus pruebas con ellos); las flechas de la lista única se prueban en
 * `lista-unica.test.ts`. Aquí queda lo de D-433 que sigue valiendo: se numera tras lo ya hecho.
 */

describe("lo ya hecho no choca (`inicioDeLaSecuencia`, `hechasDelChofer`)", () => {
  it("las pendientes se numeran justo después del puesto más alto de lo ya hecho", () => {
    expect(inicioDeLaSecuencia([{ route_seq: 1 }, { route_seq: 0 }])).toBe(2);
  });
  it("sin nada hecho, desde 0, como siempre", () => {
    expect(inicioDeLaSecuencia([])).toBe(0);
  });
  it("una hecha sin puesto no cuenta", () => {
    expect(inicioDeLaSecuencia([{ route_seq: null }, { route_seq: 3 }])).toBe(4);
    expect(inicioDeLaSecuencia([{ route_seq: null }])).toBe(0);
  });
  it("el caso medido en producción el 2026-09-28: #552 entregada con puesto 1 → las pendientes desde 2, ninguna empata", () => {
    const todas = [
      { id: "552", assigned_driver: "Ernesto", delivery_date: "2026-09-28", stage: "delivered", route_seq: 1 },
      { id: "335", assigned_driver: "Ernesto", delivery_date: "2026-09-28", stage: "approved", route_seq: 0 },
      { id: "603", assigned_driver: "Ernesto", delivery_date: "2026-09-28", stage: "ready", route_seq: 1 },
    ];
    const desde = inicioDeLaSecuencia(hechasDelChofer(todas, "Ernesto", new Set(["2026-09-28"])));
    expect(desde).toBe(2);
    // Bajar la primera entrega (la lista: P·P, D335, D603 → P·P, D603, D335) y escribirla desde `desde`.
    const lista = listaDelChofer([todas[1], todas[2]], 12);
    const r = mueveEnLaLista(lista, lista.findIndex((x) => x.tipo === "D" && x.orden === "335"), 1, [todas[1], todas[2]]);
    if (!r.ok) throw new Error("no se movió");
    const e = escrituraDeLaLista(r.paradas, desde);
    const foto = fotoTrasReordenar({}, e.ids, e.loadNoById, desde);
    expect(foto["603"].route_seq).toBe(2);
    expect(foto["335"].route_seq).toBe(3);
  });
  it("lo hecho es recogido o entregado, del mismo chofer y de esas fechas; lo pendiente, lo anulado y lo de otro no", () => {
    const todas = [
      { id: "a", assigned_driver: "Ana", delivery_date: "2026-09-28", stage: "picked_up" },
      { id: "b", assigned_driver: "Ana", delivery_date: "2026-09-28", stage: "delivered" },
      { id: "c", assigned_driver: "Ana", delivery_date: "2026-09-28", stage: "ready" },
      { id: "d", assigned_driver: "Ana", delivery_date: "2026-09-28", stage: "canceled" },
      { id: "e", assigned_driver: "Beto", delivery_date: "2026-09-28", stage: "delivered" },
      { id: "f", assigned_driver: "Ana", delivery_date: "2026-09-27", stage: "delivered" },
    ];
    expect(hechasDelChofer(todas, "Ana", new Set(["2026-09-28"])).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("la foto del deshacer usa el mismo `desde` que se escribió", () => {
    expect(fotoTrasReordenar({}, ["X", "Y"], undefined, 5)).toEqual({
      X: { assigned_driver: null, route_seq: 5, load_no: null }, Y: { assigned_driver: null, route_seq: 6, load_no: null },
    });
  });
});

// La pantalla usa esto, y los dos proveedores numeran desde `desde`: la prueba se alimenta de quien llama.
const lee = (...r: string[]) => readFileSync(join(__dirname, ...r), "utf8").replace(/\r\n/g, "\n");
const pagina = lee("..", "app", "(app)", "routes", "page.tsx");
const cuerpoDe = (fuente: string, desde: string, hasta: string) => {
  const i = fuente.indexOf(desde);
  expect(i).toBeGreaterThan(-1);
  const j = fuente.indexOf(hasta, i + desde.length);
  expect(j).toBeGreaterThan(i);
  return fuente.slice(i, j);
};

describe("la pantalla: la tarjeta del chofer en el Gestor", () => {
  const guarda = cuerpoDe(pagina, "const guardaLaLista = async (", "\n  };\n");
  it("el inicio de la ruta sale de lo ya hecho del chofer en las fechas de sus paradas", () => {
    expect(pagina).toContain("hechasDelChofer(deliveries, laneKey, new Set(stops.map((s) => s.delivery_date ?? null)));");
    expect(pagina).toContain("const inicioDeLaRuta = (laneKey: string, stops: Delivery[]) => inicioDeLaSecuencia(hechasDeLaRuta(laneKey, stops));");
  });
  it("guardar la lista numera tras lo ya hecho, escribe la lista ENTERA y entra en deshacer con la foto de lo escrito", () => {
    expect(guarda).toContain("const desde = inicioDeLaRuta(laneKey, stops);");
    expect(guarda).toContain("const e = escrituraDeLaLista(lista, desde);");
    expect(guarda).toContain("await reorderStops(e.ids, e.loadNoById, undefined, desde, recogidas);");
    expect(guarda).toContain("fotoTrasReordenar(antes, e.ids, e.loadNoById, desde, recogidas)");
  });
  it("ya no hay selector de viaje, ni «mover un viaje entero», ni unir/dividir (D-NEXT)", () => {
    for (const x of ["moveStopToLoad", "moveTrip", "combineLoads", "splitLoads", "planDeCambioDeViaje", "planDeFlecha(", "buildTrips", "＋ {t(\"New truckload\""]) expect(pagina).not.toContain(x);
  });
});

describe("los dos proveedores numeran desde `desde`", () => {
  it("con base", () => {
    expect(lee("data-provider.tsx")).toContain("const seqById = new Map(orderedIds.map((id, i) => [id, desde + i]));");
  });
  it("el demo", () => {
    expect(lee("local-data-provider.tsx")).toContain("const seqById = new Map(orderedIds.map((id, i) => [id, desde + i]));");
  });
});
