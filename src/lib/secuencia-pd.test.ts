import { describe, expect, it } from "vitest";
import { etiquetaDeEntrega, secuenciaPD, type OrdenDeRuta } from "./secuencia-pd";

/** La ruta asignada a mano, leída como P1, P2… D1, D2… (D-334). Tiendas inventadas; los datos CONTRADICEN a propósito
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

  // Desde D-335 las pantallas no llaman a `secuenciaPD` directamente: pasan por `lecturaDeLaRuta`, que la usa cuando no hay
  // plan publicado —o cuando la ruta se tocó después— y usa las etiquetas del plan cuando la ruta sigue siendo la publicada.
  it("el Gestor: la tabla de paradas por ruta lee la ruta con los MISMOS viajes que pinta, y por chofer", () => {
    expect(gestor).toContain("const trips = buildTrips(stops, capacity); const lectura = lecturaDeLaRuta(trips, paradasPublicadasDe(u.driver)); const dDe = lectura.etiquetaDe;");
    expect(gestor).toContain('{d.route_seq != null ? (dDe.get(d.id) ?? i + 1) : "—"}</td>');
  });
  it("las filas que informan —recogidas, u otra carga de una orden repartida— van ANTES de su entrega, SIN flechas; solo con secuencia", () => {
    // El ORDEN de las filas lo decide `filasDelViaje` (probada en lectura-de-ruta.test.ts): aquí, que la tabla pinta ESO y nada más.
    const i = gestor.indexOf("{filasDelViaje(sequenced ? lectura : null, batch, ti === trips.length - 1).map((f) => {");
    expect(i).toBeGreaterThanOrEqual(0);
    const z = gestor.indexOf("const d = f.orden, bi = f.indice;", i);
    expect(z).toBeGreaterThan(i);
    const fila = gestor.slice(i, z);
    expect(fila).toContain('if (f.clase === "informa") { const p = f.fila; return (');
    expect(gestor).not.toMatch(/lectura\.previas\.get|batch\.map\(\(d, bi\)/);            // nadie las junta en cabeza del viaje por su cuenta
    expect(fila).toContain('{p.etiquetas.join("·")}');
    expect(fila).toContain("nombraLaOrden(deliveries, id, lang === \"es\")");
    expect(fila).toContain("pallets a bordo");
    expect(fila).not.toMatch(/moveStop|moveTrip|onClick|↑|↓/);
  });
  it("si la ruta cambió tras publicar, la tabla LO DICE, una vez por ruta", () => {
    expect(gestor).toContain("{sequenced && ti === 0 && lectura.cambioTrasPublicar && (");
    expect(gestor).toContain("Esta ruta cambió desde que se publicó el plan: las etiquetas P/D se recalcularon.");
  });
  it("el mapa: las entregas llevan su D y cada tienda donde la ruta recoge su «P1·P2» del color del chofer — con la misma lectura que la tabla", () => {
    expect(gestor).toContain("const badge = d.route_seq != null ? (dDeTodas.get(d.id) ?? String(idx + 1)) : undefined;");
    expect(gestor).toContain("const lectura = lecturaDeLaRuta(buildTrips(list, capacityFor(driverOf(laneKey))), paradasPublicadasDe(list[0].assigned_driver));");
    expect(gestor).toContain('badge: p.etiquetas.join("·"),');
    expect(gestor).toContain("color: colorFor(list[0].assigned_driver),");
    expect(gestor).toContain("if (!list.some((d) => d.route_seq != null)) continue;");
    expect(gestor).toContain("depotCoords, lanes, rutasPublicadas]);");                 // el plan llega después: el mapa se recalcula
  });
  it("el plan publicado se lee UNA vez por fecha, y sin UNA fecha —«todas», pendientes— no hay plan con el que comparar", () => {
    expect(gestor).toContain("const rutasPublicadas = usePlanPublicadoDelGestor(allDates || soloPendientes ? null : date, publicaciones);");
    expect(gestor).toContain("rutasPublicadas?.find((r) => r.chofer === chofer)?.paradas ?? null;");
    const hook = leer("src/lib/route-plan/usePlanPublicado.ts");
    expect(hook).toContain("fetch(`/api/route-plan?date=${encodeURIComponent(date)}&status=published`)");
    expect(hook).toContain("fetch(`/api/route-plan/mine?date=${encodeURIComponent(date)}`)");
    expect(hook.split("}, [date]);").length - 1).toBe(1);                                    // el chofer: al volver a entrar
  });
  it("recién PUBLICADO en la misma página, el Gestor relee el plan: publicar dispara lo que el hook tiene de dependencia", () => {
    const hook = leer("src/lib/route-plan/usePlanPublicado.ts"), panel = leer("src/components/PlanDelDia.tsx");
    expect(hook).toContain("export function usePlanPublicadoDelGestor(date: string | null, publicaciones: number)");
    expect(hook.split("}, [date, publicaciones]);").length - 1).toBe(1);
    expect(gestor).toContain("const [publicaciones, setPublicaciones] = useState(0);");
    expect(gestor).toContain("<PlanDelDia date={date} onPublicado={() => setPublicaciones((n) => n + 1)} />");
    // …y el panel lo llama SOLO en la rama de éxito de publicar, una vez.
    expect(panel.split("onPublicado?.()").length - 1).toBe(1);
    const exito = panel.indexOf("setPublicado({ escritas:"), llamada = panel.indexOf("onPublicado?.();"), fin = panel.indexOf("notify(t(\"Route published\"");
    expect(exito).toBeGreaterThanOrEqual(0);
    expect(llamada).toBeGreaterThan(exito);
    expect(fin).toBeGreaterThan(llamada);
    expect(hook).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(|method:/);
  });
  it("nada de esto escribe: ni `route_seq`, ni `load_no`, ni una orden", () => {
    const tabla = gestor.slice(gestor.indexOf("{sequenced && ti === 0 && lectura.cambioTrasPublicar"), gestor.indexOf("const d = f.orden, bi = f.indice;"));
    for (const trozo of [gestor.slice(gestor.indexOf("const dDeTodas"), gestor.indexOf("const badge = d.route_seq")), tabla]) {
      expect(trozo.length).toBeGreaterThan(50);
      expect(trozo).not.toMatch(/updateDelivery|route_seq:|load_no:|\.update\(|setStage/);
    }
  });
  it("«Mi ruta» del chofer: UNA lectura del plan, compartida por la tarjeta y la lista, para que las dos digan lo mismo", () => {
    expect(miRuta).toContain("const planPublicado = usePlanPublicadoDelChofer(todayISO());");
    expect(miRuta).toContain("lecturaDeLaRuta(trips, verAtrasadas ? null : planPublicado?.paradas ?? null)");
    expect(miRuta).toContain("<MiPlanPublicado plan={planPublicado}");
    expect(miRuta).toContain("const n = dDe.get(d.id) ?? String(startIdx + bi + 1);");
    expect(miRuta).toContain("badge: dDe.get(d.id) ?? String(i + 1),");
    expect(leer("src/components/MiPlanPublicado.tsx")).not.toMatch(/fetch\(|useEffect/);           // la tarjeta ya no pide nada
    const i = miRuta.indexOf("{filasDelViaje(lectura, batch, ti === trips.length - 1).map((f) => {");
    expect(i).toBeGreaterThanOrEqual(0);
    const z = miRuta.indexOf("const d = f.orden, bi = f.indice;", i);
    expect(z).toBeGreaterThan(i);
    expect(miRuta.slice(i, z)).not.toMatch(/onClick|<button/);
    expect(miRuta).not.toMatch(/lectura\.previas\.get|batch\.map\(\(d, bi\)/);
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
