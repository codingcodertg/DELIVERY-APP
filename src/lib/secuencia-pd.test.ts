import { describe, expect, it } from "vitest";
import { etiquetaDeEntrega, secuenciaPD, type OrdenDeRuta } from "./secuencia-pd";

/** La ruta asignada a mano, leída como P1, P2… D1, D2… (D-NEXT). Tiendas inventadas; los datos CONTRADICEN a propósito
 *  el orden «fácil»: entregas intercaladas entre tiendas, para que numerar por entrega y numerar por recogida no coincidan. */

const o = (id: string, store: string | null, pallets: number | null = 1): OrdenDeRuta => ({ id, store, pallets });
const lee = (viajes: OrdenDeRuta[][]) => secuenciaPD(viajes).map((p) => `${p.etiquetas.join("·")}${p.tipo === "P" ? ` — ${p.tienda ?? "sin tienda"}` : ""}`);

describe("la secuencia P/D de una ruta manual", () => {
  it("una tienda: se carga todo y se entrega en el orden que se decidió — Base → P1·P2·P3 → D1 → D2 → D3", () => {
    expect(lee([[o("a", "Tienda Norte"), o("b", "Tienda Norte"), o("c", "Tienda Norte")]])).toEqual(["P1·P2·P3 — Tienda Norte", "D1", "D2", "D3"]);
  });

  it("ENTREGAS INTERCALADAS entre dos tiendas: los P se leen 1, 2, 3 y son los D los que saltan; una tienda, una sola parada", () => {
    // Se entrega a (Norte), b (Sur), c (Norte). Numerando por entrega saldría «P1·P3 — Norte → P2 — Sur»: se lee como un error.
    expect(lee([[o("a", "Tienda Norte"), o("b", "Tienda Sur"), o("c", "Tienda Norte")]])).toEqual(["P1·P2 — Tienda Norte", "P3 — Tienda Sur", "D1", "D3", "D2"]);
  });

  it("`Dk` es SIEMPRE la entrega de la orden recogida en `Pk`", () => {
    const s = secuenciaPD([[o("a", "Tienda Norte"), o("b", "Tienda Sur"), o("c", "Tienda Norte"), o("d", "Tienda Sur")]]);
    const numeroAlRecoger = new Map(s.filter((p) => p.tipo === "P").flatMap((p) => p.ordenes.map((id, k) => [id, p.etiquetas[k].slice(1)] as const)));
    for (const d of s.filter((p) => p.tipo === "D")) expect(d.etiquetas[0].slice(1), d.ordenes[0]).toBe(numeroAlRecoger.get(d.ordenes[0]));
    expect([...etiquetaDeEntrega(s)]).toEqual([["a", "D1"], ["b", "D3"], ["c", "D2"], ["d", "D4"]]);
  });

  it("las tiendas se recorren en el orden de su PRIMERA entrega, que es lo único que una persona decidió", () => {
    expect(lee([[o("b", "Tienda Sur"), o("a", "Tienda Norte"), o("c", "Tienda Sur")]])).toEqual(["P1·P2 — Tienda Sur", "P3 — Tienda Norte", "D1", "D3", "D2"]);
  });

  it("dos viajes: cada uno carga y luego entrega; la numeración NO se reinicia; volver a la misma tienda es OTRA parada", () => {
    expect(secuenciaPD([[o("a", "Tienda Norte"), o("b", "Tienda Norte")], [o("c", "Tienda Norte"), o("d", "Tienda Sur")]]).map((p) => [p.viaje, p.etiquetas.join("·")])).toEqual([
      [1, "P1·P2"], [1, "D1"], [1, "D2"], [2, "P3"], [2, "P4"], [2, "D3"], [2, "D4"],
    ]);
  });

  it("la tienda se reconoce sin mirar mayúsculas ni espacios, y se enseña como está escrita la primera vez", () => {
    expect(lee([[o("a", " Tienda Norte "), o("b", "tienda norte")]])).toEqual(["P1·P2 — Tienda Norte", "D1", "D2"]);
  });

  it("una orden SIN «Vendido desde» no se junta con otra sin tienda: no se sabe que salgan del mismo sitio", () => {
    expect(lee([[o("a", null), o("b", "  "), o("c", "Tienda Norte")]])).toEqual(["P1 — sin tienda", "P2 — sin tienda", "P3 — Tienda Norte", "D1", "D2", "D3"]);
  });

  it("una Intertienda con la forma de D-312 —«Vendido desde» es la tienda que MANDA— recoge ahí, como cualquier otra", () => {
    // store = la que manda (y pickup_name); la que recibe va en delivery_name y aquí no pinta nada: es el destino.
    expect(lee([[o("inter", "Tienda que Manda"), o("cliente", "Tienda que Manda")]])).toEqual(["P1·P2 — Tienda que Manda", "D1", "D2"]);
  });

  it("sin viajes, o con un viaje vacío, no hay nada que leer", () => {
    expect(secuenciaPD([])).toEqual([]);
    expect(secuenciaPD([[]])).toEqual([]);
  });
});

