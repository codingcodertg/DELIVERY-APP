import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { esMiRuta, soloLoMioPorChofer, soloMisCarriles, soloMisOrdenes } from "@/lib/gestor/mis-rutas";
import { alternaVisible, marcadosVigentes, pasaElFiltro, rutasVisibles } from "@/lib/gestor/filtro-de-choferes";
import { todayISO } from "@/lib/utils";
import type { ParadaDelDia } from "@/lib/rutas-del-dia";
import type { Delivery } from "@/lib/types";

// ============================================================
// «🗺 El mapa de mi ruta» (D-506). El dueño, 2026-10-09 (dictado, literal): «drivers view needs to look like to logistic
// manager view with the routes and everything the map view i mean change it and updat eit» y, preguntado por la pantalla y
// el alcance: «quiero que el chofer mire el mapa con sus rutas asi como el logistic manager ese mismo mapa».
//
// Lo que estas pruebas miden: las reglas sueltas de «qué rutas son mías», y LA PANTALLA DE VERDAD pintada con ellas —la
// página del Gestor, la misma que ve el gerente— comprobando que el chofer ve la suya y que la del compañero no está, aunque
// su orden esté cargada en la sesión. El control es la misma página sin acotar («Ruta de hoy»), que sí la enseña: sin él,
// esta prueba pasaría igual con una pantalla que no pintara nada.
// ============================================================

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

const HOY = todayISO();
const AHORA = Date.now();
const haceMin = (m: number) => new Date(AHORA - m * 60_000).toISOString();

const estado = vi.hoisted(() => ({
  me: null as null | { id: string; role: string; full_name: string },
  users: [] as unknown[],
  deliveries: [] as unknown[],
  paradas: [] as unknown[],
  driverLocations: [] as unknown[],
  shifts: [] as unknown[],
  mapa: null as null | { liveDrivers: { driver: string }[]; points: { id: string; label: string }[] },
}));

