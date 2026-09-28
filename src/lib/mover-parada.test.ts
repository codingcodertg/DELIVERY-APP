import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cabeEnElViaje, hechasDelChofer, inicioDeLaSecuencia, planDeCambioDeViaje, planDeFlecha } from "./mover-parada";
import { fotoTrasReordenar } from "./arrastre-de-paradas";
import { groupIntoLoads } from "./route-lanes";

/** Mover una parada a mano en la tarjeta del Gestor (D-NEXT): flechas ↑ ↓ y el selector «Viaje N». */

const o = (id: string, pallets: number | null = 2) => ({ id, est_pallets: pallets, actual_pallets: null });
const ids = (vs: readonly (readonly { id: string }[])[]) => vs.map((v) => v.map((x) => x.id));

describe("las flechas (`planDeFlecha`)", () => {
  it("baja una parada: la secuencia entera en el orden nuevo, desde `desde`", () => {
    const p = planDeFlecha([[o("A"), o("B"), o("C")]], 0, 1, false, 0)!;
    expect(p.ids).toEqual(["B", "A", "C"]);
    expect(p.puesto).toBe(1);
    expect(p.total).toBe(3);
    expect(p.desde).toBe(0);
  });
  it("sube una parada", () => {
    expect(planDeFlecha([[o("A"), o("B"), o("C")]], 2, -1, false, 0)!.ids).toEqual(["A", "C", "B"]);
  });
  it("partiendo por capacidad (sin viajes a mano) no escribe viajes: solo la secuencia", () => {
    const p = planDeFlecha([[o("A")], [o("B")]], 0, 1, false, 0)!;
    expect(p.loadNoById).toBeUndefined();
    expect(p.viaje).toBeNull();
  });
  it("con viajes a mano, la que pasa del borde entra en el viaje de al lado y cada viaje conserva su tamaño", () => {
    const p = planDeFlecha([[o("A"), o("B")], [o("C")]], 1, 1, true, 0)!;
    expect(p.ids).toEqual(["A", "C", "B"]);
    expect(p.loadNoById).toEqual({ A: null, C: null, B: 2 });
    expect(p.viaje).toBe(2);
  });
  it("con viajes a mano, lo que se escribe es lo que se pinta después (`groupIntoLoads` sobre lo escrito)", () => {
    const viajes = [[o("A"), o("B")], [o("C"), o("D")]];
    const p = planDeFlecha(viajes, 2, -1, true, 0)!;
    const escritas = p.ids.map((id) => ({ id, load_no: p.loadNoById![id] }));
    expect(ids(groupIntoLoads(escritas))).toEqual([["A", "C"], ["B", "D"]]);
  });
  it("fuera de la lista no hace nada (la primera no sube, la última no baja)", () => {
    expect(planDeFlecha([[o("A"), o("B")]], 0, -1, false, 0)).toBeNull();
    expect(planDeFlecha([[o("A"), o("B")]], 1, 1, false, 0)).toBeNull();
  });
  it("lleva el `desde` que le dan (tras lo ya hecho del chofer)", () => {
    expect(planDeFlecha([[o("A"), o("B")]], 0, 1, false, 4)!.desde).toBe(4);
  });
});

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
    const p = planDeFlecha([[todas[1], todas[2]]], 0, 1, false, desde)!;
    const foto = fotoTrasReordenar({}, p.ids, p.loadNoById, p.desde);
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

