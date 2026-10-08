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
// La pestaña «🚚 Chofer» del admin = «Mi ruta» de un chofer elegido, de solo lectura (D-NEXT).
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
vi.mock("@/components/OrderModalLazy", () => ({ OrderModal: () => null }));
vi.mock("@/lib/useStoreMarkers", () => ({ useStoreMarkers: () => [] }));
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
  it("los botones se ven igual, pero apagados: Recogido, Entregado, Saltar, Rechazado y Dejar en tienda", async () => {
    estado.me = ADMIN;
    const html = await pinta(CARLOS);
    const botones = botonesDeAccion(html);
    expect(botones.length).toBeGreaterThanOrEqual(4);
    for (const b of botones) expect(b, b).toContain("disabled");
    expect(html).toContain('data-accion="saltar"');
    // «Dejar en tienda»: el de la parada rechazada (en la lista) y el de la tarjeta de «Siguiente parada», los dos apagados.
    expect(estado.dejarEnTienda.some((d) => d.id === "C5" && d.enLaLista)).toBe(true);
    expect(estado.dejarEnTienda.some((d) => !d.enLaLista)).toBe(true);
    expect(estado.dejarEnTienda.every((d) => d.disabled === true)).toBe(true);
  });
  it("y pide el plan publicado DEL ELEGIDO, no el de quien mira", async () => {
    estado.me = ADMIN;
    await pinta(CARLOS);
    expect(estado.planPedido.at(-1)).toEqual([HOY, "u-carlos"]);
  });
  it("en el mapa sale el camión DEL ELEGIDO, no el de quien mira", async () => {
    estado.me = ADMIN;
    await pinta(CARLOS);
    expect(estado.mapa?.liveDrivers.map((l) => l.driver)).toEqual(["Carlos R."]);
  });
  it("y si un botón se colara encendido, la acción tampoco escribe: la segunda puerta está en las dos funciones", () => {
    const ruta = leer("src/app/(app)/my-route/page.tsx");
    const cuerpo = ruta.slice(ruta.indexOf("const cerrarParada = async (d: Delivery) => {"), ruta.indexOf("const accion = accionParada(d.stage, settings, d.photos);"));
    expect(cuerpo).toContain("if (soloLectura) return;");
    expect(leer("src/components/AccionesDeParada.tsx")).toContain("if (ocupado || soloLectura) return false;");
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
    expect(estado.mapa?.liveDrivers.map((l) => l.driver)).toEqual(["Carlos R."]);
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
