import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  choferVigente, choferesParaVer, claveDelChoferVisto, etiquetaDeOpcion, guardaChoferVisto, leeChoferVisto,
  pestanaChoferEsRutaDeUnChofer, rutaDeSoloLectura,
} from "@/lib/vista-de-chofer";
import { misParadas, planDeLaRespuesta, planDeOtroChofer, urlDelPlanPublicado, type ParadaMia } from "@/lib/route-plan/mis-paradas";
import { KIND_RECHAZADA } from "@/lib/acciones-parada";
import { vistaDelPlan, type ParadaGuardada } from "@/lib/route-plan/vista";
import { RutaDeUnChofer } from "@/lib/ruta-de-un-chofer";
import { shiftDateISO, todayISO } from "@/lib/utils";
import type { Delivery, Profile } from "@/lib/types";

// ============================================================
// La pestaña «🚚 Chofer» del admin = «Mi ruta» de un chofer elegido, de solo lectura (D-502).
// Las reglas sueltas, y la PANTALLA de verdad pintada con ellas: que la ruta es la del elegido, que sus botones salen
// apagados, que el plan se pide del elegido, y que el chofer en su teléfono sigue exactamente igual.
// ============================================================

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

const estado = vi.hoisted(() => ({
  me: null as null | { id: string; role: string; full_name: string },
  users: [] as unknown[],
  deliveries: [] as unknown[],
  planPedido: [] as unknown[][],
  dejarEnTienda: [] as { id: string; disabled?: boolean; enLaLista: boolean }[],
  events: [] as unknown[],
  driverLocations: [] as unknown[],
  mapa: null as null | { liveDrivers: { driver: string }[] },
  // D-514: el mapa de «Mi ruta» es el del Gestor, montado solo-el-mapa. Lo que se registra es lo que «Mi ruta» le pasa.
  gestor: null as null | { chofer: string | null; dia: string | null; soloLectura: boolean },
}));