describe("el selector de viaje (`planDeCambioDeViaje`)", () => {
  it("a un viaje nuevo: escribe la ruta ENTERA, cada parada con su puesto y su viaje — ninguna queda sin puesto", () => {
    const p = planDeCambioDeViaje([[o("A", 3), o("B", 5)]], "B", 2, 10, 0);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.ids).toEqual(["A", "B"]);
    expect(p.loadNoById).toEqual({ A: null, B: 2 });
    expect(p.viaje).toBe(2);
    expect(p.nuevo).toBe(true);
    expect(p.excede).toBe(false);
  });
  it("a otro viaje donde cabe: al final de ese viaje", () => {
    const p = planDeCambioDeViaje([[o("A", 3)], [o("B", 2), o("C", 2)]], "A", 2, 10, 0);
    if (!p.ok) throw new Error("debía moverse");
    expect(p.ids).toEqual(["B", "C", "A"]);
    expect(p.loadNoById).toEqual({ B: null, C: null, A: null });
    expect(p.viaje).toBe(1);
  });
  it("a un viaje donde NO cabe: no se mueve y dice cuánto lleva y cuánto es la parada", () => {
    const p = planDeCambioDeViaje([[o("A", 3)], [o("B", 5)]], "B", 1, 6, 0);
    expect(p).toEqual({ ok: false, motivo: "no_cabe", viaje: 1, carga: 3, pallets: 5, capacidad: 6 });
  });
  it("justo lleno cabe (el borde es «hasta la capacidad», a la décima)", () => {
    expect(planDeCambioDeViaje([[o("A", 0.1), o("B", 0.2)], [o("C", 0.3)]], "C", 1, 0.6, 0).ok).toBe(true);
    expect(cabeEnElViaje([[o("A", 0.1), o("B", 0.2)], [o("C", 0.3)]], "C", 1, 0.6)).toEqual({ cabe: true, carga: 0.3, pallets: 0.3 });
  });
  it("la carga del destino no cuenta la propia parada", () => {
    expect(cabeEnElViaje([[o("A", 4), o("B", 4)]], "B", 1, 8).carga).toBe(4);
  });
  it("al mismo viaje, o sola en el último a uno nuevo: no hay cambio", () => {
    expect(planDeCambioDeViaje([[o("A")], [o("B")]], "A", 1, 10, 0)).toEqual({ ok: false, motivo: "sin_cambio" });
    expect(planDeCambioDeViaje([[o("A")], [o("B")]], "B", 3, 10, 0)).toEqual({ ok: false, motivo: "sin_cambio" });
  });
  it("un viaje que se queda vacío desaparece y los de detrás corren un número", () => {
    const p = planDeCambioDeViaje([[o("A")], [o("B")], [o("C")]], "A", 4, 10, 0);
    if (!p.ok) throw new Error("debía moverse");
    expect(p.ids).toEqual(["B", "C", "A"]);
    expect(p.loadNoById).toEqual({ B: null, C: 2, A: 3 });
    expect(p.viaje).toBe(3);
  });
  it("sola ya pasa la capacidad: al viaje nuevo va igual, y `excede` lo dice", () => {
    const p = planDeCambioDeViaje([[o("A", 2), o("B", 14)]], "B", 2, 12, 0);
    if (!p.ok) throw new Error("debía moverse");
    expect(p.excede).toBe(true);
  });
  it("lleva el `desde` que le dan", () => {
    const p = planDeCambioDeViaje([[o("A"), o("B")]], "B", 2, 10, 3);
    expect(p.ok && p.desde).toBe(3);
  });
  it("una parada que no está no mueve nada", () => {
    expect(planDeCambioDeViaje([[o("A")]], "Z", 2, 10, 0)).toEqual({ ok: false, motivo: "no_esta" });
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
  const flechas = cuerpoDe(pagina, "const move = async (laneKey: string, index: number, dir: -1 | 1) => {", "\n  };\n");
  const selector = cuerpoDe(pagina, "const moveStopToLoad = async (d: Delivery, destino: number) => {", "\n  };\n");
  const viajes = cuerpoDe(pagina, "const moveTrip = async (laneKey: string, index: number, dir: -1 | 1) => {", "\n  };\n");

  it("las flechas escriben lo que decide `planDeFlecha`, numerado tras lo ya hecho", () => {
    expect(flechas).toContain("planDeFlecha(trips, index, dir, hasManualLoads(stops), inicioDeLaRuta(laneKey, stops))");
  });
  it("las flechas señalan la parada movida y dicen su puesto", () => {
    expect(flechas).toContain("senalaLaMovida(item.id);");
    expect(flechas).toContain("parada ${plan.puesto + 1} de ${plan.total}");
  });
  it("el inicio de la ruta sale de lo ya hecho del chofer en las fechas de sus paradas", () => {
    expect(pagina).toContain("inicioDeLaSecuencia(hechasDelChofer(deliveries, laneKey, new Set(stops.map((s) => s.delivery_date ?? null))))");
  });
  it("el selector escribe la ruta entera con `planDeCambioDeViaje`: ya no deja la movida sin puesto", () => {
    expect(selector).toContain("planDeCambioDeViaje(trips, d.id, destino, capacidad, inicioDeLaRuta(driver, stops))");
    expect(selector).toContain("await reorderStops(plan.ids, plan.loadNoById, false, plan.desde);");
    expect(selector).not.toContain("route_seq: null");
  });
  it("el selector dice por qué no mueve cuando no cabe", () => {
    expect(selector).toContain('if (plan.motivo === "no_cabe") {');
    expect(selector).toContain("no cabe en el viaje ${plan.viaje}: ya lleva ${plan.carga} de ${plan.capacidad} pallets");
  });
  it("el selector entra en deshacer, con la foto de lo que escribió", () => {
    expect(selector).toContain("await anotaMovimiento({ en: `#${orderLabel(d)} → truckload ${plan.viaje}`, es: `#${orderLabel(d)} → viaje ${plan.viaje}` }, [driver], antes, fotoTrasReordenar(antes, plan.ids, plan.loadNoById, plan.desde));");
  });
  it("las opciones son los viajes que se pintan, y la que no cabe lo dice", () => {
    expect(pagina).toContain("{Array.from({ length: trips.length }, (_, k) => k + 1).map((n) => (");
    expect(pagina).toContain('!cabeEnElViaje(trips, d.id, n, capacity).cabe ? t(" — won\'t fit", " — no cabe") : ""');
  });
  it("mover un viaje entero también numera tras lo ya hecho", () => {
    expect(viajes).toContain("await reorderStops(next.flat().map((d) => d.id), loadNoById, undefined, inicioDeLaRuta(laneKey, stops));");
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