describe("pallets a bordo tras cada parada", () => {
  it("sube en P y baja en D; el camión acaba cada viaje vacío", () => {
    const s = secuenciaPD([[o("a", "Tienda Norte", 2.5), o("b", "Tienda Sur", 4), o("c", "Tienda Norte", 1)]]);
    expect(s.map((p) => [p.etiquetas.join("·"), p.aBordo])).toEqual([["P1·P2", 3.5], ["P3", 7.5], ["D1", 5], ["D3", 1], ["D2", 0]]);
  });
  it("en centésimas, como el motor: 0,1 + 0,2 es 0,3 y no 0,30000000000000004", () => {
    expect(secuenciaPD([[o("a", "T", 0.1), o("b", "T", 0.2)]]).map((p) => p.aBordo)).toEqual([0.3, 0.2, 0]);
    // 0,1 y 0,2 por cien dan enteros exactos y no prueban nada; 0,07 · 100 es 7,000000000000001. Con estos sí se nota.
    expect(secuenciaPD([[o("a", "T", 0.07), o("b", "T", 0.14), o("c", "T", 0.28)]]).map((p) => p.aBordo)).toEqual([0.49, 0.42, 0.28, 0]);
  });
  it("cada viaje empieza vacío; y una orden sin pallets contados cuenta 0 y SE AVISA, en su recogida y en su entrega", () => {
    const s = secuenciaPD([[o("a", "T", 3)], [o("b", "T", null), o("c", "T", 2)]]);
    expect(s.map((p) => [p.etiquetas.join("·"), p.aBordo, p.sinConteo])).toEqual([["P1", 3, false], ["D1", 0, false], ["P2·P3", 2, true], ["D2", 2, true], ["D3", 0, false]]);
  });
});

describe("de las órdenes de un viaje a lo que esto necesita", () => {
  it("la tienda es «Vendido desde»; pallets: los reales si ya se contaron, si no los estimados, y si no hay ninguno, null", async () => {
    const { ordenesDeRuta } = await import("./secuencia-pd");
    expect(ordenesDeRuta([
      { id: "a", store: "Tienda Norte", actual_pallets: 3, est_pallets: 5 }, { id: "b", store: null, actual_pallets: null, est_pallets: 2 }, { id: "c" },
      { id: "d", store: "T", actual_pallets: 0, est_pallets: 4 },
    ])).toEqual([{ id: "a", store: "Tienda Norte", pallets: 3 }, { id: "b", store: null, pallets: 2 }, { id: "c", store: null, pallets: null }, { id: "d", store: "T", pallets: 0 }]);
  });
});

