import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paradasDeLaRuta, textoDeLaParada } from "@/lib/gestor/paradas-numeradas";
import { numerosDelDia } from "@/lib/gestor/numeros-del-dia";
import * as mismaVisita from "@/lib/misma-visita";
import { destinoDeTiendaDe, gruposDeLaVisita, lugarDeLaFila, tiendaDeDestinoDeLaOrden, SIN_DESTINO_DE_TIENDA, type FilaDeVisita } from "@/lib/misma-visita";
import { gruposDeMismoLugar } from "@/lib/lista-unica";
import type { OrderTypeRules } from "@/lib/required";
import type { NamedLocation } from "@/lib/types";

/**
 * La definición de «misma visita»: descarga y carga en la MISMA tienda, seguidas, son UNA parada. El
 * dueño: «en la Intertienda descarga en Pharr y carga en Pharr: es un solo stop, no dos».
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

const TIENDAS = [
  { name: "RDZ Pharr", address: "1 Pharr", lat: 26.19, lng: -98.18 },
  { name: "RDZ McAllen", address: "2 McAllen", lat: 26.2, lng: -98.23 },
  { name: "RDZ Sin Punto", address: "3 Sin", lat: null, lng: null },
] as unknown as NamedLocation[];
const REGLAS = { Intertienda: { storeToStore: true }, Customer: { storeToStore: false } } as unknown as OrderTypeRules;

/** Una orden de cliente recogida en `store`, o una Intertienda de `store` a `delivery_name` (la entrega va a una tienda). */
const orden = (id: string, x: { store?: string; delivery_name?: string | null; delivery_address?: string; order_type?: string; relay_step?: number | null } = {}) => ({
  id, store: x.store ?? "RDZ McAllen", delivery_address: x.delivery_address ?? `${id} Main St`, delivery_name: x.delivery_name ?? null,
  order_type: x.order_type ?? "Customer", relay_step: x.relay_step ?? null,
});
const P = (id: string, tienda: string | null): FilaDeVisita => ({ tipo: "P", ordenes: [id], tienda });
const D = (id: string): FilaDeVisita => ({ tipo: "D", orden: id });
const etiquetas = (filas: FilaDeVisita[]) => filas.map((f, i) => (f.tipo === "P" ? `P${i + 1}` : `D${i + 1}`));
/** Numera con la regla de la lista (lo que pinta el Gestor): las filas, con sus etiquetas, y las órdenes con su destino de tienda. */
const numera = (filas: FilaDeVisita[], ordenes: ReturnType<typeof orden>[]) => paradasDeLaRuta(filas.map((f, i) => (f.tipo === "P"
  ? { tipo: "P" as const, ordenes: f.ordenes, lugar: f.tienda, etiqueta: etiquetas(filas)[i] }
  : { tipo: "D" as const, orden: f.orden, etiqueta: etiquetas(filas)[i] })), ordenes, destinoDeTiendaDe(ordenes, TIENDAS, REGLAS));

describe("tiendaDeDestinoDeLaOrden: ¿la entrega es a una TIENDA? (el mismo criterio que el motor)", () => {
  it("un traslado entre tiendas (Intertienda) cuyo delivery_name nombra una tienda CON punto: esa tienda", () => {
    expect(tiendaDeDestinoDeLaOrden(orden("a", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), TIENDAS, REGLAS)).toBe("RDZ Pharr");
  });
  it("el nombre se compara como el motor: sin mayúsculas ni espacios de más; se devuelve el nombre de Ajustes", () => {
    expect(tiendaDeDestinoDeLaOrden(orden("a", { order_type: "Intertienda", delivery_name: "  rdz PHARR " }), TIENDAS, REGLAS)).toBe("RDZ Pharr");
  });
  it("el tramo entre tiendas de un relevo (relay_step 1) cuenta aunque el tipo sea de cliente; el paso 2 no", () => {
    expect(tiendaDeDestinoDeLaOrden(orden("a", { order_type: "Customer", delivery_name: "RDZ Pharr", relay_step: 1 }), TIENDAS, REGLAS)).toBe("RDZ Pharr");
    expect(tiendaDeDestinoDeLaOrden(orden("a", { order_type: "Customer", delivery_name: "RDZ Pharr", relay_step: 2 }), TIENDAS, REGLAS)).toBeNull();
  });
  it("una orden de CLIENTE cuyo delivery_name es el nombre de una tienda: NO es a tienda (el motor usa su pin)", () => {
    expect(tiendaDeDestinoDeLaOrden(orden("a", { order_type: "Customer", delivery_name: "RDZ Pharr" }), TIENDAS, REGLAS)).toBeNull();
  });
  it("nombre que no coincide con ninguna tienda, o tienda SIN punto (lat/lng nulos): NO es a tienda, no se junta", () => {
    expect(tiendaDeDestinoDeLaOrden(orden("a", { order_type: "Intertienda", delivery_name: "RDZ Nowhere" }), TIENDAS, REGLAS)).toBeNull();
    expect(tiendaDeDestinoDeLaOrden(orden("a", { order_type: "Intertienda", delivery_name: "RDZ Sin Punto" }), TIENDAS, REGLAS)).toBeNull();
    expect(tiendaDeDestinoDeLaOrden(orden("a", { order_type: "Intertienda", delivery_name: null }), TIENDAS, REGLAS)).toBeNull();
  });
});

