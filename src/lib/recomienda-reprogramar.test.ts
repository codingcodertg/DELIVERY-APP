import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claveDeRecomendacion, guardaDejadaAsi, leeDejadasAsi, notaDeLaRecomendacion, ordenParaLaVuelta, parametrosDeVuelta, recomendacionesDelDia, tiendasConPunto,
} from "./recomienda-reprogramar";
import { PARAMETROS_DE_VUELTA_POR_DEFECTO } from "./route-engine";
import type { Delivery, Settings } from "./types";

/**
 * «Recomendaciones» del Gestor de Rutas (D-642): de las filas de la base a la regla del motor, y la pantalla que la usa.
 * Tiendas y nombres inventados (Alfa, Bravo, Coral, Delta juntas; Mesa lejos), como en la prueba del motor.
 */
const TIENDAS = [
  { name: "Alfa", address: "", lat: 26.2034, lng: -98.23 },
  { name: "Bravo", address: "", lat: 26.1948, lng: -98.1836 },
  { name: "Mesa", address: "", lat: 25.9017, lng: -97.4975 },
  { name: "Coral", address: "", lat: 26.3017, lng: -98.1633 },
  { name: "Delta", address: "", lat: 26.1595, lng: -97.9908 },
  { name: "Sin punto", address: "" },
];
const SETTINGS = {
  stores: TIENDAS,
  order_type_rules: {
    Intertienda: { storeToStore: true, docRef: "po", homeIsDestination: true },
    Transfer: { storeToStore: true, docRef: "estimate" },
    Customer: { storeToStore: false, docRef: "invoice" },
  },
  route_weights: null,
  route_hard_windows: ["0830-1000"],
} as unknown as Pick<Settings, "stores" | "order_type_rules" | "route_weights" | "route_hard_windows">;

type Fila = Parameters<typeof ordenParaLaVuelta>[0];
const fila = (id: string, extra: Partial<Delivery> = {}): Fila => ({
  id, stage: "approved", order_type: "Intertienda", store: "Alfa", pickup_name: null, delivery_name: "Mesa", delivery_lat: null, delivery_lng: null,
  delivery_date: "2026-10-22", delivery_windows: "0830-1730", est_pallets: 0.25, actual_pallets: null, is_training: false, priority: null, morning_priority: null,
  ...extra,
} as Fila);

describe("de la fila de la base a la regla", () => {
  it("intertienda por la regla de Ajustes (que recibe), no por el nombre: Transfer no lo es", () => {
    expect(ordenParaLaVuelta(fila("a"), SETTINGS)).toMatchObject({ intertienda: true, origen: "Alfa", destino: "Mesa", pallets: 0.25, urgente: false, movible: true });
    expect(ordenParaLaVuelta(fila("t", { order_type: "Transfer" }), SETTINGS)).toMatchObject({ intertienda: false, destino: null });
  });

  it("los pallets contados mandan sobre los estimados; el origen es la tienda de recogida si es una tienda con punto", () => {
    expect(ordenParaLaVuelta(fila("a", { actual_pallets: 2, pickup_name: "Bravo" }), SETTINGS)).toMatchObject({ pallets: 2, origen: "Bravo" });
    // Una recogida que no es tienda (un almacén con otro nombre), o una tienda sin punto: la tienda de la orden.
    expect(ordenParaLaVuelta(fila("a", { pickup_name: "Alfa Warehouse" }), SETTINGS).origen).toBe("Alfa");
    expect(ordenParaLaVuelta(fila("a", { pickup_name: "Sin punto" }), SETTINGS).origen).toBe("Alfa");
  });

  it("urgente: prioridad alta o crítica, primera hora, o ventana dura de Ajustes; lo que pide del camión, no", () => {
    expect(ordenParaLaVuelta(fila("a", { priority: "high" }), SETTINGS).urgente).toBe(true);
    expect(ordenParaLaVuelta(fila("a", { priority: "critical" }), SETTINGS).urgente).toBe(true);
    expect(ordenParaLaVuelta(fila("a", { priority: "low" }), SETTINGS).urgente).toBe(false);
    expect(ordenParaLaVuelta(fila("a", { morning_priority: true }), SETTINGS).urgente).toBe(true);
    expect(ordenParaLaVuelta(fila("a", { delivery_windows: "0830-1000" }), SETTINGS).urgente).toBe(true);
    expect(ordenParaLaVuelta(fila("a", { requirements: ["Montacargas"] }), SETTINGS).urgente).toBe(false);
  });

  it("movible solo mientras no ha salido", () => {
    for (const st of ["pending", "approved", "fulfilling", "ready"] as const) expect(ordenParaLaVuelta(fila("a", { stage: st }), SETTINGS).movible).toBe(true);
    for (const st of ["picked_up", "delivered"] as const) expect(ordenParaLaVuelta(fila("a", { stage: st }), SETTINGS).movible).toBe(false);
  });

  it("solo las tiendas con punto", () => {
    expect(tiendasConPunto(SETTINGS).map((t) => t.nombre)).toEqual(["Alfa", "Bravo", "Mesa", "Coral", "Delta"]);
  });
});