describe("dónde se ve", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n").replace(/\s+/g, " ");
  const gestor = leer("src/app/(app)/routes/page.tsx"), miRuta = leer("src/app/(app)/my-route/page.tsx"), panel = leer("src/components/PlanDelDia.tsx");

  it("el Gestor: la tabla de paradas por ruta lee la ruta con la función probada, con los MISMOS viajes que pinta", () => {
    expect(gestor).toContain("const trips = buildTrips(stops, capacity); const pd = secuenciaPD(trips.map(ordenesDeRuta)); const dDe = etiquetaDeEntrega(pd);");
    expect(gestor).toContain('{d.route_seq != null ? (dDe.get(d.id) ?? i + 1) : "—"}</td>');
  });
  it("las recogidas son filas propias, una por tienda, SIN flechas; solo salen cuando la ruta ya tiene secuencia", () => {
    const i = gestor.indexOf('{sequenced && pd.filter((p) => p.tipo === "P" && p.viaje === ti + 1).map((p) => (');
    expect(i).toBeGreaterThanOrEqual(0);
    const fila = gestor.slice(i, gestor.indexOf("{batch.map((d, bi) => {", i));
    expect(fila).toContain('{p.etiquetas.join("·")}');
    expect(fila).toContain("nombraLaOrden(deliveries, id, lang === \"es\")");
    expect(fila).toContain("pallets a bordo");
    expect(fila).not.toMatch(/moveStop|moveTrip|onClick|↑|↓/);
  });
  it("el mapa: las entregas pasan de «1, 2, 3» a «D1, D2…», y cada tienda donde la ruta recoge lleva su «P1·P2» del color del chofer", () => {
    expect(gestor).toContain("const badge = d.route_seq != null ? (dDeTodas.get(d.id) ?? String(idx + 1)) : undefined;");
    expect(gestor).toContain("const pd = secuenciaPD(buildTrips(list, capacityFor(driverOf(laneKey))).map(ordenesDeRuta));");
    expect(gestor).toContain('badge: p.etiquetas.join("·"),');
    expect(gestor).toContain("color: colorFor(list[0].assigned_driver),");
    // Una ruta sin secuencia todavía no tiene etiquetas que enseñar.
    expect(gestor).toContain("if (!list.some((d) => d.route_seq != null)) continue;");
  });
  it("nada de esto escribe: ni `route_seq`, ni `load_no`, ni una orden", () => {
    for (const trozo of [gestor.slice(gestor.indexOf("const dDeTodas"), gestor.indexOf("const badge = d.route_seq")), gestor.slice(gestor.indexOf("{sequenced && pd.filter"), gestor.indexOf("{batch.map((d, bi) => {", gestor.indexOf("{sequenced && pd.filter")))]) {
      expect(trozo.length).toBeGreaterThan(50);
      expect(trozo).not.toMatch(/updateDelivery|route_seq:|load_no:|\.update\(|setStage/);
    }
  });
  it("«Mi ruta» del chofer lo lee igual: recogidas por tienda que informan y no se pulsan, y entregas con su D", () => {
    expect(miRuta).toContain("const pd = useMemo(() => secuenciaPD(trips.map(ordenesDeRuta)), [trips]);");
    expect(miRuta).toContain("const n = dDe.get(d.id) ?? String(startIdx + bi + 1);");
    expect(miRuta).toContain("badge: dDe.get(d.id) ?? String(i + 1),");
    const i = miRuta.indexOf('{pd.filter((p) => p.tipo === "P" && p.viaje === ti + 1).map((p) => (');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(miRuta.slice(i, miRuta.indexOf("{batch.map((d, bi) => {", i))).not.toMatch(/onClick|<button/);
  });
  it("«Plan del día» dice lo que hace y lo que da —con P1, P2… D1, D2… dentro—; sin plan, el botón es el primario y dice cuántas órdenes hay", () => {
    expect(panel).toContain('t("Build today\'s routes automatically", "Armar las rutas del día automáticamente")');
    expect(panel).toContain("sequences pickups (P1, P2…) and deliveries (D1, D2…) with estimated times");
    expect(panel).toContain("ordena recogidas (P1, P2…) y entregas (D1, D2…) con horas estimadas");
    expect(panel).toContain('className={borrador ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"}');
    expect(panel).toContain('const sinPlan = ordenesDelDia(deliveries, date, "dia", ETAPAS_RUTEABLES).length;');
    expect(panel).toContain("{!borrador && sinPlan > 0 && <span");
    expect(panel).not.toMatch(/motor nuevo|new engine/i);
  });
});