describe("lugarDeLaFila: cada fila tiene UN lugar", () => {
  const ordenes = [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr", delivery_address: "RDZ Pharr" }), orden("c", { delivery_address: "9 Elm" })];
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const destinoDe = destinoDeTiendaDe(ordenes, TIENDAS, REGLAS);
  it("una recogida: su tienda; una entrega a tienda: la tienda (no su dirección); una entrega de cliente: su dirección", () => {
    expect(lugarDeLaFila(P("c", "RDZ Pharr"), porId, destinoDe)).toBe("T:rdz pharr");
    expect(lugarDeLaFila(D("i"), porId, destinoDe)).toBe("T:rdz pharr");
    expect(lugarDeLaFila(D("c"), porId, destinoDe)).toBe("D:9 elm");
  });
  it("una recogida sin tienda, o una entrega sin dirección, no tiene lugar: va sola", () => {
    expect(lugarDeLaFila(P("c", null), porId, destinoDe)).toBeNull();
    expect(lugarDeLaFila(D("x"), porId, destinoDe)).toBeNull();
  });
});

describe("una visita = descarga y carga en la MISMA tienda, seguidas", () => {
  it("la Intertienda descargada en Pharr y la recogida en Pharr, seguidas: UNA parada, con el número una vez", () => {
    const r = numera([D("i"), P("c", "RDZ Pharr")], [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ Pharr" })]);
    expect(r.deFila).toEqual([1, 1]);
    expect(r.primera).toEqual([true, false]);
    expect(r.paradas).toHaveLength(1);
    expect(r.paradas[0]).toMatchObject({ numero: 1, tipo: "P", lugar: "RDZ Pharr", etiquetas: ["D1", "P2"], ordenesDeEntrega: ["i"] });
  });
  it("el orden de la lista se respeta: si la carga va primero, la parada también empieza por la carga", () => {
    const r = numera([P("c", "RDZ Pharr"), D("i")], [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ Pharr" })]);
    expect(r.deFila).toEqual([1, 1]);
    expect(r.paradas[0]).toMatchObject({ tipo: "P", lugar: "RDZ Pharr", etiquetas: ["P1", "D2"], ordenesDeEntrega: ["i"] });
  });
  it("dos descargas y una carga en la misma tienda: UNA parada", () => {
    const r = numera([D("i1"), D("i2"), P("c", "RDZ Pharr")], [
      orden("i1", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("i2", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ Pharr" }),
    ]);
    expect(r.deFila).toEqual([1, 1, 1]);
    expect(r.paradas).toHaveLength(1);
    expect(r.paradas[0].ordenesDeEntrega).toEqual(["i1", "i2"]);
  });
  it("la misma tienda con OTRO sitio en medio: son dos paradas (la vuelta es otra visita)", () => {
    const r = numera([D("i"), D("c2"), P("c", "RDZ Pharr")], [
      orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ Pharr" }), orden("c2", { delivery_address: "5 Oak" }),
    ]);
    expect(r.deFila).toEqual([1, 2, 3]);
  });
  it("una carga en la tienda, y luego una entrega de cliente, y luego una descarga en esa tienda: tres paradas", () => {
    const r = numera([P("c", "RDZ Pharr"), D("c"), D("i")], [
      orden("c", { store: "RDZ Pharr", delivery_address: "9 Elm" }), orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }),
    ]);
    expect(r.deFila).toEqual([1, 2, 3]);
  });
  it("una descarga en una tienda y la carga en OTRA tienda: dos paradas", () => {
    const r = numera([D("i"), P("c", "RDZ McAllen")], [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ McAllen" })]);
    expect(r.deFila).toEqual([1, 2]);
  });
});

describe("lo que NO se junta", () => {
  it("destino que es tienda con nombre que no coincide: no se junta con la carga en Pharr", () => {
    const r = numera([D("i"), P("c", "RDZ Pharr")], [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Nowhere" }), orden("c", { store: "RDZ Pharr" })]);
    expect(r.deFila).toEqual([1, 2]);
    expect(r.paradas[0].ordenesDeEntrega).toBeUndefined();
  });
  it("tienda de destino SIN punto en Ajustes: no se junta", () => {
    const r = numera([D("i"), P("c", "RDZ Sin Punto")], [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Sin Punto" }), orden("c", { store: "RDZ Sin Punto" })]);
    expect(r.deFila).toEqual([1, 2]);
  });
  it("entregas de CLIENTE seguidas a la misma dirección siguen siendo una parada, como hasta aquí (no es cosa de esta regla)", () => {
    const r = numera([D("a"), D("b")], [orden("a", { delivery_address: "100 Main St" }), orden("b", { delivery_address: " 100 main st " })]);
    expect(r.deFila).toEqual([1, 1]);
  });
  it("dos entregas de clientes distintos seguidas: dos paradas", () => {
    const r = numera([D("a"), D("b")], [orden("a", { delivery_address: "1 A" }), orden("b", { delivery_address: "2 B" })]);
    expect(r.deFila).toEqual([1, 2]);
  });
  it("una descarga a tienda NO se junta con una entrega de cliente en la misma dirección que la tienda", () => {
    const r = numera([D("i"), D("c")], [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr", delivery_address: "1 Pharr" }), orden("c", { delivery_address: "1 Pharr" })]);
    expect(r.deFila).toEqual([1, 2]);
  });
});

describe("hechas y pendientes", () => {
  it("una descarga ya HECHA seguida de la carga PENDIENTE en la misma tienda: la misma parada, con el número", () => {
    const r = numera([D("i"), P("c", "RDZ Pharr")], [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ Pharr" })]);
    expect(r.deFila[0]).toBe(r.deFila[1]);
  });
  it("una carga hecha y la descarga pendiente seguidas: la misma parada", () => {
    const r = numera([P("c", "RDZ Pharr"), D("i")], [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ Pharr" })]);
    expect(r.deFila).toEqual([1, 1]);
  });
  it("lo hecho de en medio entre la descarga y la carga (otro sitio) las separa: dos paradas, como hoy", () => {
    const r = numera([D("i"), D("x"), P("c", "RDZ Pharr")], [
      orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ Pharr" }), orden("x", { delivery_address: "7 Q" }),
    ]);
    expect(r.deFila).toEqual([1, 2, 3]);
  });
});

describe("el texto de la parada", () => {
  it("una visita con descarga y carga dice las dos cosas", () => {
    expect(textoDeLaParada({ numero: 3, tipo: "P", etiquetas: ["D2", "P5"] }, [], (en) => en)).toBe("Stop 3 — drop off and pick up D2, P5");
    expect(textoDeLaParada({ numero: 3, tipo: "P", etiquetas: ["D2", "P5"] }, [], (_en, es) => es)).toBe("Parada 3 — entregar y recoger D2, P5");
  });
});

describe("gruposDeMismoLugar (la tabla, el plan y la numeración) usa la misma regla", () => {
  it("con el destino de tienda decidido, la descarga y la carga en la tienda son un grupo", () => {
    const ordenes = [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ Pharr" })];
    expect(gruposDeMismoLugar([D("i"), P("c", "RDZ Pharr")], ordenes, destinoDeTiendaDe(ordenes, TIENDAS, REGLAS))).toEqual([0, 0]);
  });
  it("sin el destino decidido (como antes), la descarga y la carga NO son grupo", () => {
    expect(gruposDeMismoLugar([D("i"), P("c", "RDZ Pharr")], [{ id: "i", delivery_address: "x" }, { id: "c" }])).toEqual([null, null]);
    expect(gruposDeLaVisita([D("i"), P("c", "RDZ Pharr")], [{ id: "i", delivery_address: "x" }, { id: "c" }], SIN_DESTINO_DE_TIENDA)).toEqual([null, null]);
  });
});

describe("cableado: el número, el conteo, «Mi ruta», el mapa y el plan leen la MISMA regla", () => {
  const gestor = plano(leer("src/app/(app)/routes/page.tsx"));
  const miRuta = plano(leer("src/app/(app)/my-route/page.tsx"));
  const mapa = plano(leer("src/lib/mapa-de-rutas.ts"));
  const plan = plano(leer("src/components/RutaDelPlan.tsx"));
  it("la lista (`gruposDeMismoLugar`) delega en `misma-visita`, con el destino que le pasan", () => {
    expect(plano(leer("src/lib/lista-unica.ts"))).toContain("return gruposDeLaVisita(paradas, ordenes, destinoDe);");
  });
  it("el Gestor lee el destino de tienda por id (sin tocar las órdenes) para numerar, agrupar y medir", () => {
    expect(gestor).toContain("const destinoDeTiendaDeLaRuta = useMemo(");
    expect(gestor).toContain("destinoDeTiendaDe(todasLasDelDia, settings.stores ?? [], settings.order_type_rules as OrderTypeRules | undefined)");
    expect(gestor).toContain("diaDeLaRuta(lectura, stops, hechasDe(laneKey), capacityFor(driverOf(laneKey))");
    expect(gestor).toContain("gruposDeMismoLugar(lectura.paradas, stops);");
  });
  it("«Mi ruta» numera con el mismo destino, y su cabecera cuenta sus paradas (`numeradas.paradas`)", () => {
    expect(miRuta).toContain("destinoDeTiendaDe(deliveries, settings.stores ?? [], settings.order_type_rules as OrderTypeRules | undefined)");
    expect(miRuta).toContain("paradasDeLaRutaEnElOrden(lectura.filas.map((f, i) => ({ ...f, etiqueta: etiquetas[i] })), stops, ordenDelDia)");
    expect(miRuta).toContain('{numeradas.paradas.length} {t("stops", "paradas")}');
  });
  it("el mapa pone las entregas de una visita bajo la burbuja de la tienda, con su número, sin pin propio", () => {
    expect(mapa).toContain("for (const id of p.ordenesDeEntrega ?? []) { numeroDe.set(id, [...(numeroDe.get(id) ?? []), p.numero]); dentroDeOtra.add(id); }");
  });
  it("el plan (`RutaDelPlan`) pasa el destino de tienda a su numeración", () => {
    expect(plan).toContain("tiendaDeDestino: tiendaDeDestino?.(p.order_ref) ?? null,");
  });
});

describe("regresión: ninguna ORDEN lleva el destino de tienda (ni una columna que no existe en `deliveries`)", () => {
  it("la API no vuelve a tener `conTiendaDeDestino`, que copiaba cada orden", () => {
    expect("conTiendaDeDestino" in mismaVisita).toBe(false);
  });
  it("numerar y agrupar con el destino de tienda no añade ni cambia ninguna clave de la orden", () => {
    const ordenes = [orden("i", { order_type: "Intertienda", delivery_name: "RDZ Pharr" }), orden("c", { store: "RDZ Pharr" })];
    const antes = ordenes.map((o) => Object.keys(o).sort().join(","));
    const destinoDe = destinoDeTiendaDe(ordenes, TIENDAS, REGLAS);
    expect(destinoDe("i")).toBe("RDZ Pharr");
    const r = numera([D("i"), P("c", "RDZ Pharr")], ordenes);
    expect(r.deFila).toEqual([1, 1]);
    expect(ordenes.map((o) => Object.keys(o).sort().join(","))).toEqual(antes);
    expect(ordenes.every((o) => !("tiendaDeDestino" in o))).toBe(true);
  });
  it("numerosDelDia con el destino de tienda deja las órdenes intactas", () => {
    const ordenes = [
      { id: "i", store: "RDZ McAllen", delivery_address: "x", pickup_name: null, delivery_name: "RDZ Pharr", order_type: "Intertienda", relay_step: null },
      { id: "c", store: "RDZ Pharr", delivery_address: "y", pickup_name: null, delivery_name: null, order_type: "Customer", relay_step: null },
    ];
    const copia = JSON.stringify(ordenes);
    const pintadas = [
      { fila: { tipo: "D" as const, orden: "i", etiqueta: "", cambio: null, indice: 0, otraCarga: false }, tipo: "D" as const, orden: "i", i: 0, hecha: false },
      { fila: { tipo: "P" as const, ordenes: ["c"], lugar: "RDZ Pharr", etiqueta: "", cambio: null, indice: 1 }, tipo: "P" as const, orden: "c", i: 1, hecha: false },
    ];
    const r = numerosDelDia(pintadas as never, "derivada", ordenes, null, destinoDeTiendaDe(ordenes, TIENDAS, REGLAS));
    expect(r.deFila).toEqual([1, 1]);
    expect(JSON.stringify(ordenes)).toBe(copia);
  });
});

describe("regresión: los archivos que escriben órdenes no mencionan el destino de tienda como campo", () => {
  it("routes/page, my-route/page, data-provider y local-data-provider: ni `tiendaDeDestino`", () => {
    for (const f of ["src/app/(app)/routes/page.tsx", "src/app/(app)/my-route/page.tsx", "src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      expect(leer(f), f).not.toMatch(/\btiendaDeDestino\b/);
    }
  });
});