describe("las recomendaciones del día que mira el Gestor", () => {
  const HOY = "2026-10-22";
  it("0.25 pallets a Mesa el jueves, y el viernes ya va un viaje: al viernes", () => {
    const r = recomendacionesDelDia([fila("a"), fila("v", { delivery_date: "2026-10-23", store: "Mesa", delivery_name: "Bravo", est_pallets: 3 })], HOY, SETTINGS, HOY);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tienda: "Mesa", ids: ["a"], fechaSugerida: "2026-10-23", seJuntaCon: "viaje" });
  });

  it("el sábado se pasa al lunes: el domingo no se trabaja", () => {
    const r = recomendacionesDelDia([fila("a", { delivery_date: "2026-10-24" })], "2026-10-24", SETTINGS, HOY);
    expect(r[0].fechaSugerida).toBe("2026-10-26");
  });

  it("una ya entregada ese día cuenta: el viaje se hizo, y no se recomienda nada", () => {
    expect(recomendacionesDelDia([fila("a"), fila("e", { stage: "delivered", store: "Mesa", delivery_name: "Delta", est_pallets: 0.1 })], HOY, SETTINGS, HOY)).toEqual([]);
  });

  it("las de enseñanza, las anuladas y los borradores no cuentan para nada", () => {
    const ruido = ["canceled", "draft", "rejected"].map((st, i) => fila(`n${i}`, { stage: st as Delivery["stage"], store: "Mesa", delivery_name: "Delta", est_pallets: 0.1, order_type: "Customer" }));
    const r = recomendacionesDelDia([fila("a"), fila("t", { is_training: true, order_type: "Customer", est_pallets: 5 }), ...ruido], HOY, SETTINGS, HOY);
    expect(r.map((x) => x.ids)).toEqual([["a"]]);
  });

  it("un día pasado no se recomienda: no se reprograma hacia atrás", () => {
    expect(recomendacionesDelDia([fila("a", { delivery_date: "2026-10-21" })], "2026-10-21", SETTINGS, HOY)).toEqual([]);
  });

  it("los parámetros de Ajustes se usan: con umbral 0.2, 0.25 ya compensa", () => {
    const conAjustes = { ...SETTINGS, route_weights: { vuelta_lejana: { pallets: 0.2 } } } as typeof SETTINGS;
    expect(recomendacionesDelDia([fila("a")], HOY, conAjustes, HOY)).toEqual([]);
  });

  it("la nota del historial es el motivo, en el idioma de quien pulsa", () => {
    const [r] = recomendacionesDelDia([fila("a")], HOY, SETTINGS, HOY);
    expect(notaDeLaRecomendacion(r, "es")).toBe(`Recomendación del motor: ${r.motivo.es}`);
    expect(notaDeLaRecomendacion(r, "en")).toBe(`Route engine recommendation: ${r.motivo.en}`);
  });
});

describe("los parámetros guardados", () => {
  it("sin nada guardado, los de por defecto", () => {
    expect(parametrosDeVuelta({ route_weights: null })).toEqual(PARAMETROS_DE_VUELTA_POR_DEFECTO);
  });
  it("lo guardado y válido manda; lo que no es un número > 0, el de por defecto", () => {
    const s = { route_weights: { vuelta_lejana: { factor: 3, pallets: 0, radio_mi: 20, dias: Number.NaN } } } as unknown as Pick<Settings, "route_weights">;
    expect(parametrosDeVuelta(s)).toEqual({ factorDeLejania: 3, umbralPallets: PARAMETROS_DE_VUELTA_POR_DEFECTO.umbralPallets, radioMi: 20, diasAdelante: PARAMETROS_DE_VUELTA_POR_DEFECTO.diasAdelante });
  });
});