vi.mock("@/lib/data-provider", () => ({
  useData: () => ({
    me: estado.me, realRole: estado.me?.role ?? null, users: estado.users, deliveries: estado.deliveries, events: [],
    settings: { stores: [], driver_capacity: {}, default_truck_capacity: 12, driver_colors: {}, route_buckets: ["Ruta 1"] },
    driverLocations: estado.driverLocations, shifts: estado.shifts, availability: [], incidents: [], ready: true, teaching: false,
    setStage: async () => true, updateDelivery: async () => true, notify: () => {}, saveSettings: async () => true,
    reorderStops: async () => true, partirCarga: async () => true, reparteCargas: async () => true, juntarCargas: async () => true,
    addNote: async () => true, addIncident: async () => true, removeIncident: async () => true,
  }),
}));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));
vi.mock("@/lib/confirm", () => ({ useConfirm: () => async () => true }));
// La función `rutas_del_dia` devuelve las rutas ENTERAS del día (D-467): el gancho de verdad las pide en un efecto, que no
// corre al pintar en el servidor. Aquí se entregan ya leídas, que es el caso que importa: la pantalla las tiene TODAS.
vi.mock("@/lib/usa-rutas-del-dia", () => ({ useRutasDelDia: () => ({ paradas: estado.paradas, origen: "funcion" }) }));
vi.mock("@/components/MapView", () => ({
  MapView: (p: { liveDrivers: { driver: string }[]; points: { id: string; label: string }[] }) => { estado.mapa = p; return createElement("div", { "data-mapa": "1" }); },
}));
vi.mock("@/components/OrderModalLazy", () => ({ OrderModal: () => null }));
vi.mock("@/lib/useStoreMarkers", () => ({ useStoreMarkers: () => [] }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const CARLOS = { id: "u-carlos", role: "driver", full_name: "Carlos R." };
const MIGUEL = { id: "u-miguel", role: "driver", full_name: "Miguel A." };
const GERENTE = { id: "u-ger", role: "manager", full_name: "Gaby Gerente" };

const parada = (x: Partial<ParadaDelDia> & { id: string }): ParadaDelDia => ({
  order_no: 1, order_code: null, order_suffix: null, stage: "approved", assigned_driver: null, route_seq: 0, pickup_seq: null, load_no: null,
  actual_pallets: null, est_pallets: 2, store: "RDZ Pharr", store_lat: 26.19, store_lng: -98.18, delivery_lat: 26.3, delivery_lng: -98.2,
  delivery_city: "Edinburg", delivery_windows: null, delivery_date: HOY, delivery_duration: null, pickup_duration: null,
  pod_delivered_at: null, pickup_gps_at: null, ...x,
});
const orden = (id: string, chofer: string, factura: string): Delivery => ({
  id, order_no: 1, order_code: id, invoice_num: factura, assigned_driver: chofer, stage: "approved", delivery_date: HOY,
  delivery_address: `${id} Main St, Edinburg`, delivery_windows: null, store: "RDZ Pharr", photos: [],
  delivery_lat: 26.3, delivery_lng: -98.2, route_seq: 0, est_pallets: 2,
}) as unknown as Delivery;

beforeEach(() => {
  estado.users = [CARLOS, MIGUEL, GERENTE];
  // LAS DOS órdenes cargadas en la sesión, a propósito: lo que se mide es que la PANTALLA no enseña la de Miguel, no que la
  // base no se la haya dado. Un chofer que por RLS solo lee la suya pasaría esta prueba sin que la pantalla filtrara nada.
  estado.deliveries = [orden("c1", "Carlos R.", "INV-C1"), orden("m1", "Miguel A.", "INV-M1")];
  estado.paradas = [
    parada({ id: "c1", order_code: "c1", assigned_driver: "Carlos R." }),
    parada({ id: "m1", order_code: "m1", assigned_driver: "Miguel A.", route_seq: 1 }),
  ];
  // Los dos en turno desde hace una hora y con su último punto hace 40 min: los dos salen «en vivo» en el mapa (el corte son
  // 60 min) y los dos son un hueco de rastreo (el corte son 15).
  estado.driverLocations = [
    { driver_id: "u-carlos", lat: 26.2, lng: -98.2, accuracy_m: 10, recorded_at: haceMin(40) },
    { driver_id: "u-miguel", lat: 26.1, lng: -98.1, accuracy_m: 10, recorded_at: haceMin(40) },
  ];
  estado.shifts = [
    { id: "s1", driver_id: "u-carlos", started_at: haceMin(60), ended_at: null },
    { id: "s2", driver_id: "u-miguel", started_at: haceMin(60), ended_at: null },
  ];
  estado.mapa = null;
});

describe("qué rutas son mías", () => {
  it("la mía es la que lleva exactamente mi nombre; la de otro, lo sin chofer y una ruta temporal no lo son", () => {
    expect(esMiRuta("Carlos R.", "Carlos R.")).toBe(true);
    expect(esMiRuta("Carlos R.", "Miguel A.")).toBe(false);
    expect(esMiRuta("Carlos R.", null)).toBe(false);
    expect(esMiRuta("Carlos R.", undefined)).toBe(false);
    expect(esMiRuta("Carlos R.", "Ruta 1")).toBe(false);
    // La misma igualdad exacta que `paradasDelChofer` usa en «Mi ruta»: si una comparara normalizando y la otra no, la lista
    // y el mapa del mismo chofer podrían no coincidir.
    expect(esMiRuta("Carlos R.", " Carlos R. ")).toBe(false);
    expect(esMiRuta("Carlos R.", "carlos r.")).toBe(false);
  });
  it("sin nombre se acota a NADA, nunca a todas: es el lado seguro", () => {
    for (const sinNombre of [null, undefined, "", "   "]) {
      expect(esMiRuta(sinNombre, "Carlos R."), String(sinNombre)).toBe(false);
      expect(esMiRuta(sinNombre, null), String(sinNombre)).toBe(false);
      expect(soloMisOrdenes([{ assigned_driver: "Carlos R." }], sinNombre), String(sinNombre)).toEqual([]);
      expect(soloMisCarriles([{ key: "Carlos R." }], sinNombre), String(sinNombre)).toEqual([]);
      expect(soloLoMioPorChofer([{ driver: "Carlos R." }], sinNombre), String(sinNombre)).toEqual([]);
    }
  });
  it("mis órdenes, mi carril y lo rotulado con mi nombre: solo lo mío", () => {
    const ordenes = [{ id: "c1", assigned_driver: "Carlos R." }, { id: "m1", assigned_driver: "Miguel A." }, { id: "x", assigned_driver: null }];
    expect(soloMisOrdenes(ordenes, "Carlos R.").map((d) => d.id)).toEqual(["c1"]);
    const carriles = [{ key: "Carlos R." }, { key: "Miguel A." }, { key: "Ruta 1" }];
    expect(soloMisCarriles(carriles, "Carlos R.").map((l) => l.key)).toEqual(["Carlos R."]);
    const camiones = [{ driver: "Carlos R." }, { driver: "Miguel A." }];
    expect(soloLoMioPorChofer(camiones, "Carlos R.").map((c) => c.driver)).toEqual(["Carlos R."]);
    // Y lo mismo sirve para el aviso de rastreo, que llega con la misma forma (`TrackingGap`).
    const huecos = [{ driver: "Carlos R.", quietForMin: 40 }, { driver: "Miguel A.", quietForMin: 40 }];
    expect(soloLoMioPorChofer(huecos, "Carlos R.")).toEqual([{ driver: "Carlos R.", quietForMin: 40 }]);
  });
  it("el acotado no se puede deshacer con el filtro de casillas: lo que no está en la lista no vuelve", () => {
    // El filtro del panel (D-481/D-488) decide entre lo que la pantalla TIENE. Acotada, lo único que tiene es su carril: ni
    // desmarcando, ni marcando a mano otro nombre, aparece una ruta ajena, porque no hay ninguna que marcar.
    const carriles = soloMisCarriles([{ key: "Carlos R." }, { key: "Miguel A." }], "Carlos R.").map((l) => l.key);
    expect(carriles).toEqual(["Carlos R."]);
    expect([...rutasVisibles(new Set(), carriles)]).toEqual(["Carlos R."]);
    // Alguien que se inventara «Miguel A.» en lo guardado: `marcadosVigentes` lo descarta por no estar en pantalla, y aun
    // tomándolo en crudo el filtro solo puede ESCONDER —nunca traer la orden de Miguel, que no está en la lista—.
    expect(marcadosVigentes(new Set(["Miguel A."]), carriles).size).toBe(0);
    expect(pasaElFiltro(new Set(["Miguel A."]), "Miguel A.")).toBe(true);
    expect(soloMisOrdenes([{ assigned_driver: "Miguel A." }], "Carlos R.")).toEqual([]);
    // Y desmarcar la suya solo esconde la suya.
    expect(rutasVisibles(alternaVisible(new Set(), carriles, "Carlos R."), carriles).size).toBe(0);
  });
});

// ------------------------------------------------------------
// La pantalla, pintada: la página del Gestor, la misma que ve el gerente.
// ------------------------------------------------------------
const pinta = async (chofer: string | null, conSoloLectura = true) => {
  const { default: RoutesPage } = await import("@/app/(app)/routes/page");
  const { SoloLectura } = await import("@/lib/gestor/solo-lectura");
  const { SoloMisRutas } = await import("@/lib/gestor/solo-mis-rutas");
  const pagina = createElement(RoutesPage);
  const dentro = conSoloLectura ? createElement(SoloLectura, null, pagina) : pagina;
  return renderToStaticMarkup(chofer == null ? dentro : createElement(SoloMisRutas, { chofer }, dentro));
};
const rutasDelPanel = (html: string) => [...html.matchAll(/data-ruta-del-panel="([^"]*)"/g)].map((m) => m[1]);
/** Las paradas que el mapa recibe, por orden: es el mapa lo que el dueño pidió, y cada pin nombra su factura (D-481, a). */
const paradasDelMapa = () => (estado.mapa?.points ?? []).filter((p) => !p.id.startsWith("__")).map((p) => `${p.id}:${p.label}`);

describe("la pantalla: el chofer ve EL MISMO mapa del Gestor, con sus rutas", () => {
  it("control — sin acotar («Ruta de hoy») la misma página enseña las rutas de los DOS", async () => {
    estado.me = GERENTE;
    const html = await pinta(null);
    expect(paradasDelMapa().sort()).toEqual(["c1:Stop 2 — deliver D1 · INV-C1 — Carlos R.", "m1:Stop 2 — deliver D1 · INV-M1 — Miguel A."]);
    expect(rutasDelPanel(html).sort()).toEqual(["Carlos R.", "Miguel A.", "Ruta 1"]);
    expect(estado.mapa?.liveDrivers.map((l) => l.driver).sort()).toEqual(["Carlos R.", "Miguel A."]);
    expect(html).toContain("Miguel A.");
  }, 60_000);

  it("acotada a Carlos: su parada en el mapa; la de Miguel no está, y su orden SÍ estaba cargada", async () => {
    estado.me = CARLOS;
    const html = await pinta("Carlos R.");
    expect(paradasDelMapa()).toEqual(["c1:Stop 2 — deliver D1 · INV-C1 — Carlos R."]);
    expect(estado.deliveries.map((d) => (d as Delivery).invoice_num)).toContain("INV-M1");   // estaba ahí, y no se pintó
    expect(html).toContain("Carlos R.");
    expect(html).not.toContain("INV-M1");
    expect(html).not.toContain("Miguel A.");
  }, 60_000);

  it("en el panel «Choferes y rutas» hay UNA ruta —la suya— así que no hay otra que marcar", async () => {
    estado.me = CARLOS;
    const html = await pinta("Carlos R.");
    expect(rutasDelPanel(html)).toEqual(["Carlos R."]);
    // Ni los demás choferes, ni la ruta temporal «Ruta 1», que `rutasConOrdenes` deja en el panel aunque esté vacía.
    expect(html).not.toContain("Ruta 1");
  }, 60_000);

  it("en el mapa sale SU camión, no el de su compañero", async () => {
    estado.me = CARLOS;
    await pinta("Carlos R.");
    expect(estado.mapa?.liveDrivers.map((l) => l.driver)).toEqual(["Carlos R."]);
  }, 60_000);

  it("y es de solo lectura por ser acotada: nada de armar rutas, tablero, incidencias ni botones de la ruta", async () => {
    estado.me = CARLOS;
    const html = await pinta("Carlos R.");
    expect(html).toContain("data-solo-lectura");
    for (const accion of ["data-armar-rutas", 'data-pestana="board"', "data-abrir-incidencias", "data-acciones-de-la-ruta", "data-recuadro-de-reparto", "data-marca-todas"]) {
      expect(html, accion).not.toContain(accion);
    }
  }, 60_000);

  it("acotada SIN `<SoloLectura>` sigue siendo de solo lectura: lo decide el acotado, no quien la monta", async () => {
    estado.me = CARLOS;
    const html = await pinta("Carlos R.", false);
    expect(html).toContain("data-solo-lectura");
    for (const accion of ["data-armar-rutas", 'data-pestana="board"', "data-abrir-incidencias", "data-acciones-de-la-ruta", "data-recuadro-de-reparto", "data-marca-todas"]) {
      expect(html, accion).not.toContain(accion);
    }
    // Y sigue acotada, claro.
    expect(html).not.toContain("Miguel A.");
  }, 60_000);
});

describe("la pantalla acotada no es una pantalla aparte: es la del Gestor", () => {
  const gestor = plano(leer("src/app/(app)/routes/page.tsx"));
  const mapaDelChofer = plano(leer("src/app/(app)/my-route/mapa/page.tsx"));
  const miRuta = plano(leer("src/app/(app)/my-route/page.tsx"));

  it("«El mapa de mi ruta» monta la MISMA página del Gestor, en solo lectura y acotada a quien mira", () => {
    expect(mapaDelChofer).toContain('import RoutesPage from "@/app/(app)/routes/page";');
    expect(mapaDelChofer).toContain('<SoloMisRutas chofer={me.full_name}> <SoloLectura><RoutesPage /></SoloLectura> </SoloMisRutas>');
    // Nada propio: ni mapa, ni panel, ni paradas. Si algo de eso apareciera aquí, dejaría de ser «ese mismo mapa».
    for (const propio of ["useRutasDelDia(", "<MapView", "<PanelDeChoferes", "lecturaDeLaRuta("]) expect(mapaDelChofer, propio).not.toContain(propio);
    // Y la misma puerta de rol que «Mi ruta».
    expect(mapaDelChofer).toContain('if (!canDeliver(me) || me.role === "warehouse") {');
  });

  it("el acotado está en el ORIGEN —órdenes, carriles, camiones y rastreo— y no en el filtro de casillas", () => {
    const ancla = (texto: string) => { expect(gestor.indexOf(texto), texto).toBeGreaterThan(-1); };
    ancla("const miChofer = useSoloMisRutas();");
    ancla("const deliveries = useMemo(() => (miChofer == null ? todasLasDelDia : soloMisOrdenes(todasLasDelDia, miChofer)), [todasLasDelDia, miChofer]);");
    ancla("const todos = carrilesDelDia(drivers, bucketNames, dayOrders, hechasPintadas.keys()); return miChofer == null ? todos : soloMisCarriles(todos, miChofer);");
    ancla("return (miChofer == null ? todos : soloLoMioPorChofer(todos, miChofer)).map((c) => ({ ...c, label: etiquetaEnVivo(c, t) }));");
    ancla("const todos = trackingGaps(users, shifts, driverLocations); return miChofer == null ? todos : soloLoMioPorChofer(todos, miChofer);");
    // Acotada es siempre de solo lectura, aunque quien monte la página olvide `<SoloLectura>`.
    ancla("const soloLectura = soloLecturaDeclarada || miChofer != null;");
  });

  it("«Mi ruta» lleva a ese mapa, y no cuando se mira la ruta de otro (D-502)", () => {
    // El ancla primero: una prueba de texto que no comprueba que su ancla existe mide el fichero equivocado en silencio.
    expect(miRuta.indexOf('data-mapa-de-mi-ruta href="/my-route/mapa"')).toBeGreaterThan(-1);
    expect(miRuta).toContain('{!ajeno && ( <div style={{ marginBottom: 8 }}> <Link className="btn btn-ghost btn-sm" data-mapa-de-mi-ruta href="/my-route/mapa">');
    // Y «Mi ruta» no pierde nada por esto: su siguiente parada, sus botones y el aviso de D-341 siguen donde estaban.
    expect(miRuta).toContain('{t("Next stop", "Siguiente parada")}');
    expect(miRuta).toContain("<AccionesDeParada pedido={d} tipo={tipo}");
    expect(miRuta).toContain('{t("Your route changed after the plan was published.", "Tu ruta cambió desde que se publicó el plan.")}');
    expect(miRuta).toContain("<LeaveAtStore pedido={next} me={me}");
  });

  it("acotada, los colores de chofer —la lista de TODOS por nombre— no salen", () => {
    expect(gestor.indexOf("data-colores-de-chofer")).toBeGreaterThan(-1);
    expect(gestor).toContain("{soloLectura && miChofer == null && ( <div className=\"card\" data-colores-de-chofer>");
  });
});
