import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ordenaPorRecogidas, planDeFlechaDeRecogida } from "./mover-recogida";
import { planDeCambioDeViaje, planDeCambioDeViajeDeVarias } from "./mover-parada";
import { secuenciaPD, ordenesDeRuta } from "./secuencia-pd";
import { lecturaDeLaRuta, recogidasPorViaje } from "./route-plan/lectura-de-ruta";
import { pasaElViaje, viajeEfectivo } from "./filtro-de-viaje";
import { splitIntoTrips } from "./dispatch";
import type { Delivery } from "./types";

/**
 * La tarjeta de Maximo Garza del 2026-09-28 (D-NEXT), con tiendas y facturas inventadas del mismo tamaño: viaje 1 recoge en
 * «Norte» dos órdenes (a, c) y en «Sur» una (b), y entrega a, b, c en ese orden; viaje 2 recoge en «Sur» (d) y la entrega.
 * Es la forma de la captura: P1·P2 Norte, P3 Sur, D1, D3, D2 · P4 Sur, D4 — dos recogidas en la MISMA tienda en viajes
 * distintos, y las D del viaje 1 «fuera de orden».
 */
const o = (id: string, store: string | null, pallets = 3) => ({ id, store, est_pallets: pallets, actual_pallets: null as number | null, route_seq: 0 as number | null, load_no: null as number | null });
const maximo = () => [[o("a", "Norte"), o("b", "Sur"), o("c", "Norte")], [o("d", "Sur", 2)]];
const lee = (viajes: readonly (readonly ReturnType<typeof o>[])[]) =>
  secuenciaPD(viajes.map((v) => ordenesDeRuta(v))).map((p) => `${p.etiquetas.join("·")}${p.tipo === "P" ? ` ${p.tienda}` : ""}`);
const ids = (v: readonly { id: string }[]) => v.map((x) => x.id);

describe("las etiquetas D1, D3, D2 de la captura NO son un fallo: el número es el de RECOGIDA (D-334)", () => {
  it("la ruta de la captura se lee P1·P2 Norte, P3 Sur, D1, D3, D2 · P4 Sur, D4", () => {
    expect(lee(maximo())).toEqual(["P1·P2 Norte", "P3 Sur", "D1", "D3", "D2", "P4 Sur", "D4"]);
  });
});

describe("el color del mapa: cada recogida con SU viaje (`recogidasPorViaje`)", () => {
  it("P4, en la misma tienda que P3, es del viaje 2 — no del 1", () => {
    const viajes = maximo();
    const r = recogidasPorViaje(lecturaDeLaRuta(viajes, null), viajes).map((x) => `${x.fila.etiquetas.join("·")}@${x.viaje}`);
    expect(r).toEqual(["P1·P2@0", "P3@0", "P4@1"]);
  });
  it("lo que la lectura deja AL FINAL (p. ej. la recogida de una orden ya entregada, D-433) va con el último viaje, como en la tabla", () => {
    const viajes = maximo();
    const lectura = lecturaDeLaRuta(viajes, null);
    const conFinal = { ...lectura, alFinal: [{ tipo: "P" as const, etiquetas: ["P9"], ordenes: ["z"], lugar: "Este", aBordo: 1, sinConteo: false }] };
    expect(recogidasPorViaje(conFinal, viajes).map((x) => `${x.fila.etiquetas[0]}@${x.viaje}`)).toEqual(["P1@0", "P3@0", "P4@1", "P9@1"]);
  });
  it("las filas que no son de recogida (otra carga de una orden repartida) no salen como P", () => {
    const viajes = maximo();
    const lectura = lecturaDeLaRuta(viajes, null);
    const conOtra = { ...lectura, alFinal: [{ tipo: "D" as const, etiquetas: ["D9"], ordenes: ["a"], lugar: null, aBordo: 0, sinConteo: false }] };
    expect(recogidasPorViaje(conOtra, viajes)).toHaveLength(3);
  });
});