vi.mock("@/lib/data-provider", () => ({
  useData: () => ({
    me: estado.me, realRole: estado.me?.role ?? null, users: estado.users, deliveries: estado.deliveries, events: estado.events,
    settings: { stores: [], driver_capacity: {}, default_truck_capacity: 12, driver_colors: {} },
    driverLocations: estado.driverLocations, ready: true, setStage: async () => true, updateDelivery: async () => true, notify: () => {},
    marcarParada: async () => true, pushNotifs: async () => {},
  }),
}));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));
vi.mock("@/lib/route-plan/usePlanPublicado", () => ({
  usePlanPublicadoDelChofer: (...args: unknown[]) => { estado.planPedido.push(args); return null; },
}));
vi.mock("@/components/LeaveAtStore", () => ({
  LeaveAtStore: (p: { pedido: { id: string }; disabled?: boolean; style?: { minHeight?: number } }) => {
    // `minHeight: 44` es el estilo de los botones de cada parada (AccionesDeParada); el de «Siguiente parada» no lo lleva.
    estado.dejarEnTienda.push({ id: p.pedido.id, disabled: p.disabled, enLaLista: p.style?.minHeight === 44 });
    return createElement("span", { "data-dejar": p.disabled ? "apagado" : "encendido" });
  },
}));
vi.mock("@/components/MapView", () => ({ MapView: (p: { liveDrivers: { driver: string }[] }) => { estado.mapa = p; return createElement("div", { "data-mapa": "1" }); } }));
// La página del Gestor se sustituye por una que solo apunta qué le llegó por contexto (D-514). No se pinta entera aquí: pide
// `useConfirm`, que pone el layout, y lo que su mapa enseña acotado —el camión del elegido, sus paradas— ya lo prueba
// `gestor/mapa-del-chofer.test.ts` sobre la página de verdad. Lo que decide «Mi ruta» es A QUIÉN y QUÉ DÍA le pide el mapa.
vi.mock("@/app/(app)/routes/page", async () => {
  const { useSoloMisRutas } = await import("@/lib/gestor/solo-mis-rutas");
  const { useSoloElMapa } = await import("@/lib/gestor/solo-el-mapa");
  const { useSoloLectura } = await import("@/lib/gestor/solo-lectura");
  return {
    default: function GestorSimulado() {
      estado.gestor = { chofer: useSoloMisRutas(), dia: useSoloElMapa()?.dia ?? null, soloLectura: useSoloLectura() };
      return createElement("div", { "data-mapa-del-gestor": "1" });
    },
  };
});
vi.mock("@/components/OrderModalLazy", () => ({ OrderModal: () => null }));
vi.mock("@/lib/useStoreMarkers", () => ({ useStoreMarkers: () => [] }));
// D-527: «↩ Deshacer» de la llegada y de la recogida preguntan con `useConfirm`, que en la app pone el layout.
vi.mock("@/lib/confirm", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/OrdersTable", () => ({ OrdersTable: (p: { rows: unknown[] }) => createElement("div", { "data-tabla-de-ordenes": p.rows.length }) }));
vi.mock("@/components/ShiftClock", () => ({ ShiftClock: () => null }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

const HOY = todayISO();
const orden = (id: string, chofer: string, stage: string, fecha = HOY, extra: Partial<Delivery> = {}): Delivery => ({
  id, order_no: Number(id.replace(/\D/g, "")) || 1, invoice_num: `INV-${id}`, assigned_driver: chofer, stage, delivery_date: fecha,
  delivery_address: `${id} Main St`, delivery_windows: null, store: "McAllen", photos: [], ...extra,
}) as unknown as Delivery;

const ADMIN = { id: "u-admin", role: "admin", full_name: "You (Admin)" };
const CARLOS = { id: "u-carlos", role: "driver", full_name: "Carlos R." };
const MIGUEL = { id: "u-miguel", role: "driver", full_name: "Miguel A." };
const USUARIOS = [
  ADMIN, CARLOS, MIGUEL,
  { id: "u-ana", role: "driver", full_name: "Ana" },
  { id: "u-sin", role: "driver", full_name: "  " },
  { id: "u-ventas", role: "sales", full_name: "Sam Sales" },
];
const ORDENES = [
  orden("C1", "Carlos R.", "ready"),
  orden("C2", "Carlos R.", "picked_up"),
  orden("C3", "Carlos R.", "ready", shiftDateISO(HOY, 1)),
  orden("C4", "Carlos R.", "canceled"),
  orden("C5", "Carlos R.", "picked_up"),            // rechazada por el cliente: solo le queda «Dejar en tienda» (D-487)
  orden("M1", "Miguel A.", "ready"),
];
const AHORA = new Date().toISOString();

beforeEach(() => {
  estado.users = USUARIOS;
  estado.deliveries = ORDENES;
  estado.planPedido = [];
  estado.dejarEnTienda = [];
  estado.events = [{ id: "e1", delivery_id: "C5", kind: KIND_RECHAZADA, note: "Rejected by customer: Damaged material", created_by: "u-carlos", created_at: AHORA }];
  estado.driverLocations = [{ driver_id: "u-carlos", lat: 26.2, lng: -98.2, accuracy_m: 10, recorded_at: AHORA }];
  estado.mapa = null;
  estado.gestor = null;
});

describe("a quién le toca la vista nueva", () => {
  it("al admin; al chofer y a los demás, su lista de siempre", () => {
    expect(pestanaChoferEsRutaDeUnChofer({ role: "admin" })).toBe(true);
    for (const role of ["driver", "logistics", "manager", "warehouse", "sales", "accounting"] as const) {
      expect(pestanaChoferEsRutaDeUnChofer({ role }), role).toBe(false);
    }
    expect(pestanaChoferEsRutaDeUnChofer(null)).toBe(false);
  });
});

describe("solo lectura", () => {
  it("la ruta propia se puede tocar; la de otro, no", () => {
    expect(rutaDeSoloLectura({ id: "a" }, { id: "a" })).toBe(false);
    expect(rutaDeSoloLectura({ id: "admin" }, { id: "carlos" })).toBe(true);
  });
  it("sin saber quién mira o de quién es, tampoco", () => {
    expect(rutaDeSoloLectura(null, { id: "a" })).toBe(true);
    expect(rutaDeSoloLectura({ id: "a" }, null)).toBe(true);
  });
});

describe("de qué choferes se elige", () => {
  it("solo choferes con nombre, por nombre, con sus paradas de HOY (sin las de otro día ni las anuladas)", () => {
    const o = choferesParaVer(USUARIOS as Profile[], ORDENES, HOY);
    expect(o).toEqual([
      { id: "u-ana", nombre: "Ana", paradasHoy: 0 },
      { id: "u-carlos", nombre: "Carlos R.", paradasHoy: 3 },
      { id: "u-miguel", nombre: "Miguel A.", paradasHoy: 1 },
    ]);
  });
  it("la etiqueta dice cuántas paradas tiene hoy, en singular y en plural", () => {
    expect(etiquetaDeOpcion({ id: "x", nombre: "Carlos R.", paradasHoy: 2 }, true)).toBe("Carlos R. · 2 paradas hoy");
    expect(etiquetaDeOpcion({ id: "x", nombre: "Miguel A.", paradasHoy: 1 }, true)).toBe("Miguel A. · 1 parada hoy");
    expect(etiquetaDeOpcion({ id: "x", nombre: "Carlos R.", paradasHoy: 2 }, false)).toBe("Carlos R. · 2 stops today");
    expect(etiquetaDeOpcion({ id: "x", nombre: "Miguel A.", paradasHoy: 1 }, false)).toBe("Miguel A. · 1 stop today");
  });
});

describe("cuál queda elegido, y que se recuerda", () => {
  const opciones = [{ id: "a" }, { id: "b" }];
  it("el guardado si sigue en la lista; si no, el primero; sin choferes, ninguno", () => {
    expect(choferVigente("b", opciones)).toBe("b");
    expect(choferVigente("se-fue", opciones)).toBe("a");
    expect(choferVigente(null, opciones)).toBe("a");
    expect(choferVigente("b", [])).toBeNull();
  });
  it("se guarda por quien mira, y se lee de la misma clave", () => {
    const caja = new Map<string, string>();
    guardaChoferVisto(() => ({ setItem: (k, v) => caja.set(k, v) }), "u-admin", "u-carlos");
    expect([...caja.keys()]).toEqual([claveDelChoferVisto("u-admin")]);
    expect(leeChoferVisto((k) => caja.get(k) ?? null, "u-admin")).toBe("u-carlos");
    // Otro admin en la misma computadora no hereda la elección.
    expect(leeChoferVisto((k) => caja.get(k) ?? null, "u-otro")).toBeNull();
    expect(claveDelChoferVisto("u-admin")).not.toBe(claveDelChoferVisto("u-otro"));
  });
  it("un navegador que niega el almacenamiento no rompe nada, y lo guardado raro no vale", () => {
    expect(leeChoferVisto(() => { throw new Error("denegado"); }, "u-admin")).toBeNull();
    expect(() => guardaChoferVisto(() => { throw new Error("denegado"); }, "u-admin", "x")).not.toThrow();
    expect(leeChoferVisto(() => "", "u-admin")).toBeNull();
    expect(leeChoferVisto(() => "x".repeat(121), "u-admin")).toBeNull();
  });
});

describe("el plan publicado de OTRO chofer", () => {
  const fila = (driver_id: string, seq: number, kind: "P" | "D", ref: string, load_after: number): ParadaGuardada => ({
    driver_id, driver_name: driver_id, seq, kind, delivery_id: ref, order_ref: ref, label: `${kind}${seq}`, place: kind === "P" ? "McAllen" : null,
    window_start: 480, window_end: 600, is_hard: false, eta: 480 + seq * 20, etd: 490 + seq * 20, wait_min: 3, service_min: 10, late_min: 7,
    load_after, leg_minutes: 12, leg_miles: 4, pinned: false,
  }) as ParadaGuardada;
  const filas = [
    fila("u-carlos", 1, "P", "c1", 4), fila("u-carlos", 2, "D", "c1", 0),
    fila("u-miguel", 1, "P", "m1", 2), fila("u-miguel", 2, "P", "m2", 5), fila("u-miguel", 3, "D", "m1", 3), fila("u-miguel", 4, "D", "m2", 0),
  ];
  const respuesta = { ok: true, plan: { version: 3, published_at: "2026-10-08T12:00:00Z", rutas: vistaDelPlan(filas, [], {}) } };

  it("es lo mismo que el chofer recibe de `/mine`: las mismas columnas por el mismo `misParadas`", () => {
    const comoLaBase: ParadaMia[] = filas.filter((f) => f.driver_id === "u-miguel").map((f) => ({
      plan_version: 3, published_at: "2026-10-08T12:00:00Z", seq: f.seq, kind: f.kind, delivery_id: f.delivery_id, order_ref: f.order_ref,
      label: f.label, place: f.place, window_start: f.window_start, window_end: f.window_end, is_hard: f.is_hard, eta: f.eta, etd: f.etd,
      load_after: f.load_after,
    }));
    const suyo = planDeOtroChofer(respuesta, "u-miguel");
    expect(suyo).toEqual(misParadas(comoLaBase));
    expect(suyo?.paradas.map((p) => p.label)).toEqual(["P1", "P2", "D3", "D4"]);
    expect(suyo?.version).toBe(3);
    expect(suyo?.entregas).toBe(2);
  });
  it("el chofer pide `/mine`; mirando a otro, el publicado entero — y de cada respuesta se saca lo que toca", () => {
    expect(urlDelPlanPublicado("2026-10-08", null)).toBe("/api/route-plan/mine?date=2026-10-08");
    expect(urlDelPlanPublicado("2026-10-08", "u-miguel")).toBe("/api/route-plan?date=2026-10-08&status=published");
    const mio = planDeOtroChofer(respuesta, "u-carlos");
    expect(planDeLaRespuesta({ ok: true, plan: mio }, null)).toBe(mio);
    expect(planDeLaRespuesta({ ok: false, plan: mio }, null)).toBeNull();
    expect(planDeLaRespuesta(respuesta, "u-miguel")).toEqual(planDeOtroChofer(respuesta, "u-miguel"));
    // Y el gancho de «Mi ruta» las usa a las dos.
    const gancho = leer("src/lib/route-plan/usePlanPublicado.ts");
    expect(gancho).toContain("fetch(urlDelPlanPublicado(date, deOtro))");
    expect(gancho).toContain("setPlan(planDeLaRespuesta(b, deOtro));");
    expect(gancho).toContain("}, [date, deOtro]);");
  });
  it("sin respuesta buena, o sin ruta de ese chofer, no hay plan", () => {
    expect(planDeOtroChofer({ ok: false, plan: respuesta.plan }, "u-miguel")).toBeNull();
    expect(planDeOtroChofer(respuesta, "u-ana")).toBeNull();
    expect(planDeOtroChofer(null, "u-miguel")).toBeNull();
    expect(planDeOtroChofer({ ok: true, plan: null }, "u-miguel")).toBeNull();
  });
});

// ------------------------------------------------------------
// La pantalla, pintada.
// ------------------------------------------------------------
const botonesDeAccion = (html: string) => html.match(/<button[^>]*class="btn btn-(?:green|amber|danger)[^"]*"[^>]*>/g) ?? [];

describe("«Mi ruta» de otro chofer (lo que monta la pestaña del admin)", () => {
  const pinta = async (chofer: typeof CARLOS | null) => {
    const { default: MyRoutePage } = await import("@/app/(app)/my-route/page");
    const pagina = createElement(MyRoutePage);
    return renderToStaticMarkup(chofer ? createElement(RutaDeUnChofer, { chofer }, pagina) : pagina);
  };

  it("el admin ve las paradas del elegido, y solo las suyas", async () => {
    estado.me = ADMIN;
    const html = await pinta(CARLOS);
    expect(html).toContain("INV-C1");
    expect(html).toContain("INV-C2");
    expect(html).not.toContain("INV-M1");
    expect(html).not.toContain("INV-C3");              // la de mañana, en su día
    const deMiguel = await pinta(MIGUEL);
    expect(deMiguel).toContain("INV-M1");
    expect(deMiguel).not.toContain("INV-C1");
  });
  // Nota D-520: decía «Recogido, Entregado, Saltar, Rechazado y Dejar en tienda» y fijaba que salía `saltar`. «Saltar» se
  // quitó; en su lugar están «📍 Llegué» y «⏸ Registrar parada», y también se ven apagados.
  it("los botones se ven igual, pero apagados: Recogido, Entregado, Rechazado, Dejar en tienda, Llegué y Registrar parada", async () => {
    estado.me = ADMIN;
    const html = await pinta(CARLOS);
    const botones = botonesDeAccion(html);
    expect(botones.length).toBeGreaterThanOrEqual(4);
    for (const b of botones) expect(b, b).toContain("disabled");
    expect(html).not.toContain('data-accion="saltar"');
    const llegue = html.match(/<button[^>]*data-accion="llegue"[^>]*>/g) ?? [];
    expect(llegue.length).toBeGreaterThanOrEqual(1);
    for (const b of llegue) expect(b, b).toContain("disabled");
    expect(html).toMatch(/<button[^>]*data-registrar-parada="true"[^>]*disabled=""/);
    // «Dejar en tienda»: el de la parada rechazada (en la lista) y el de la tarjeta de «Siguiente parada», los dos apagados.
    expect(estado.dejarEnTienda.some((d) => d.id === "C5" && d.enLaLista)).toBe(true);
    expect(estado.dejarEnTienda.some((d) => !d.enLaLista)).toBe(true);
    expect(estado.dejarEnTienda.every((d) => d.disabled === true)).toBe(true);
  });
  it("D-527: los «↩ Deshacer» nuevos (la recogida y la llegada) también se ven igual y apagados; el chofer los ve encendidos", async () => {
    // C2 la recogió Carlos (puede deshacerla); C1 sigue en la tienda y Carlos ya llegó.
    estado.events = [
      ...estado.events,
      { id: "e2", delivery_id: "C2", kind: "picked_up", note: "Loaded: 4 pallets", created_by: "u-carlos", created_at: AHORA },
      { id: "e3", delivery_id: "C1", kind: "arrived_pickup", note: null, created_by: "u-carlos", created_at: AHORA },
    ];
    estado.me = ADMIN;
    const admin = await pinta(CARLOS);
    for (const accion of ["deshacer_recogida", "deshacer_llegada", "recoger", "llegue"]) {
      const botones = admin.match(new RegExp(`<button[^>]*data-accion="${accion}"[^>]*>`, "g")) ?? [];
      if (accion === "llegue") { expect(botones.every((b) => b.includes("disabled"))).toBe(true); continue; }
      expect(botones.length, accion).toBeGreaterThanOrEqual(1);
      for (const b of botones) expect(b, b).toContain("disabled");
    }
    estado.me = CARLOS;
    const suya = await pinta(null);
    expect(suya).toMatch(/<button[^>]*data-accion="deshacer_recogida"(?![^>]*disabled)[^>]*>/);
    expect(suya).toMatch(/<button[^>]*data-accion="deshacer_llegada"(?![^>]*disabled)[^>]*>/);
  });
  it("y pide el plan publicado DEL ELEGIDO, no el de quien mira", async () => {
    estado.me = ADMIN;
    await pinta(CARLOS);
    expect(estado.planPedido.at(-1)).toEqual([HOY, "u-carlos"]);
  });
  it("el mapa es el del Gestor, acotado AL ELEGIDO y no a quien mira, en su día y de solo lectura", async () => {
    // D-514: antes «Mi ruta» pintaba su propio mapa y aquí se miraba su camión. Ahora le pide el mapa al Gestor; lo que
    // hay que fijar es a quién se lo pide. Si dijera «You (Admin)», el admin vería SU mapa en la ruta de Carlos.
    // Que ese mapa enseñe solo el camión de Carlos lo prueba `gestor/mapa-del-chofer.test.ts` («Carlos R.», línea 194).
    estado.me = ADMIN;
    await pinta(CARLOS);
    expect(estado.gestor).toEqual({ chofer: "Carlos R.", dia: HOY, soloLectura: true });
    // Y el mapa viejo ya no se pinta: un solo mapa en la pantalla.
    expect(estado.mapa).toBeNull();
  });
  it("y si un botón se colara encendido, la acción tampoco escribe: la segunda puerta está en las dos funciones", () => {
    const ruta = leer("src/app/(app)/my-route/page.tsx");
    // Nota D-527: `cerrarParada` ya no escribe (abre la ficha y, al entregar, la cámara) y dejó de ser `async`; la puerta
    // sigue siendo lo primero, antes de abrir la cámara. Y los dos «↩ Deshacer» nuevos llevan la suya.
    const cuerpo = ruta.slice(ruta.indexOf('const cerrarParada = (d: Delivery, accion: "recoger" | "entregar") => {'), ruta.indexOf("camara.abrir();"));
    expect(cuerpo).toContain("if (soloLectura) return;");
    const acciones = leer("src/components/AccionesDeParada.tsx");
    expect(acciones).toContain("if (ocupado || soloLectura) return false;");
    expect(acciones.match(/if \(ocupado \|\| soloLectura\) return;/g)).toHaveLength(3);
  });
  it("la lista va numerada por PARADAS como el Gestor, no con P1 y D1 (D-515)", async () => {
    // El dueño: «QUIERO EN EL DRIVER VIEW QUE EN VEZ DE LOS P1 Y D1 SE VEA IGUAL QUE LOGISTIC MANAGER CON NUMEROS EN VES DE ESO».
    // Con los datos de aquí: C1, C2 y C5 se recogen las tres en McAllen —UNA parada, la 1, con la raya de que sigue en
    // las otras dos filas— y luego tres entregas, cada una su parada.
    // Nota D-520: la lista va en dos secciones. C2 y C5 ya van en el camión, así que sus filas de recogida pasan a
    // «Entregadas» y C1, que falta, se queda en «Pendientes»: la parada 1 queda partida, y su número sale en las dos
    // (la primera fila de la parada DENTRO de cada sección). Antes: números 1, 2, 3, 4 y dos rayas en la lista entera.
    estado.me = CARLOS;
    const html = await pinta(null);
    const [pendientes, hechas] = html.split('data-seccion="hechas"');
    const numerosDe = (h: string) => [...h.matchAll(/data-numero-de-parada="(\d+)"/g)].map((m) => m[1]);
    const sigueDe = (h: string) => [...h.matchAll(/data-sigue-la-parada="(\d+)"/g)].map((m) => m[1]);
    expect(hechas).toBeDefined();
    expect(numerosDe(pendientes)).toEqual(["1", "2", "3", "4"]);
    expect(sigueDe(pendientes)).toEqual([]);
    expect(numerosDe(hechas)).toEqual(["1"]);
    expect(sigueDe(hechas)).toEqual(["1"]);
    // Ni una P1 ni una D1 sueltas en la lista: solo quedan dentro del título del círculo, como en el Gestor.
    expect(html.match(/>[PD]\d+</g) ?? []).toEqual([]);
    expect(html).toContain('title="Stop 1 — pick up P1, P2, P3"');
  });
  it("una entrega ya hecha conserva su sitio y lleva ✓ en su círculo, no su número", async () => {
    // Los datos de arriba no traen ninguna entregada: sin este caso, quitar el ✓ no lo vería nadie.
    estado.me = CARLOS;
    estado.deliveries = [...ORDENES, orden("C6", "Carlos R.", "delivered", HOY, { delivery_address: "6 Elm St" })];
    const html = await pinta(null);
    const circulos = [...html.matchAll(/data-numero-de-parada="(\d+)"[^>]*>([^<]*)</g)].map((m) => `${m[1]}:${m[2]}`);
    expect(circulos.filter((c) => c.endsWith(":✓"))).toEqual(["5:✓"]);
    // Y sigue contando en la numeración del día: su parada tiene número aunque enseñe ✓. Nota D-520: eran 5 círculos; son
    // 6 porque la parada 1 (recogida partida entre Pendientes y Entregadas) lleva su número en las dos secciones.
    expect(circulos.length).toBe(6);
    // Y la entregada está en «Entregadas», no en «Pendientes».
    expect(html.split('data-seccion="hechas"')[1]).toContain("INV-C6");
    expect(html.split('data-seccion="hechas"')[0]).not.toContain("INV-C6");
  });
  it("y numera con la MISMA función que el Gestor: antes de recoger nada, los mismos números en las dos pantallas", async () => {
    // Lo que el Gestor llama a esa ruta, con sus funciones de verdad, sobre el mismo día y sin nada hecho todavía.
    const { lecturaConLoHecho } = await import("@/lib/route-plan/lectura-del-gestor");
    const { lecturaDeLaRuta } = await import("@/lib/route-plan/lectura-de-ruta");
    const { paradasDeLaRuta } = await import("@/lib/gestor/paradas-numeradas");
    const dia = ["A1", "A2", "A3"].map((id, i) => orden(id, "Carlos R.", "ready", HOY, { route_seq: i, delivery_address: `${id} St` }));
    const delGestor = paradasDeLaRuta(lecturaConLoHecho(dia, 12, null, []).filas, dia).deFila;
    const deMiRuta = paradasDeLaRuta(lecturaDeLaRuta(dia, 12, null).filas, dia).deFila;
    expect(deMiRuta).toEqual(delGestor);
    // Y que esto no compara dos listas vacías.
    expect(delGestor.length).toBeGreaterThan(3);
    // La pantalla llama a la función con su lectura, no a otra cosa.
    const ruta = leer("src/app/(app)/my-route/page.tsx");
    expect(ruta).toContain("const numeradas = useMemo(() => paradasDeLaRuta(lectura.filas, stops), [lectura, stops]);");
  });
  it("el chofer en su teléfono: su ruta, sus botones encendidos y su plan de siempre (`/mine`)", async () => {
    estado.me = CARLOS;
    const html = await pinta(null);
    expect(html).toContain("INV-C1");
    expect(html).not.toContain("INV-M1");
    const botones = botonesDeAccion(html);
    expect(botones.length).toBeGreaterThanOrEqual(4);
    for (const b of botones) expect(b, b).not.toContain("disabled");
    expect(estado.dejarEnTienda.length).toBeGreaterThan(0);
    expect(estado.dejarEnTienda.every((d) => !d.disabled)).toBe(true);
    expect(estado.planPedido.at(-1)).toEqual([HOY, null]);
    // D-514: su mapa es el del Gestor acotado a ÉL — igual que cuando el admin mira el suyo, con su propio nombre.
    expect(estado.gestor).toEqual({ chofer: "Carlos R.", dia: HOY, soloLectura: true });
  });
});

describe("la pestaña «Chofer»", () => {
  const pinta = async () => {
    const { default: DriverPage } = await import("@/app/(app)/driver/page");
    return renderToStaticMarkup(createElement(DriverPage));
  };

  it("al admin: el selector con todos los choferes y sus paradas de hoy, y lo de antes plegado", async () => {
    estado.me = ADMIN;
    const html = await pinta();
    expect(html).toContain("data-vista-de-chofer");
    expect(html).toContain("data-elige-chofer");
    expect(html).toContain(">Ana · 0 stops today<");
    expect(html).toContain(">Carlos R. · 3 stops today<");
    expect(html).toContain(">Miguel A. · 1 stop today<");
    expect(html).not.toContain("Sam Sales");
    // Lo de antes, plegado y sin montar hasta que se abre.
    expect(html).toContain("data-lista-anterior");
    expect(html).not.toContain("data-tabla-de-ordenes");
  });
  it("al chofer: su lista de siempre, sin selector ni columna de teléfono", async () => {
    estado.me = CARLOS;
    const html = await pinta();
    expect(html).not.toContain("data-vista-de-chofer");
    expect(html).toContain("data-tabla-de-ordenes");
    expect(html).toContain('href="/home/directory"');
  });
  it("la página monta la MISMA «Mi ruta» del elegido, de nuevo al cambiar de chofer, y recuerda la elección", () => {
    const src = leer("src/app/(app)/driver/page.tsx");
    expect(src).toContain('import MyRoutePage from "@/app/(app)/my-route/page";');
    expect(src).toContain("if (pestanaChoferEsRutaDeUnChofer(me)) return <RutaDeUnChoferParaElAdmin />;");
    expect(src).toContain("const opciones = useMemo(() => choferesParaVer(users, deliveries, todayISO()), [users, deliveries]);");
    expect(src).toContain("useEffect(() => { setGuardado(leeChoferVisto((k) => window.localStorage.getItem(k), quienMira)); }, [quienMira]);");
    expect(src).toContain("const elegidoId = guardado === undefined ? null : choferVigente(guardado, opciones);");
    expect(src).toContain("const elegir = (id: string) => { setGuardado(id); guardaChoferVisto(() => window.localStorage, quienMira, id); };");
    expect(src).toContain('onChange={(e) => elegir(e.target.value)}');
    expect(src).toMatch(/<RutaDeUnChofer chofer=\{elegido\}>\s*<MyRoutePage key=\{elegido\.id\} \/>\s*<\/RutaDeUnChofer>/);
    expect(src).toContain('<div className="como-telefono" data-como-telefono>');
    expect(src).toContain("data-aviso-solo-lectura");
    // Lo de antes, plegado: se monta al abrir, y sin su propio título «Chofer» (ya lo dice el desplegable).
    expect(src).toContain("{verLista && <div style={{ marginTop: 12 }}><ListaDelChofer plegada /></div>}");
    expect(src).toContain('{me.role === "driver" || plegada ? <span /> : (');
    expect(src).toContain("como la ve él — solo lectura");
  });
  it("la columna es del ancho de un teléfono, y dentro valen las reglas de teléfono", () => {
    const css = leer("src/app/globals.css");
    expect(css).toContain(".vista-de-chofer { max-width: 420px; margin: 0 auto; }");
    expect(css).toContain(".como-telefono .card { padding: 14px; margin-bottom: 12px; }");
    expect(css).toContain(".como-telefono .btn, .como-telefono .chip { min-height: 36px;");
  });
});
