import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { diaDeLaRuta, numerosDelDia } from "@/lib/gestor/numeros-del-dia";
import { paradasDeLaRuta } from "@/lib/gestor/paradas-numeradas";
import { hechasQueSePintan } from "@/lib/hechas-del-gestor";
import { carrilesDelDia, puntosDeLasRutas, rutasPorChofer } from "@/lib/mapa-de-rutas";
import { routeOrder } from "@/lib/dispatch";
import { paradasDelChofer } from "@/lib/ordenes-del-dia";
import { lecturaDeLaRuta, type ParadaDelPlanMinima } from "@/lib/route-plan/lectura-de-ruta";
import { lecturaConLoHecho } from "@/lib/route-plan/lectura-del-gestor";
import { posicionesDeLaRuta } from "@/lib/route-plan/publicar";
import { todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// D-NEXT · El Gestor de Rutas (y «Ruta de hoy») numera el DÍA ENTERO, como «Mi ruta».
//
// El dueño, 2026-10-11, con la captura del Gestor —«① P1», «② D1», «✓P» sin número, «③ P2», «④ D2», «🚚D» sin número—:
// «when a order is delviered dont take the number of the stop away».
//
// Lo que se mide: la regla (sobre la lista que la tarjeta pinta), que da los MISMOS números que «Mi ruta» con la función de
// «Mi ruta», y LAS PANTALLAS pintadas de verdad —el Gestor y «Mi ruta» del mismo chofer, con los mismos datos— dando el mismo
// número a la misma parada.
// ============================================================

const HOY = todayISO();
const CAP = 12;

type Orden = Delivery & { pickup_seq: number | null };
const orden = (id: string, stage: string, route_seq: number, pickup_seq: number | null, store: string, n: number, extra: Partial<Delivery> = {}): Orden => ({
  id, order_no: n, order_code: id.toUpperCase(), invoice_num: `INV-${id.toUpperCase()}`, assigned_driver: "Ana", stage, delivery_date: HOY,
  route_seq, pickup_seq, store, delivery_address: `${n} Main St, Edinburg`, delivery_windows: null, photos: [], est_pallets: 2,
  delivery_lat: 26.2 + n / 1000, delivery_lng: -98.2, ...extra,
}) as unknown as Orden;

/**
 * El día de Ana a media jornada. Su lista: recoger E y A en Pharr, entregar E y A, recoger B en McAllen y C en Edinburg,
 * entregar C y B. E ya está ENTREGADA; B, RECOGIDA y en el camión; A y C, pendientes.
 *   «Mi ruta»: ① recoger E, A · ② entregar E · ③ A · ④ recoger B · ⑤ recoger C · ⑥ entregar C · ⑦ entregar B.
 *   El Gestor, antes: ✓P · ① P1 · ✓D · ② D1 · ✓P · ③ P2 · ④ D2 · 🚚D — lo hecho sin número y lo pendiente desde 1.
 */
const diaDeAna = (): Orden[] => [
  orden("e", "delivered", 0, -0.5, "RDZ Pharr", 1, { pod_delivered_at: `${HOY}T15:42:00Z` }),
  orden("a", "ready", 1, -0.25, "RDZ Pharr", 2),
  orden("b", "picked_up", 3, 1.5, "RDZ McAllen", 3, { pickup_gps_at: `${HOY}T16:10:00Z` }),
  orden("c", "approved", 2, 1.6, "RDZ Edinburg", 4),
];
const PENDIENTES = new Set(["pending", "approved", "fulfilling", "ready"]);

/** El Gestor, como lo arma la página: `lecturaDe` (lo pendiente) y `diaDe` (con lo hecho de ese día). */
const delGestor = (todas: readonly Orden[], plan: ParadaDelPlanMinima[] | null = null) => {
  const stops = todas.filter((d) => PENDIENTES.has(d.stage));
  const hechas = hechasQueSePintan(todas, HOY, "dia").get("Ana") ?? [];
  const lectura = lecturaConLoHecho(stops, CAP, plan, hechas);
  return { lectura, ...diaDeLaRuta(lectura, stops, hechas, CAP, plan) };
};
/** Cada fila pintada del Gestor, como se lee: «1 ✓P1» la primera de su parada, «│ P2» la que sigue. */
const filasDelGestor = (g: ReturnType<typeof delGestor>) =>
  g.pintadas.map((fp, k) => `${g.primera[k] ? g.deFila[k] : "│"} ${fp.hecha ? (fp.estado === "hecho" ? "✓" : "🚚") : ""}${g.etiqueta[k]}`);
/** «P:a» → su número, en el Gestor. */
const numerosDelGestor = (g: ReturnType<typeof delGestor>) => Object.fromEntries(g.pintadas.flatMap((fp, k) =>
  (fp.hecha ? [fp.orden] : fp.fila.tipo === "P" ? fp.fila.ordenes : [fp.fila.orden]).map((id) => [`${fp.hecha ? fp.tipo : fp.fila.tipo}:${id}`, g.deFila[k]])));

/** «Mi ruta», con SUS funciones (`my-route/page.tsx`): sus paradas del día, `routeOrder`, `lecturaDeLaRuta`, `paradasDeLaRuta`. */
const deMiRuta = (todas: readonly Orden[], plan: ParadaDelPlanMinima[] | null = null) => {
  const stops = routeOrder(paradasDelChofer(todas as Delivery[], "Ana", HOY, "dia"));
  const lectura = lecturaDeLaRuta(stops, CAP, plan);
  const n = paradasDeLaRuta(lectura.filas, stops);
  const numeros = Object.fromEntries(lectura.filas.flatMap((f, i) => (f.tipo === "P" ? f.ordenes : [f.orden]).map((id) => [`${f.tipo}:${id}`, n.deFila[i]])));
  const etiquetas = Object.fromEntries(lectura.filas.flatMap((f) => (f.tipo === "P" ? f.ordenes : [f.orden]).map((id) => [`${f.tipo}:${id}`, f.etiqueta])));
  return { numeros, etiquetas };
};
const etiquetasDelGestor = (g: ReturnType<typeof delGestor>) => Object.fromEntries(g.pintadas.flatMap((fp, k) =>
  (fp.hecha ? [fp.orden] : fp.fila.tipo === "P" ? fp.fila.ordenes : [fp.fila.orden]).map((id) => [`${fp.hecha ? fp.tipo : fp.fila.tipo}:${id}`, g.etiqueta[k]])));

describe("la regla: el Gestor numera la lista que pinta, lo hecho incluido", () => {
  it("el caso del dueño: lo hecho conserva su número y lo pendiente no vuelve a contar desde 1", () => {
    expect(filasDelGestor(delGestor(diaDeAna()))).toEqual(["1 ✓P1", "│ P2", "2 ✓D1", "3 D2", "4 ✓P3", "5 P4", "6 D4", "7 🚚D3"]);
  });
  it("las etiquetas P/D también son del día: sin plan, numeradas con lo hecho dentro (D-334 sobre el día entero)", () => {
    const g = delGestor(diaDeAna());
    // La lectura de lo pendiente sigue diciendo P1/D1 y P2/D2 —es la que mueven las flechas—; la fila pinta la del día.
    expect(g.lectura.filas.map((f) => f.etiqueta)).toEqual(["P1", "D1", "P2", "D2"]);
    expect(g.etiquetaDePendiente).toEqual(["P2", "D2", "P4", "D4"]);
    expect(etiquetasDelGestor(g)).toEqual({ "P:e": "P1", "P:a": "P2", "D:e": "D1", "D:a": "D2", "P:b": "P3", "P:c": "P4", "D:c": "D4", "D:b": "D3" });
  });
  it("una recogida hecha y otra pendiente seguidas en la misma tienda son la MISMA parada: el número en la primera, la raya en la otra", () => {
    const g = delGestor(diaDeAna());
    expect([g.deFila[0], g.deFila[1]]).toEqual([1, 1]);
    expect([g.primera[0], g.primera[1]]).toEqual([true, false]);
    expect(g.paradas[0]).toMatchObject({ numero: 1, tipo: "P", ordenes: ["e", "a"], lugar: "RDZ Pharr", etiquetas: ["P1", "P2"] });
  });
  it("el número de cada fila PENDIENTE (mapa y horario) es el del día, con su índice de la lectura", () => {
    expect(delGestor(diaDeAna()).dePendiente).toEqual([1, 3, 5, 6]);
  });
  it("«N paradas» de la cabecera: las que aún tienen algo pendiente (1, 3, 5 y 6), no las siete del día", () => {
    expect(delGestor(diaDeAna()).quedan).toBe(4);
  });
  it("lo hecho sigue sin índice: nada lo mueve, y lo pendiente es la lectura de siempre, en su orden", () => {
    const g = delGestor(diaDeAna());
    expect(g.pintadas.filter((fp) => !fp.hecha).map((fp) => (fp.hecha ? -1 : fp.i))).toEqual([0, 1, 2, 3]);
    expect(g.lectura.paradas).toHaveLength(4);
  });
  it("sin nada hecho, los números y las etiquetas son los de siempre (D-485)", () => {
    const todas = diaDeAna().map((d) => ({ ...d, stage: "ready" }) as Orden);
    const g = delGestor(todas);
    expect(filasDelGestor(g)).toEqual(["1 P1", "│ P2", "2 D1", "3 D2", "4 P3", "5 P4", "6 D4", "7 D3"]);
    expect(g.pintadas.every((fp) => !fp.hecha)).toBe(true);
  });
  it("dos entregas seguidas a la misma dirección, una ya entregada: la MISMA parada, como en «Mi ruta»", () => {
    // E (entregada) y A (pendiente) van a la misma obra: se para una vez. La dirección de lo hecho cuenta para juntarlas.
    const todas = diaDeAna().map((d) => (d.id === "e" ? ({ ...d, delivery_address: "2 Main St, Edinburg" }) as Orden : d));
    const g = delGestor(todas);
    expect(filasDelGestor(g)).toEqual(["1 ✓P1", "│ P2", "2 ✓D1", "│ D2", "3 ✓P3", "4 P4", "5 D4", "6 🚚D3"]);
    expect(numerosDelGestor(g)).toEqual(deMiRuta(todas).numeros);
  });
  it("todo entregado: la tarjeta sigue numerada, y no queda ninguna parada pendiente", () => {
    const todas = diaDeAna().map((d) => ({ ...d, stage: "delivered" }) as Orden);
    const g = delGestor(todas);
    expect(filasDelGestor(g)).toEqual(["1 ✓P1", "│ ✓P2", "2 ✓D1", "3 ✓D2", "4 ✓P3", "5 ✓P4", "6 ✓D4", "7 ✓D3"]);
    expect(g.quedan).toBe(0);
  });
});

// ------------------------------------------------------------
// Con plan publicado: las etiquetas son las del plan, también las de lo hecho.
// ------------------------------------------------------------
/** El plan de la misma lista, con etiquetas que la regla derivada NO daría (para ver que salen del plan). */
const SECUENCIA: { kind: "P" | "D"; id: string; label: string; place?: string }[] = [
  // El sitio, como lo escribe el plan (no como lo dice la orden): con plan, el Gestor y «Mi ruta» leen el del plan.
  { kind: "P", id: "e", label: "P7", place: "Pharr (plan)" }, { kind: "P", id: "a", label: "P8", place: "Pharr (plan)" },
  { kind: "D", id: "e", label: "D7" }, { kind: "D", id: "a", label: "D8" },
  { kind: "P", id: "b", label: "P9", place: "McAllen (plan)" }, { kind: "P", id: "c", label: "P6", place: "Edinburg (plan)" },
  { kind: "D", id: "c", label: "D6" }, { kind: "D", id: "b", label: "D9" },
];
const planDeAna = (): ParadaDelPlanMinima[] => {
  let aBordo = 0;
  return SECUENCIA.map((s, seq) => {
    aBordo += s.kind === "P" ? 2 : -2;
    return { kind: s.kind, order_ref: s.id, seq, label: s.label, load_after: aBordo, place: s.place ?? null };
  });
};
/** Las órdenes tal como las dejó publicar ese plan (`posicionesDeLaRuta`, la misma cuenta que publicar). */
const conElPlan = (): Orden[] => {
  const pos = new Map(posicionesDeLaRuta(SECUENCIA.map((s) => ({ tipo: s.kind, orden: s.id }))).map((p) => [p.id, p]));
  return diaDeAna().map((d) => ({ ...d, route_seq: pos.get(d.id)!.route_seq, pickup_seq: pos.get(d.id)!.pickup_seq }) as Orden);
};

describe("con plan publicado", () => {
  it("la ruta sigue el plan aunque haya entregas (un cambio de etapa no es tocarla, D-335) — si no, esto no probaría nada", () => {
    expect(delGestor(conElPlan(), planDeAna()).lectura.fuente).toBe("plan");
  });
  it("lo hecho lleva la etiqueta que le dio el plan, y lo pendiente la suya; los números, los del día", () => {
    expect(filasDelGestor(delGestor(conElPlan(), planDeAna()))).toEqual(["1 ✓P7", "│ P8", "2 ✓D7", "3 D8", "4 ✓P9", "5 P6", "6 D6", "7 🚚D9"]);
  });
});

// ------------------------------------------------------------
// Los MISMOS números que «Mi ruta».
// ------------------------------------------------------------
describe("MISMOS números y etiquetas que «Mi ruta», con la función de «Mi ruta» sobre el día entero", () => {
  const casos: [string, () => Orden[], (() => ParadaDelPlanMinima[]) | null][] = [
    ["sin plan, a media jornada (una entregada, una en camino)", diaDeAna, null],
    ["sin plan, antes de empezar", () => diaDeAna().map((d) => ({ ...d, stage: "ready" }) as Orden), null],
    ["sin plan, al final del día", () => diaDeAna().map((d) => ({ ...d, stage: "delivered" }) as Orden), null],
    ["con plan publicado, a media jornada", conElPlan, planDeAna],
  ];
  for (const [nombre, datos, plan] of casos) {
    it(nombre, () => {
      const g = delGestor(datos(), plan?.() ?? null);
      const m = deMiRuta(datos(), plan?.() ?? null);
      expect(numerosDelGestor(g)).toEqual(m.numeros);
      expect(etiquetasDelGestor(g)).toEqual(m.etiquetas);
    });
  }
});

// ------------------------------------------------------------
// El mapa (el del Gestor, «Ruta de hoy» y «Mi ruta»).
// ------------------------------------------------------------
describe("el mapa numera con las paradas del día", () => {
  const todas = diaDeAna();
  const stops = todas.filter((d) => PENDIENTES.has(d.stage));
  const hechas = hechasQueSePintan(todas, HOY, "dia");
  const puntos = puntosDeLasRutas<Orden>({
    carriles: carrilesDelDia([{ id: "u-ana", full_name: "Ana" }], [], stops, hechas.keys()), porChofer: rutasPorChofer(stops), delDia: stops, hechas,
    pasaFiltro: () => true, soloUnChofer: false, enfocado: false, atenuada: () => false, colorDe: () => "rojo", colorSinChofer: "gris",
    baseDe: () => ({ coords: [26.19, -98.18], direccion: "RDZ Pharr" }),
    paradasDe: (k, s) => diaDeLaRuta(lecturaConLoHecho(s, CAP, null, hechas.get(k) ?? []), s, hechas.get(k) ?? [], CAP, null).paradas,
    coordsDeTienda: () => ({ lat: 26.19, lng: -98.18 }), t: (en: string) => en,
  });
  const de = (id: string) => puntos.find((p) => p.id === id);
  it("la burbuja de una entrega pendiente lleva su número del día, no el de lo que queda", () => {
    expect(de("a")).toMatchObject({ badge: "3" });
    expect(de("c")).toMatchObject({ badge: "6" });
    expect(de("a")!.label).toBe("Stop 3 — deliver D2 · INV-A — Ana");
  });
  it("una tienda donde ya se recogió todo no lleva burbuja; la que aún tiene algo que recoger, sí, con su número", () => {
    expect(puntos.filter((p) => p.id.startsWith("__parada__Ana__")).map((p) => p.badge)).toEqual(["1", "5"]);
    // La parada 1 junta lo ya recogido (E) y lo que falta (A): su rótulo dice las dos.
    expect(de("__parada__Ana__1")!.label).toBe("Stop 1 — pick up P1, P2 · INV-E, INV-A — Ana · RDZ Pharr");
  });
  it("lo entregado y lo que va en camino conservan su número en el rótulo (la marca sigue siendo ✓ / 🚚)", () => {
    expect(de("__hecha__e")).toMatchObject({ badge: "✓" });
    expect(de("__hecha__e")!.label).toContain("(Stop 2 · Delivered ");
    expect(de("__hecha__b")).toMatchObject({ badge: "🚚" });
    expect(de("__hecha__b")!.label).toContain("(Stop 7 · On its way)");
  });
});

// ------------------------------------------------------------
// LAS PANTALLAS, pintadas: el Gestor («Ruta de hoy» y el de logística) y «Mi ruta» del mismo chofer, con los mismos datos.
// ------------------------------------------------------------
const estado = vi.hoisted(() => ({
  me: null as null | { id: string; role: string; full_name: string },
  deliveries: [] as unknown[],
  paradas: [] as unknown[],
  mapa: null as null | { points: { id: string; label: string; badge?: string }[] },
}));
vi.mock("@/lib/data-provider", () => ({
  useData: () => ({
    me: estado.me, realRole: estado.me?.role ?? null, users: [{ id: "u-ana", role: "driver", full_name: "Ana" }], deliveries: estado.deliveries, events: [],
    settings: { stores: [], driver_capacity: {}, default_truck_capacity: 12, driver_colors: {}, route_buckets: [] },
    driverLocations: [], shifts: [], availability: [], incidents: [], ready: true, teaching: false,
    setStage: async () => true, updateDelivery: async () => true, notify: () => {}, saveSettings: async () => true,
    reorderStops: async () => true, partirCarga: async () => true, reparteCargas: async () => true, juntarCargas: async () => true,
    addNote: async () => true, addIncident: async () => true, removeIncident: async () => true, marcarParada: async () => true, pushNotifs: async () => {},
  }),
}));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));
vi.mock("@/lib/confirm", () => ({ useConfirm: () => async () => true }));
vi.mock("@/lib/usa-rutas-del-dia", () => ({ useRutasDelDia: () => ({ paradas: estado.paradas, origen: "funcion" }) }));
vi.mock("@/lib/route-plan/usePlanPublicado", () => ({ usePlanPublicadoDelGestor: () => null, usePlanPublicadoDelChofer: () => null }));
vi.mock("@/components/MapView", () => ({
  MapView: (p: { points: { id: string; label: string; badge?: string }[] }) => { estado.mapa = p; return createElement("div", { "data-mapa": "1" }); },
}));
vi.mock("@/components/OrderModalLazy", () => ({ OrderModal: () => null }));
vi.mock("@/components/LeaveAtStore", () => ({ LeaveAtStore: () => null }));
vi.mock("@/lib/useStoreMarkers", () => ({ useStoreMarkers: () => [] }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
// Al pintar en el servidor no hay clic. Las tarjetas nacen plegadas en «Ancho» (D-393) y compactas en «Cuadrícula» (D-526,
// el modo de partida): se pintan como tras pulsar ▸ o el nombre del chofer, que despliega su tabla abajo.
vi.mock("@/lib/vista-del-gestor", async (original) => ({ ...(await original<typeof import("@/lib/vista-del-gestor")>()), estaPlegada: () => false }));
vi.mock("@/lib/gestor/cuadricula", async (original) => ({
  ...(await original<typeof import("@/lib/gestor/cuadricula")>()), desplegadaVigente: (_actual: string | null, rutas: readonly string[]) => rutas[0] ?? null,
}));
vi.mock("@/lib/usePausasDelChofer", () => ({
  usePausasDelChofer: () => ({ pausas: [], estado: "lista", empezar: async () => ({ ok: true }), seguir: async () => ({ ok: true }), ubicarTarde: async () => {} }),
}));

const GERENTE = { id: "u-ger", role: "manager", full_name: "Gaby Gerente" };
const ADMIN = { id: "u-adm", role: "admin", full_name: "Ada Admin" };
const ANA = { id: "u-ana", role: "driver", full_name: "Ana" };
const comoParadaDelDia = (d: Orden) => ({
  id: d.id, order_no: d.order_no, order_code: d.order_code, order_suffix: null, stage: d.stage, assigned_driver: d.assigned_driver,
  route_seq: d.route_seq, pickup_seq: d.pickup_seq, load_no: null, actual_pallets: null, est_pallets: d.est_pallets, store: d.store,
  store_lat: null, store_lng: null, delivery_lat: d.delivery_lat, delivery_lng: d.delivery_lng, delivery_city: "Edinburg",
  delivery_windows: null, delivery_date: d.delivery_date, delivery_duration: null, pickup_duration: null,
  pod_delivered_at: d.pod_delivered_at ?? null, pickup_gps_at: d.pickup_gps_at ?? null,
});

beforeEach(() => {
  estado.deliveries = diaDeAna();
  estado.paradas = diaDeAna().map(comoParadaDelDia);
  estado.mapa = null;
});

const pintaElGestor = async (soloLectura: boolean) => {
  const { default: RoutesPage } = await import("@/app/(app)/routes/page");
  const { SoloLectura } = await import("@/lib/gestor/solo-lectura");
  const pagina = createElement(RoutesPage);
  return renderToStaticMarkup(soloLectura ? createElement(SoloLectura, null, pagina) : pagina);
};
const pintaMiRuta = async () => {
  const { default: MyRoutePage } = await import("@/app/(app)/my-route/page");
  return renderToStaticMarkup(createElement(MyRoutePage));
};
const NUMERO = /data-(numero-de-parada|sigue-la-parada)="(\d+)"/;
/** Las filas de la tabla de paradas del Gestor: «1 ✓P1» / «│ P2», y de qué orden y qué es cada una. */
const tablaDelGestor = (html: string) => [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((tr) => NUMERO.test(tr)).map((tr) => {
  const [, cual, n] = tr.match(NUMERO)!;
  const celda = tr.match(/<td\b[^>]*>([\s\S]*?)<\/td>/)![1].replace(/<span class="numero-de-parada[^"]*"[^>]*>[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "");
  const tipo = /data-hecha-tipo="P"|data-recogida=/.test(tr) ? "P" : "D";
  const id = tr.match(/INV-([A-Z])/)![1].toLowerCase();
  return { texto: `${cual === "numero-de-parada" ? n : "│"} ${celda}`, clave: `${tipo}:${id}`, n: Number(n) };
});
/** Las filas de «Mi ruta» (las dos listas, Pendientes y Entregadas): de qué orden(es), qué es, y su número de parada. */
const listaDeMiRuta = (html: string) => html.split('<div class="acct-row"').slice(1).filter((x) => x.includes("data-fila-de-ruta=")).flatMap((fila) => {
  const n = Number(fila.match(NUMERO)![2]);
  const entrega = fila.match(/^[^>]*data-entrega="([^"]+)"/);
  if (entrega) return [{ clave: `D:${entrega[1]}`, n }];
  return [...fila.matchAll(/data-recogida="([^"]+)"/g)].map((m) => ({ clave: `P:${m[1]}`, n }));
});

describe("las pantallas pintadas: el mismo número a la misma parada", () => {
  it("«Ruta de hoy» (el Gestor en solo lectura): «1 ✓P1 · │ P2 · 2 ✓D1 · 3 D2 · 4 ✓P3 · 5 P4 · 6 D4 · 7 🚚D3»", async () => {
    estado.me = GERENTE;
    const html = await pintaElGestor(true);
    expect(tablaDelGestor(html).map((f) => f.texto)).toEqual(["1 ✓P1", "│ P2", "2 ✓D1", "3 D2", "4 ✓P3", "5 P4", "6 D4", "7 🚚D3"]);
    // El círculo de lo ya hecho, apagado (como en «Mi ruta»); el de lo que va en camino —aún por entregar—, no.
    const circulo = (n: number) => html.match(new RegExp(`data-numero-de-parada="${n}"[^>]*style="([^"]*)"`))![1];
    expect(circulo(2)).toContain("opacity:0.55");
    expect(circulo(7)).not.toContain("opacity");
    expect(circulo(3)).not.toContain("opacity");
    // La cabecera: las paradas que aún tienen algo pendiente.
    expect(html).toMatch(/data-totales-de-la-lista[^>]*>4 stops ·/);
  }, 60_000);
  it("el Gestor de logística (con acciones): los mismos números, y lo hecho sigue sin flechas ni arrastre", async () => {
    estado.me = ADMIN;
    const html = await pintaElGestor(false);
    expect(tablaDelGestor(html).map((f) => f.texto)).toEqual(["1 ✓P1", "│ P2", "2 ✓D1", "3 D2", "4 ✓P3", "5 P4", "6 D4", "7 🚚D3"]);
    for (const tr of [...html.matchAll(/<tr\b[^>]*data-hecha=[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0])) {
      expect(tr).not.toContain("data-sube-parada");
      expect(tr).not.toContain("data-fila-arrastrable");
    }
    expect((html.match(/data-sube-parada/g) ?? []).length).toBe(4);
  }, 60_000);
  it("«Mi ruta» de Ana, pintada, da a cada parada el MISMO número que el Gestor", async () => {
    estado.me = GERENTE;
    const gestor = Object.fromEntries(tablaDelGestor(await pintaElGestor(true)).map((f) => [f.clave, f.n]));
    estado.me = ANA;
    const miRuta = Object.fromEntries(listaDeMiRuta(await pintaMiRuta()).map((f) => [f.clave, f.n]));
    expect(Object.keys(miRuta).sort()).toEqual(["D:a", "D:b", "D:c", "D:e", "P:a", "P:b", "P:c", "P:e"]);
    expect(gestor).toEqual(miRuta);
    expect(miRuta).toEqual({ "P:e": 1, "P:a": 1, "D:e": 2, "D:a": 3, "P:b": 4, "P:c": 5, "D:c": 6, "D:b": 7 });
  }, 60_000);
  it("y el mapa de «Mi ruta» —el del Gestor, D-514— dice los números de su lista, no los de lo que queda", async () => {
    estado.me = ANA;
    await pintaMiRuta();
    const pins = estado.mapa?.points ?? [];
    expect(pins.find((p) => p.id === "a")).toMatchObject({ badge: "3" });
    expect(pins.find((p) => p.id === "c")).toMatchObject({ badge: "6" });
    expect(pins.find((p) => p.id === "__hecha__b")!.label).toContain("(Stop 7 · On its way)");
  }, 60_000);
});

// ------------------------------------------------------------
// Quien llama: la página usa la numeración del día en la tabla, el mapa, el horario y los avisos.
// ------------------------------------------------------------
describe("la página del Gestor usa `diaDe` en todo lo que dice un número o una etiqueta", () => {
  const plano = (s: string) => s.split("\r\n").join("\n").replace(/\s+/g, " ");
  const gestor = plano(readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8"));
  it("`diaDe` es `diaDeLaRuta` con lo hecho PINTADO de esa ruta, su camión y su plan", () => {
    expect(gestor).toContain("const diaDe = (laneKey: string, stops: Delivery[], lectura: LecturaDeRuta = lecturaDe(laneKey, stops)) => diaDeLaRuta(lectura, stops, hechasDe(laneKey), capacityFor(driverOf(laneKey)), paradasPublicadasDe(laneKey));");
  });
  it("los avisos de mover dicen la etiqueta del día (la que pinta la fila)", () => {
    expect(gestor).toContain("return fi < 0 ? \"\" : diaDe(laneKey, stops, lectura).etiquetaDePendiente[fi] ?? \"\";");
    expect(gestor).toContain("const etiquetaDe = (i: number) => etiquetaDelDia(laneKey, stops, lectura, (f) => f.indice === i);");
    expect(gestor).toContain("const etiqueta = etiquetaDelDia(a.ruta, stops, lectura, (f) => f.indice === a.indice);");
    expect(gestor).toContain("const d = etiquetaDelDia(laneKey, stops, lectura, (f) => f.tipo === \"D\" && f.orden === orden);");
  });
});

it("numerosDelDia sin filas no inventa paradas", () => {
  expect(numerosDelDia([], "derivada", [], null)).toEqual({ deFila: [], primera: [], etiqueta: [], paradas: [], dePendiente: [], etiquetaDePendiente: [], quedan: 0 });
});