describe("reordenar recogidas: se adelanta la PRIMERA entrega de la tienda, y nada más (`ordenaPorRecogidas`)", () => {
  it("Sur antes que Norte: la entrega de b pasa delante de la de a; c no se mueve", () => {
    expect(ids(ordenaPorRecogidas(maximo()[0], ["sur", "norte"]))).toEqual(["b", "a", "c"]);
  });
  it("el orden que ya hay no cambia nada", () => {
    expect(ids(ordenaPorRecogidas(maximo()[0], ["norte", "sur"]))).toEqual(["a", "b", "c"]);
  });
  it("tres tiendas, la última a la cabeza: solo su primera entrega se adelanta", () => {
    const v = [o("a", "Norte"), o("b", "Sur"), o("c", "Este"), o("d", "Norte")];
    expect(ids(ordenaPorRecogidas(v, ["este", "norte", "sur"]))).toEqual(["c", "a", "b", "d"]);
  });
  it("una tienda que no está en la lista va detrás, en su orden de hoy", () => {
    const v = [o("a", "Norte"), o("b", "Sur"), o("c", "Este")];
    expect(ids(ordenaPorRecogidas(v, ["este"]))).toEqual(["c", "a", "b"]);
  });
});

describe("la flecha de una fila P (`planDeFlechaDeRecogida`)", () => {
  const grupos = [["a", "c"], ["b"]];              // las filas P del viaje 1, como se pintan: P1·P2 Norte, P3 Sur
  it("↑ en P3 Sur: Sur se recoge primero, la ruta ENTERA se reescribe, y lo que se lee después es lo pedido", () => {
    const p = planDeFlechaDeRecogida(maximo(), 0, grupos, 1, -1, true, 10, 4)!;
    expect(p.ids).toEqual(["b", "a", "c", "d"]);
    expect(p.desde).toBe(4);
    expect(p.loadNoById).toEqual({ b: null, a: null, c: null, d: 2 });   // con viajes a mano, cada una en su viaje
    expect(p.adelantada).toBe("b");
    expect(p.delanteDe).toBe("a");
    const despues = [[o("b", "Sur"), o("a", "Norte"), o("c", "Norte")], [o("d", "Sur", 2)]];
    expect(lee(despues)).toEqual(["P1 Sur", "P2·P3 Norte", "D1", "D2", "D3", "P4 Sur", "D4"]);
  });
  it("↓ en P1·P2 Norte es lo mismo que ↑ en P3 Sur", () => {
    const p = planDeFlechaDeRecogida(maximo(), 0, grupos, 0, 1, true, 10, 0)!;
    expect(p.ids).toEqual(["b", "a", "c", "d"]);
  });
  it("la primera no sube y la última no baja: `null`, y la pantalla apaga la flecha", () => {
    expect(planDeFlechaDeRecogida(maximo(), 0, grupos, 0, -1, true, 10, 0)).toBeNull();
    expect(planDeFlechaDeRecogida(maximo(), 0, grupos, 1, 1, true, 10, 0)).toBeNull();
    expect(planDeFlechaDeRecogida(maximo(), 1, [["d"]], 0, -1, true, 10, 0)).toBeNull();   // P4, sola en su viaje
  });
  it("una fila P cuyas órdenes no son de este viaje (lo ya entregado, D-433) no se mueve — ni desordena las demás", () => {
    expect(planDeFlechaDeRecogida(maximo(), 0, [["zz"], ["b"]], 0, 1, true, 10, 0)).toBeNull();
    // Con la entregada DELANTE de dos tiendas: su ↓ no puede intercambiar Norte y Sur.
    expect(planDeFlechaDeRecogida(maximo(), 0, [["zz"], ["a", "c"], ["b"]], 0, 1, true, 10, 0)).toBeNull();
  });
  it("sin viajes a mano basta la secuencia", () => {
    const p = planDeFlechaDeRecogida([[o("a", "Norte"), o("b", "Sur")]], 0, [["a"], ["b"]], 1, -1, false, 10, 0)!;
    expect(p.ids).toEqual(["b", "a"]);
    expect(p.loadNoById).toBeUndefined();
    expect(p.fijaViajes).toBe(false);
  });
  it("sin viajes a mano, si el orden nuevo partiría la ruta distinto por capacidad, se FIJAN los viajes que se ven", () => {
    // 0,3 + 0,2 + 0,1 cabe justo en 0,6; en el orden 0,3 + 0,1 + 0,2 la suma en coma flotante da 0,6000000000000001.
    const v = [[o("a", "Norte", 0.3), o("b", "Sur", 0.2), o("c", "Este", 0.1)]];
    const p = planDeFlechaDeRecogida(v, 0, [["a"], ["b"], ["c"]], 2, -1, false, 0.6, 0)!;
    expect(p.ids).toEqual(["a", "c", "b"]);
    expect(splitIntoTrips(p.ids.map((id) => v[0].find((x) => x.id === id)!) as unknown as Delivery[], 0.6).length).toBe(2);  // se partiría
    expect(p.fijaViajes).toBe(true);
    expect(p.loadNoById).toEqual({ a: null, c: null, b: null });            // y así sigue siendo UN viaje
  });
});

