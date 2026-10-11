import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PREFIJO_HECHA, carrilesDelDia, ordenDelPunto, puntosDeLasRutas, rutasPorChofer } from "@/lib/mapa-de-rutas";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";

/**
 * D-514 · El mapa de «Mi ruta» ES el del Gestor.
 *
 * El dueño, tres veces: «quiero que el chofer mire el mapa con sus rutas asi como el logistic manager ese mismo mapa», y
 * con una captura de «Mi ruta» después de D-506: «MIRA EL MAPA SIGUE IGUAL». D-506 había puesto el mapa del Gestor en otra
 * página, detrás de un botón, y dejado aquí el de siempre.
 *
 * Lo que se pinta —el mapa entero, acotado al chofer, en el demo— se miró en el navegador y está en la decisión. Lo que se
 * fija aquí es lo que decide «Mi ruta» y lo que podría romperse sin que nadie lo viera:
 *  - que tocar una entrega YA HECHA siga abriendo su orden, con los ids que el mapa del Gestor produce DE VERDAD;
 *  - que «Mi ruta» monte el mapa del Gestor acotado al chofer y en su día, y no pinte otro propio;
 *  - que el día que pasa entre por el acotado de la ventana de historial (D-239), no por fuera.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (en: string) => en;

const orden = (id: string, stage: string, extra: Record<string, unknown> = {}) => ({
  id, order_no: id.charCodeAt(0), order_code: id.toUpperCase(), invoice_num: `INV-${id}`, stage, assigned_driver: "Ana",
  route_seq: 0, delivery_lat: 26.2 + id.charCodeAt(0) / 1000, delivery_lng: -98.2, store: "RDZ Pharr",
  delivery_address: `${id} Main St`, delivery_date: "2026-10-10", ...extra,
});

describe("tocar una parada abre SU orden, también si ya está entregada", () => {
  // Una pendiente y una hecha, por la función de verdad: los ids salen de `puntosDeLasRutas`, no de esta prueba.
  const pendiente = orden("a", "ready");
  const hecha = orden("h", "delivered", { route_seq: 1, pod_delivered_at: "2026-10-10T15:00:00Z" });
  const puntos = puntosDeLasRutas({
    carriles: carrilesDelDia([{ id: "u-ana", full_name: "Ana" }], [], [pendiente], ["Ana"]),
    porChofer: rutasPorChofer([pendiente]), delDia: [pendiente], hechas: new Map([["Ana", [hecha]]]),
    pasaFiltro: () => true, soloUnChofer: true, enfocado: false, atenuada: () => false, colorDe: () => "azul", colorSinChofer: "gris",
    baseDe: () => ({ coords: [26.19, -98.18], direccion: "RDZ Pharr" }), lecturaDe: (_k, s) => lecturaConLoHecho(s, 12, null, []),
    coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), t,
  });

  it("la entrega hecha sale con su propia clave — y por eso hace falta traducirla", () => {
    // Si esto dejara de ser cierto, la prueba de abajo no mediría nada: se afirma primero que el caso existe.
    expect(puntos.some((p) => p.id === `${PREFIJO_HECHA}h`)).toBe(true);
    expect(puntos.some((p) => p.id === "a")).toBe(true);
  });

  it("de cada punto de entrega, su orden: la pendiente tal cual, la hecha sin el prefijo", () => {
    const ordenes = puntos.map((p) => ordenDelPunto(p.id)).filter((x): x is string => x != null).sort();
    expect(ordenes).toEqual(["a", "h"]);
  });

  it("la base y la recogida en tienda no son una orden: no abren nada", () => {
    const noOrdenes = puntos.filter((p) => p.id.startsWith("__") && !p.id.startsWith(PREFIJO_HECHA));
    expect(noOrdenes.length).toBeGreaterThan(0);
    for (const p of noOrdenes) expect([p.id, ordenDelPunto(p.id)]).toEqual([p.id, null]);
  });

  it("un id vacío o un prefijo solo no inventan una orden", () => {
    expect(ordenDelPunto("")).toBeNull();
    expect(ordenDelPunto(PREFIJO_HECHA)).toBeNull();
  });
});

describe("«Mi ruta» monta el mapa del Gestor, no uno suyo", () => {
  const miRuta = leer("src/app/(app)/my-route/page.tsx");

  it("dentro de SoloMisRutas con ESTE chofer, de solo lectura y solo el mapa, en su día", () => {
    const i = miRuta.indexOf("<SoloMisRutas chofer={driverName}>");
    expect(i).toBeGreaterThan(-1);
    const bloque = miRuta.slice(i, miRuta.indexOf("</SoloMisRutas>", i));
    expect(bloque).toContain("<SoloLectura>");
    expect(bloque).toContain("<SoloElMapa dia={dia} ");
    expect(bloque).toContain("<RoutesPage />");
  });

  it("al tocar, traduce el punto con `ordenDelPunto` antes de buscar la parada", () => {
    expect(miRuta).toContain("const orden = ordenDelPunto(id); const d = orden ? stops.find((x) => x.id === orden) : undefined; if (d) setOpen(d);");
  });

  it("y ya no pinta un mapa propio ni traza la ruta por su cuenta", () => {
    expect(miRuta).not.toContain("<MapView");
    expect(miRuta).not.toContain("toggleTrip");
    expect(miRuta).not.toContain('fetch("/api/optimize-route"');
  });
});

describe("en el Gestor, el modo «solo el mapa»", () => {
  const gestor = leer("src/app/(app)/routes/page.tsx");

  it("el día que manda quien lo monta entra COMO fecha elegida, así que pasa por el acotado de D-239", () => {
    const entra = gestor.indexOf("const fechaElegida = soloElMapa ? soloElMapa.dia : fechaDelEstado;");
    const acota = gestor.indexOf("const fecha = fechaElegida < primerDia ? primerDia : fechaElegida > rango.max ? rango.max : fechaElegida;");
    expect(entra).toBeGreaterThan(-1);
    expect(acota).toBeGreaterThan(entra);
  });

  it("devuelve solo la tarjeta del mapa DESPUÉS de todos los hooks, y antes de la página entera", () => {
    const ultimoHook = gestor.indexOf("useMedidaDeRutas<Delivery>({");
    const corte = gestor.indexOf("  if (soloElMapa) {");
    const pagina = gestor.indexOf('      <div className="page-head">');
    expect(ultimoHook).toBeGreaterThan(-1);
    expect(corte).toBeGreaterThan(ultimoHook);
    expect(pagina).toBeGreaterThan(corte);
    // Y es la MISMA tarjeta: los mismos puntos, líneas, tiendas y camiones que la de la página entera.
    const tarjeta = gestor.slice(corte, pagina);
    expect(tarjeta).toContain("<MapView points={points} lines={lines} stores={storeMarkers} liveDrivers={liveDrivers.filter((c) => pasaFiltro(c.driver))}");
    expect(tarjeta).toContain("<MapLegend elementos={leyenda} />");
  });
});
