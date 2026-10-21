import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listaDelDia, marcaDeLaHecha, ordenesDeLaRutaDelDia, pendientesDelDia, recogidaParaElChofer } from "./recogida-y-ruta-del-dia";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";
import { diaDeLaRuta } from "@/lib/gestor/numeros-del-dia";
import { firmaDeLaForma } from "@/lib/usa-medida-de-rutas";
import { carrilesDelDia, lineasDeLasRutas, puntosDeLasRutas, rutasPorChofer } from "@/lib/mapa-de-rutas";

/**
 * D-584 · Dos pedidos del dueño para el chofer (2026-10-18): la recogida en tienda dice la TIENDA y no la dirección; y en
 * el mapa, la entregada conserva su número (apagado) y la línea de la ruta del día se queda aunque esté entregada.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const t = (en: string) => en;
const tiendas = [{ name: "RDZ Pharr" }, { name: "RDZ McAllen" }];

describe("1 · de dónde recoge el chofer: la tienda, o la dirección si no es tienda", () => {
  it("en una tienda de Ajustes: la tienda, sin dirección (aunque la orden la traiga)", () => {
    expect(recogidaParaElChofer({ pickup_name: "RDZ Pharr", pickup_address: "123 Main St" }, tiendas)).toEqual({ enTienda: true, tienda: "RDZ Pharr" });
  });
  it("el nombre se compara sin mayúsculas ni espacios de más, y la tienda sale con su nombre de Ajustes", () => {
    expect(recogidaParaElChofer({ pickup_name: "  rdz mcallen ", pickup_address: "x" }, tiendas)).toEqual({ enTienda: true, tienda: "RDZ McAllen" });
  });
  it("sin `pickup_name`, vale la tienda de la orden (`store`), como el motor de rutas", () => {
    expect(recogidaParaElChofer({ pickup_name: null, store: "RDZ Pharr" }, tiendas)).toEqual({ enTienda: true, tienda: "RDZ Pharr" });
  });
  it("no es tienda (un almacén, un proveedor): su nombre y su dirección", () => {
    expect(recogidaParaElChofer({ pickup_name: "Bodega Reynosa", pickup_address: "Av. Hidalgo 45", store: "RDZ Pharr" }, tiendas))
      .toEqual({ enTienda: false, nombre: "Bodega Reynosa", direccion: "Av. Hidalgo 45" });
  });
  it("sin nombre ni dirección no está en tienda, y lo dice con nulos", () => {
    expect(recogidaParaElChofer({ pickup_name: "", pickup_address: " ", store: null }, tiendas)).toEqual({ enTienda: false, nombre: null, direccion: null });
  });
  it("«Mi ruta» pinta la recogida con esa regla: la tienda resaltada, o la dirección; y la ficha, la tienda en vez de «Dir. Recolección»", () => {
    const miRuta = plano(leer("src/app/(app)/my-route/page.tsx"));
    expect(miRuta).toContain('{f.tipo === "P" ? recogidaEnLaFila(f.ordenes, f.lugar) :');
    expect(miRuta).toContain("const r = d ? recogidaParaElChofer(d, settings.stores ?? []) : null;");
    expect(miRuta).toContain('data-recogida-en-tienda={r.tienda} style={{ background: colorDelChofer, color: "white", verticalAlign: "middle" }}>🏬 {t("Store", "Tienda")} · {r.tienda}</span>');
    expect(miRuta).toContain('{r && <span className="hint" data-direccion-de-recogida style={{ display: "block" }}>{r.direccion ?? t("(no address)", "(sin dirección)")}</span>}');
    const ficha = plano(leer("src/components/OrderModal.tsx"));
    expect(ficha).toContain("const recogida = recogidaParaElChofer(existing ?? d, settings.stores ?? []);");
    expect(ficha).toContain('...(recogida.enTienda ? [[t("Pickup (store)", "Recolección (tienda)"), `🏬 ${recogida.tienda}`]] : [[t("Pickup Address", "Dir. Recolección"), existing.pickup_address || "—"]]),');
  });
});

describe("2 · el pin de lo entregado: su número, apagado", () => {
  it("entregada con número: el número; sin número: el ✓ de antes; recogida y en camino: 🚚", () => {
    expect(marcaDeLaHecha(true, 5)).toBe("5");
    expect(marcaDeLaHecha(true, null)).toBe("✓");
    expect(marcaDeLaHecha(true, undefined)).toBe("✓");
    expect(marcaDeLaHecha(false, 5)).toBe("🚚");
  });
});

// Un día de Ana: recoge dos en Pharr, entrega a y luego b. Dos fotos: nada hecho, y a ya entregada.
const orden = (id: string, stage: string, seq: number, extra: Record<string, unknown> = {}) => ({
  id, order_no: id.charCodeAt(0), order_code: id.toUpperCase(), invoice_num: `INV-${id}`, stage, assigned_driver: "Ana", route_seq: seq,
  delivery_lat: 26.2 + id.charCodeAt(0) / 1000, delivery_lng: -98.2, store: "RDZ Pharr", delivery_address: `${id} Main St`, delivery_date: "2026-10-18", ...extra,
});
const a0 = orden("a", "ready", 0), b0 = orden("b", "ready", 1);
const aHecha = orden("a", "delivered", 0, { pod_delivered_at: "2026-10-18T15:00:00Z" });
type O = typeof a0;
const diaDe = (pendientes: O[], hechas: O[]) => diaDeLaRuta(lecturaConLoHecho(pendientes, 12, null, hechas), pendientes, hechas, 12, null).paradas;

describe("3 · la ruta del día que se mide: lo pendiente con lo hecho donde iba", () => {
  it("la lista del día: la recogida con sus órdenes y su tienda, y una entrega por orden", () => {
    expect(listaDelDia(diaDe([a0, b0], []))).toEqual([
      { tipo: "P", ordenes: ["a", "b"], tienda: "RDZ Pharr" }, { tipo: "D", orden: "a" }, { tipo: "D", orden: "b" },
    ]);
    // Una parada de entrega con dos órdenes (misma dirección) son dos entregas seguidas.
    expect(listaDelDia([{ numero: 1, tipo: "D", filas: [0, 1], etiquetas: ["D1", "D2"], ordenes: ["x", "y"], lugar: null }])).toEqual([{ tipo: "D", orden: "x" }, { tipo: "D", orden: "y" }]);
  });
  it("las órdenes del día: sin repetir, y en el mismo orden esté hecho lo que esté hecho", () => {
    expect(ordenesDeLaRutaDelDia([b0], [aHecha]).map((d) => d.id)).toEqual(["a", "b"]);
    expect(ordenesDeLaRutaDelDia([a0, b0], [a0]).map((d) => d.id)).toEqual(["a", "b"]);
    // D-621: lo recogido (en el camión) sigue pendiente de entregar: se mueve y se mide. Solo lo entregado queda fuera.
    expect(pendientesDelDia([aHecha, b0, orden("c", "picked_up", 2)]).map((d) => d.id)).toEqual(["b", "c"]);
  });
  it("entregar una parada NO cambia la forma de la ruta: la medida y la línea se quedan (antes se tiraban y se medía lo que quedaba)", () => {
    const firma = (pendientes: O[], hechas: O[]) => {
      const delDia = ordenesDeLaRutaDelDia(pendientes, hechas);
      return firmaDeLaForma("2026-10-18", "Ana", delDia, listaDelDia(diaDe(pendientesDelDia(delDia), hechas)), "RDZ Pharr>·");
    };
    const antes = firma([a0, b0], []);
    expect(antes).toContain("Pa+b,Da,Db");
    expect(firma([b0], [aHecha])).toBe(antes);
    expect(firma([], [aHecha, orden("b", "delivered", 1, { pod_delivered_at: "2026-10-18T16:00:00Z" })])).toBe(antes);
    // La forma de VERDAD sí cambia: quitar b de la ruta es otra ruta.
    expect(firma([a0], [])).not.toBe(antes);
  });
  it("una ruta ya terminada (cero pendientes, dos hechas) sigue teniendo línea; una sin nada en el día, no (D-437)", () => {
    const delDia = new Map([["Ana", ordenesDeLaRutaDelDia([], [aHecha, orden("b", "delivered", 1)])], ["Julio", [] as O[]]]);
    const ls = lineasDeLasRutas({
      trazos: { Ana: [{ delivery: [[1, 1], [2, 2]], ret: [] }], Julio: [{ delivery: [[5, 5], [6, 6]], ret: [] }] },
      trazosDelPlan: {}, tieneParadas: (k) => (delDia.get(k)?.length ?? 0) > 0, pasaFiltro: () => true, sigueSuPlan: () => false,
      colorDe: () => "rojo", atenuada: () => false,
    });
    expect(ls.map((l) => l.id)).toEqual(["line:Ana#0"]);
  });
  it("el Gestor (y con él el mapa de «Mi ruta») mide y pinta la ruta del día, no lo pendiente", () => {
    const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
    expect(pagina).toContain("m.set(k, ordenesDeLaRutaDelDia(byDriver.get(k) ?? [], hechasPintadas.get(k) ?? []));");
    expect(pagina).toContain("const seMide = (clave: string) => delDiaDe(clave).length > 0 && pasaFiltro(clave) && (modo === \"dia\" || selected.has(clave));");
    expect(pagina).toContain("date, porChofer: rutaDelDia, rutasAMedir, seMide, listaDe: (clave, delDia) => listaDelDia(diaDe(clave, pendientesDelDia(delDia)).paradas),");
    expect(pagina).toContain("conParadas: lanes.filter((u) => delDiaDe(u.key).length > 0).map((u) => u.key),");
    expect(pagina).toContain("tieneParadas: (clave) => delDiaDe(clave).length > 0,");
    expect(pagina).toContain("const medida = estadoDeLaMedida(u.key, delDiaDe(u.key));");
  });
  it("en el mapa, la entregada lleva su número de parada del día apagado, por la función de verdad", () => {
    const pts = puntosDeLasRutas({
      carriles: carrilesDelDia([{ id: "u-ana", full_name: "Ana" }], [], [b0], ["Ana"]),
      porChofer: rutasPorChofer([b0]), delDia: [b0], hechas: new Map([["Ana", [aHecha]]]),
      pasaFiltro: () => true, soloUnChofer: true, enfocado: false, atenuada: () => false, colorDe: () => "azul", colorSinChofer: "gris",
      baseDe: () => ({ coords: [26.19, -98.18], direccion: "RDZ Pharr" }), paradasDe: (k, s) => diaDe(s, k === "Ana" ? [aHecha] : []),
      coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), t,
    });
    expect(pts.find((p) => p.id === "__hecha__a")).toMatchObject({ badge: "2", dimmed: true });
    expect(pts.find((p) => p.id === "b")).toMatchObject({ badge: "3", dimmed: false });
  });
});