describe("el selector «Viaje N» de una fila P mueve TODA su carga (`planDeCambioDeViajeDeVarias`)", () => {
  it("P1·P2 Norte (a, c) a un viaje nuevo: las dos, en su orden, y la ruta entera", () => {
    const p = planDeCambioDeViajeDeVarias(maximo(), ["a", "c"], 3, 10, 0);
    if (!p.ok) throw new Error("debía moverse");
    expect(p.ids).toEqual(["b", "d", "a", "c"]);
    expect(p.loadNoById).toEqual({ b: null, d: 2, a: 3, c: 3 });
    expect(p.viaje).toBe(3);
    expect(p.nuevo).toBe(true);
  });
  it("P4 (d, 2 pallets) al viaje 1, que lleva 9 de 10: no cabe, no se mueve nada, y dice cuánto", () => {
    const v = [[o("a", "Norte", 3), o("b", "Sur", 3), o("c", "Norte", 3)], [o("d", "Sur", 2)]];
    expect(planDeCambioDeViajeDeVarias(v, ["d"], 1, 10, 0)).toEqual({ ok: false, motivo: "no_cabe", viaje: 1, carga: 9, pallets: 2, capacidad: 10 });
  });
  it("cabe lo que cabe ENTERO: dos órdenes que juntas no caben no entran aunque una sola sí", () => {
    const v = [[o("a", "Norte", 4)], [o("b", "Sur", 3), o("c", "Sur", 3)]];
    expect(planDeCambioDeViajeDeVarias(v, ["b", "c"], 1, 8, 0)).toMatchObject({ ok: false, motivo: "no_cabe", carga: 4, pallets: 6 });
    expect(planDeCambioDeViajeDeVarias(v, ["b"], 1, 8, 0).ok).toBe(true);
  });
  it("todas solas en el último viaje a uno nuevo: no hay cambio — también si son dos", () => {
    expect(planDeCambioDeViajeDeVarias(maximo(), ["d"], 3, 10, 0)).toEqual({ ok: false, motivo: "sin_cambio" });
    const v = [[o("a", "Norte")], [o("b", "Sur"), o("c", "Sur")]];
    expect(planDeCambioDeViajeDeVarias(v, ["b", "c"], 3, 10, 0)).toEqual({ ok: false, motivo: "sin_cambio" });
    // Si en el último viaje queda otra, sí se abre uno nuevo.
    expect(planDeCambioDeViajeDeVarias([[o("a", "Norte")], [o("b", "Sur"), o("c", "Sur"), o("e", "Este")]], ["b", "c"], 3, 10, 0).ok).toBe(true);
  });
  it("órdenes de viajes distintos, o una que no está: no se mueve nada", () => {
    expect(planDeCambioDeViajeDeVarias(maximo(), ["a", "d"], 3, 10, 0)).toEqual({ ok: false, motivo: "no_esta" });
    expect(planDeCambioDeViajeDeVarias(maximo(), ["a", "zz"], 3, 10, 0)).toEqual({ ok: false, motivo: "no_esta" });
  });
  it("con una sola orden es exactamente el selector de una parada (D-433)", () => {
    for (const [id, dest] of [["b", 2], ["a", 3], ["d", 1]] as const) {
      expect(planDeCambioDeViajeDeVarias(maximo(), [id], dest, 10, 2)).toEqual(planDeCambioDeViaje(maximo(), id, dest, 10, 2));
    }
  });
});

describe("«Ver un viaje» (`viajeEfectivo`, `pasaElViaje`)", () => {
  it("sin elegir, todos", () => {
    expect(viajeEfectivo(undefined, 2)).toBeNull();
    expect(pasaElViaje(null, 0) && pasaElViaje(null, 1)).toBe(true);
  });
  it("«Viaje 2» enseña solo el 2", () => {
    expect(viajeEfectivo(1, 2)).toBe(1);
    expect([0, 1].map((ti) => pasaElViaje(1, ti))).toEqual([false, true]);
  });
  it("un «Viaje N» que el chofer ya no tiene vuelve a todos", () => {
    expect(viajeEfectivo(2, 2)).toBeNull();
    expect(viajeEfectivo(1, 1)).toBeNull();
  });
});