describe("«Dejar así», por día y por persona", () => {
  const r = { tienda: "Mesa", fecha: "2026-10-22", ids: ["b", "a"] };
  it("la clave no depende del orden de las órdenes, y cambia si entra otra", () => {
    expect(claveDeRecomendacion(r)).toBe(claveDeRecomendacion({ ...r, ids: ["a", "b"] }));
    expect(claveDeRecomendacion(r)).not.toBe(claveDeRecomendacion({ ...r, ids: ["a", "b", "c"] }));
  });

  it("se guarda y se lee; las de días pasados se olvidan al guardar", () => {
    const almacen: Record<string, string> = { rtg_routes_vuelta_dejar_asi_u1: JSON.stringify(["2026-10-20|mesa|x"]) };
    const leer = (k: string) => almacen[k] ?? null;
    const escribir = (k: string, v: string) => { almacen[k] = v; };
    const out = guardaDejadaAsi(leer, escribir, "u1", claveDeRecomendacion(r), "2026-10-22");
    expect([...out]).toEqual([claveDeRecomendacion(r)]);
    expect([...leeDejadasAsi(leer, "u1")]).toEqual([claveDeRecomendacion(r)]);
    // Otra persona en el mismo navegador no lo ve dejado.
    expect(leeDejadasAsi(leer, "u2").size).toBe(0);
  });

  it("un navegador que niega el almacenamiento, o basura guardada: nada dejado, y sin romper", () => {
    const niega = () => { throw new Error("SecurityError"); };
    expect(leeDejadasAsi(niega, "u1").size).toBe(0);
    expect(leeDejadasAsi(() => "{no es json", "u1").size).toBe(0);
    expect([...guardaDejadaAsi(niega, niega, "u1", "2026-10-22|mesa|a", "2026-10-22")]).toEqual(["2026-10-22|mesa|a"]);
  });
});

describe("la pantalla", () => {
  const raiz = join(__dirname, "..");
  const pagina = readFileSync(join(raiz, "app", "(app)", "routes", "page.tsx"), "utf8");
  const tarjeta = readFileSync(join(raiz, "components", "RecomendacionesDeVuelta.tsx"), "utf8");

  it("el Gestor pinta la tarjeta con TODAS sus órdenes (no solo las pendientes del día) y el día que mira", () => {
    const m = /<RecomendacionesDeVuelta\b([\s\S]*?)\/>/.exec(pagina);
    expect(m).not.toBeNull();
    const props = m![1];
    expect(props).toMatch(/\bdeliveries=\{deliveries\}/);
    expect(props).toMatch(/\bfecha=\{date\}/);
    expect(props).toMatch(/\breprogramarOrden=\{reprogramarOrden\}/);
    // Cada orden se abre en la ficha del Gestor (D-NEXT), la misma que abre una fila.
    expect(props).toMatch(/\babrirOrden=\{setOpenOrder\}/);
    expect(pagina).toContain("{openOrder && <OrderModal");
  });

  it("cada orden de la recomendación es un botón que la abre, con su código, factura, origen → destino y pallets (D-NEXT)", () => {
    expect(tarjeta).toContain("onClick={() => abrirOrden(d)}");
    expect(tarjeta).toContain("data-abre-orden-recomendada={d.id}");
    for (const pieza of ["`#${orderLabel(d)}`", "`INV ${d.invoice_num}`", "→ ${d.delivery_name", "palletsDeLaOrden(d)"]) expect(tarjeta).toContain(pieza);
  });

  it("solo en el Gestor viendo un día (no en «Ruta de hoy», ni en «Todas», ni en las atrasadas)", () => {
    const i = pagina.indexOf("<RecomendacionesDeVuelta");
    const antes = pagina.slice(Math.max(0, i - 200), i);
    expect(antes).toMatch(/!soloLectura && modo === "dia" && \(\s*$/);
  });

  it("la tarjeta calcula con las órdenes y el día que recibe, y reprograma a la fecha sugerida con la nota del motivo", () => {
    expect(tarjeta).toMatch(/recomendacionesDelDia\(deliveries, fecha, settings, hoy\)/);
    expect(tarjeta).toMatch(/reprogramarOrden\(id, r\.fechaSugerida, notaDeLaRecomendacion\(r, lang\), lang\)/);
  });
});