// La pantalla usa esto: la prueba se alimenta de quien llama.
const pagina = readFileSync(join(__dirname, "..", "app", "(app)", "routes", "page.tsx"), "utf8").replace(/\r\n/g, "\n");
const cuerpo = (desde: string, hasta: string) => {
  const i = pagina.indexOf(desde);
  expect(i).toBeGreaterThan(-1);
  const j = pagina.indexOf(hasta, i + desde.length);
  expect(j).toBeGreaterThan(i);
  return pagina.slice(i, j);
};

describe("la pantalla: las filas P se mueven con lo de arriba", () => {
  const flecha = cuerpo("const moveRecogida = async (", "\n  };\n");
  const selector = cuerpo("const moveRecogidaToLoad = async (", "\n  };\n");
  it("la flecha escribe lo que decide `planDeFlechaDeRecogida`, numerado tras lo hecho, y entra en deshacer", () => {
    expect(flecha).toContain("planDeFlechaDeRecogida(trips, ti, grupos, k, dir, hasManualLoads(stops), capacidad, inicioDeLaRuta(laneKey, stops))");
    expect(flecha).toContain("await reorderStops(plan.ids, plan.loadNoById, plan.fijaViajes ? false : undefined, plan.desde);");
    expect(flecha).toContain("fotoTrasReordenar(antes, plan.ids, plan.loadNoById, plan.desde)");
    expect(flecha).toContain("se entrega ahora antes que");
  });
  it("el selector de la P mueve todas sus órdenes con `planDeCambioDeViajeDeVarias`, y dice por qué no cuando no cabe", () => {
    expect(selector).toContain("planDeCambioDeViajeDeVarias(trips, ids, destino, capacidad, inicioDeLaRuta(laneKey, stops))");
    expect(selector).toContain("await reorderStops(plan.ids, plan.loadNoById, false, plan.desde);");
    expect(selector).toContain('if (plan.motivo === "no_cabe") {');
    expect(selector).toContain("fotoTrasReordenar(antes, plan.ids, plan.loadNoById, plan.desde)");
  });
  it("la fila P pinta las flechas apagadas cuando no harían nada, y el selector con los viajes que se pintan", () => {
    expect(pagina).toContain("disabled={!planDeFlechaDeRecogida(trips, ti, gruposP, k, -1, manualLoads, capacity, 0)}");
    expect(pagina).toContain("disabled={!planDeFlechaDeRecogida(trips, ti, gruposP, k, 1, manualLoads, capacity, 0)}");
    expect(pagina).toContain("onClick={() => moveRecogida(u.key, ti, gruposP, k, -1)}");
    expect(pagina).toContain("onClick={() => moveRecogida(u.key, ti, gruposP, k, 1)}");
    expect(pagina).toContain('void moveRecogidaToLoad(u.key, suyas, p.lugar, v === "__new__" ? trips.length + 1 : Number(v));');
    expect(pagina).toContain("const gruposP = filasP.map((f) => (f.clase === \"informa\" ? f.fila.ordenes.filter((id) => enEsteViaje.has(id)) : []));");
  });
});

describe("la pantalla: «Ver un viaje» filtra la tabla y el mapa, y no escribe", () => {
  it("la tabla salta los viajes que no se ven", () => {
    expect(pagina).toContain("const visto = viajeEfectivo(viajeVisto[u.key], trips.length);");
    expect(pagina).toContain("if (!pasaElViaje(visto, ti)) return null;");
  });
  it("el mapa: las entregas, las recogidas y las líneas de ese chofer, solo del viaje elegido", () => {
    expect(pagina).toContain("if (!pasaElViaje(visto, ti)) ocultaPorViaje.add(d.id);");
    expect(pagina).toContain("if (!sel && ocultaPorViaje.has(d.id)) continue;");
    expect(pagina).toContain("if (!p.lugar || !pasaElViaje(visto, viaje)) continue;");
    expect(pagina).toContain("if (!pasaElViaje(visto, i)) return;");
    expect(pagina).toContain("sigueSuPlan(driver) && vistoDe(driver) == null");
    expect(pagina).toContain("filtroChofer, viajeVisto]);");
  });
  it("se vacía al cambiar de día, y el selector solo cambia el estado de la página", () => {
    expect(pagina).toContain("useEffect(() => { setViajeVisto({}); }, [date]);");
    const sel = cuerpo("<select data-viaje-visto={u.key}", "</select>");
    expect(sel).toContain("setViajeVisto((m) =>");
    expect(sel).not.toMatch(/reorderStops|updateDelivery|savePrefs|user_prefs/);
  });
});
