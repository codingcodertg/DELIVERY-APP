import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KIND_LLEGO_A_RECOGER, KIND_SALTADA } from "@/lib/acciones-parada";
import { shiftDateISO, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";
import type { PausaDelChofer } from "@/lib/pausas-del-chofer";

// ============================================================
// D-520 · «Mi ruta» del chofer, PINTADA de verdad, con lo que el dueño pidió el 2026-10-11 con las capturas de Ernesto:
// sin «Saltar»; «📍 Llegué» por parada y «Recogido» siempre a la vista (apagado con su motivo si el almacén no la tiene
// lista); «Pendientes» abierta y «Entregadas» plegada; sin «Ver la ruta completa», sin el aviso de vencidas, sin leyenda;
// y «⏸ Registrar parada».
// ============================================================

const estado = vi.hoisted(() => ({
  me: null as null | { id: string; role: string; full_name: string },
  deliveries: [] as unknown[],
  events: [] as unknown[],
  pausas: [] as unknown[],
  pausasPedidas: [] as unknown[][],
}));

vi.mock("@/lib/data-provider", () => ({
  useData: () => ({
    me: estado.me, realRole: estado.me?.role ?? null, users: [], deliveries: estado.deliveries, events: estado.events,
    settings: { stores: [], driver_capacity: {}, default_truck_capacity: 12, driver_colors: {} },
    driverLocations: [], ready: true, setStage: async () => true, updateDelivery: async () => true, notify: () => {},
    marcarParada: async () => true, pushNotifs: async () => {}, teaching: false,
  }),
}));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));
vi.mock("@/lib/route-plan/usePlanPublicado", () => ({ usePlanPublicadoDelChofer: () => null }));
vi.mock("@/components/LeaveAtStore", () => ({ LeaveAtStore: () => createElement("span", { "data-dejar": "1" }) }));
vi.mock("@/components/MapView", () => ({ MapView: () => createElement("div", { "data-mapa": "1" }) }));
vi.mock("@/app/(app)/routes/page", () => ({ default: () => createElement("div", { "data-mapa-del-gestor": "1" }) }));
vi.mock("@/components/OrderModalLazy", () => ({ OrderModal: () => null }));
vi.mock("@/lib/useStoreMarkers", () => ({ useStoreMarkers: () => [] }));
// D-527: «↩ Deshacer» de la llegada y de la recogida preguntan con `useConfirm`, que en la app pone el layout.
vi.mock("@/lib/confirm", () => ({ useConfirm: () => async () => true }));
vi.mock("@/lib/usePausasDelChofer", () => ({
  usePausasDelChofer: (...args: unknown[]) => {
    estado.pausasPedidas.push(args);
    return { pausas: estado.pausas, estado: "lista", empezar: async () => ({ ok: true }), seguir: async () => ({ ok: true }), ubicarTarde: async () => {} };
  },
}));

const HOY = todayISO();
const CARLOS = { id: "u-carlos", role: "driver", full_name: "Carlos R." };
const orden = (id: string, stage: string, seq: number, extra: Partial<Delivery> = {}): Delivery => ({
  id, order_no: seq, invoice_num: `INV-${id}`, assigned_driver: "Carlos R.", stage, delivery_date: HOY, route_seq: seq,
  delivery_address: `${id} Main St`, delivery_windows: null, store: "McAllen", photos: [], ...extra,
}) as unknown as Delivery;

beforeEach(() => {
  estado.me = CARLOS;
  estado.deliveries = [
    orden("A1", "approved", 1),                         // el almacén aún no la tiene lista
    orden("A2", "ready", 2),
    orden("A3", "picked_up", 3),                         // en el camión
    orden("A4", "delivered", 4),                         // ya entregada
    orden("V1", "ready", 5, { delivery_date: shiftDateISO(HOY, -2) }), // vencida de otro día
  ];
  estado.events = [];
  estado.pausas = [];
  estado.pausasPedidas = [];
});

const pinta = async () => {
  const { default: MyRoutePage } = await import("@/app/(app)/my-route/page");
  return renderToStaticMarkup(createElement(MyRoutePage));
};
const secciones = (html: string) => {
  const [antes, hechas] = html.split('data-seccion="hechas"');
  return { pendientes: antes.slice(antes.indexOf('data-seccion="pendientes"')), hechas: hechas ?? "" };
};

describe("«Mi ruta» pintada (D-520)", () => {
  it("D-522: las dos juntas arriba (Pendientes elegida), y solo se ve la lista elegida; cada una con su cuenta", async () => {
    const html = await pinta();
    expect(html).toMatch(/data-selector-de-lista/);
    expect(html.indexOf('data-titulo-de-seccion="pendientes"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-titulo-de-seccion="hechas"')).toBeGreaterThan(-1);
    // los dos botones van juntos, antes de las dos listas
    expect(html.indexOf('data-titulo-de-seccion="hechas"')).toBeLessThan(html.indexOf('data-seccion="pendientes"'));
    expect(html).toMatch(/aria-selected="true" data-titulo-de-seccion="pendientes"/);
    expect(html).toMatch(/<div data-seccion="pendientes" style/);
    expect(html).toMatch(/<div data-seccion="hechas" hidden=""/);
    expect(html).toContain("🕒 Pending (");
    expect(html).toContain("✓ Delivered (");
    const s = secciones(html);
    expect(s.hechas).toContain("INV-A4");
    expect(s.pendientes).not.toContain("INV-A4");
    expect(s.pendientes).toContain("INV-A3");
  });
  // Nota D-527: decía «a la vista, apagado y con el motivo». Desde D-527 abre la ficha, donde se recoge de todos modos con
  // nota (168): encendido, sin «⏳».
  it("D-527: la recogida que el almacén no tiene lista: «Picked up» ENCENDIDO, como la lista", async () => {
    const html = await pinta();
    const deA1 = html.slice(html.indexOf('data-recogida="A1"'), html.indexOf('data-recogida="A2"'));
    expect(deA1).toMatch(/data-accion="recoger"/);
    expect(deA1).not.toMatch(/data-accion="recoger"[^>]*disabled=""/);
    expect(deA1).not.toContain("The warehouse doesn&#x27;t have it ready yet");
    const deA2 = html.slice(html.indexOf('data-recogida="A2"'));
    expect(deA2.slice(0, deA2.indexOf("</button>"))).not.toContain("disabled");
  });
  it("D-527: «📍 Arrived» y «🚚 Picked up» en la MISMA fila: la de la primera orden de la parada que falta por recoger", async () => {
    const html = await pinta();
    const deA1 = html.slice(html.indexOf('data-recogida="A1"'), html.indexOf('data-recogida="A2"'));
    const fila = deA1.slice(deA1.indexOf("data-acciones-de-parada"));
    expect([...fila.matchAll(/data-accion="([a-z_]+)"/g)].map((m) => m[1])).toEqual(["llegue", "recoger"]);
    // y no en la segunda orden de la misma parada
    const deA2 = html.slice(html.indexOf('data-recogida="A2"'), html.indexOf("data-cuenta", html.indexOf('data-recogida="A2"')));
    expect([...deA2.matchAll(/data-accion="([a-z_]+)"/g)].map((m) => m[1])).toEqual(["recoger"]);
  });
  it("D-527: la recogida ya en el camión lleva «↩ Undo pickup» (en «Delivered», donde queda la recogida hecha)", async () => {
    estado.events = [{ id: "e1", delivery_id: "A3", kind: "picked_up", note: "Loaded: 4 pallets", created_by: "u-carlos", created_at: new Date().toISOString() }];
    const html = await pinta();
    const s = secciones(html);
    expect(s.hechas).toMatch(/data-accion="deshacer_recogida"/);
    expect(s.hechas).not.toMatch(/data-accion="deshacer_recogida"[^>]*disabled=""/);
    // La recogió otro (la oficina): se ve, apagado, con a quién pedírselo.
    estado.events = [{ id: "e1", delivery_id: "A3", kind: "picked_up", note: "Loaded: 4 pallets", created_by: "u-oficina", created_at: new Date().toISOString() }];
    const otro = secciones(await pinta()).hechas;
    expect(otro).toMatch(/data-accion="deshacer_recogida" data-apagado=""[^>]*disabled=""/);
    expect(otro).toContain("ask the office");
  });
  it("D-527: «Recogido» y «Entregado» abren la ficha en su paso; «Entregado» abre además la cámara, LO PRIMERO del toque", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/my-route/page.tsx", "utf8").split("\r\n").join("\n");
    const cuerpo = src.slice(src.indexOf("const cerrarParada = (d: Delivery, accion: \"recoger\" | \"entregar\") => {"), src.indexOf("const done = stops.filter"));
    expect(cuerpo).toContain("if (soloLectura) return;");
    // Síncrona: sin `async` ni `await` antes de abrir la cámara (en iOS Safari, después de un `await` ya no se abre).
    expect(cuerpo).not.toMatch(/async|await/);
    expect(cuerpo.indexOf("camara.abrir();")).toBeGreaterThan(-1);
    expect(cuerpo.indexOf("camara.abrir();")).toBeLessThan(cuerpo.indexOf("abrirOrden(d, accion);"));
    expect(cuerpo).toMatch(/if \(accion === "entregar"\) \{\s*fotoPara\.current = d\.id;/);
    // Ya no cierra la parada de un toque: ni `setStage` ni la escritura de la recogida en la página.
    expect(src).not.toContain("setStage(");
    expect(src).not.toContain("escrituraRecogida");
    expect(src).toContain("cerrar={cerrarParada}");
    expect(src).toContain("<OrderModal me={me} existing={open} startEditing={false} onClose={cerrarFicha} abrirEn={abrirEn}");
    expect(src).toContain("fotosDeEntrega={fotosDeEntrega?.id === open.id ? fotosDeEntrega.fotos : undefined}");
    // Y la cámara está en la página antes del toque, con `capture`.
    const html = await pinta();
    expect(html).toMatch(/<input type="file" accept="image\/\*" capture="environment" hidden="" data-camara-de-entrega=""/);
  });
  it("«📍 Arrived» en la parada de la tienda y en la entrega que va en el camión; ninguno en las hechas", async () => {
    const html = await pinta();
    const s = secciones(html);
    expect((s.pendientes.match(/data-accion="llegue"/g) ?? []).length).toBe(2);
    expect(s.hechas).not.toContain('data-accion="llegue"');
    const deA3 = html.slice(html.indexOf('data-entrega="A3"'), html.indexOf('data-entrega="A4"'));
    expect([...deA3.matchAll(/data-accion="([a-z]+)"/g)].map((m) => m[1])).toEqual(["llegue", "entregar", "rechazar"]);
  });
  it("la tarjeta de «Siguiente parada» lleva el «📍 Arrived» de SU parada (la tienda, mientras no la recoge), sin «Skip»", async () => {
    const html = await pinta();
    const tarjeta = html.slice(html.indexOf("data-siguiente-parada"), html.indexOf('data-mapa-del-gestor'));
    expect(tarjeta).toContain("INV-A1");
    // Nota D-527: con su «Picked up» al lado, en la misma fila (antes el verde iba junto a «Navigate» y «Llegué» aparte).
    expect([...tarjeta.matchAll(/data-accion="([a-z]+)"/g)].map((m) => m[1])).toEqual(["llegue", "recoger"]);
    const fila = tarjeta.slice(tarjeta.indexOf("data-acciones-de-parada"));
    expect([...fila.matchAll(/data-accion="([a-z]+)"/g)].map((m) => m[1])).toEqual(["llegue", "recoger"]);
    expect(tarjeta).toContain("🧭 Navigate");
    // Y la orden se abre tocándola (`data-abre-la-orden`), ya sin «📋 Open order».
    expect(tarjeta).toContain("data-abre-la-orden");
    expect(tarjeta).not.toContain("Open order");
  });
  it("ya llegó a la tienda: «✓ Arrived HH:MM» en vez del botón, que no se repite", async () => {
    estado.events = [{ id: "e1", delivery_id: "A1", kind: KIND_LLEGO_A_RECOGER, note: null, created_by: "u-carlos", created_at: new Date().toISOString() }];
    const html = await pinta();
    const s = secciones(html);
    expect((s.pendientes.match(/data-accion="llegue"/g) ?? []).length).toBe(1);
    // Nota D-527: ahora es el botón «↩ Undo» de la llegada (`data-accion="deshacer_llegada"`), con «✓ Arrived HH:MM» dentro.
    expect(s.pendientes).toMatch(/data-llegada="hecha"[^>]*><span[^>]*>✓ Arrived/);
  });
  it("ni «Skip» ni «Resume» en ningún sitio, tampoco con un salto viejo en el historial", async () => {
    estado.events = [{ id: "e1", delivery_id: "A3", kind: KIND_SALTADA, note: null, created_by: "u-carlos", created_at: new Date().toISOString() }];
    const html = await pinta();
    expect(html).not.toContain("Skip");
    expect(html).not.toContain("Resume");
    expect(html).not.toContain('data-marca-de-parada="saltada"');
  });
  it("la cabecera: sin «Full route view», sin el aviso de vencidas, sin leyenda; con «⏸ Log a stop»", async () => {
    const html = await pinta();
    expect(html).not.toContain("Full route view");
    expect(html).not.toContain("overdue");
    expect(html).not.toContain("View them");
    expect(html).not.toContain("INV-V1");
    expect(html).not.toContain("Map legend");
    expect(html).toContain("⏸ Log a stop");
    // Las paradas que pide son las de SU chofer y de hoy.
    expect(estado.pausasPedidas.at(-1)?.slice(0, 2)).toEqual(["u-carlos", HOY]);
  });
  it("parado: «⏸ Stopped: ⛽ Gas · hora» con «▶ Continue», en vez del botón", async () => {
    const abierta: PausaDelChofer = {
      id: "p1", driver_id: "u-carlos", motivo: "gas", nota: null, empezo_at: new Date().toISOString(), termino_at: null,
      lat: null, lng: null, precision_m: null, recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false, created_at: "",
    };
    estado.pausas = [abierta];
    const html = await pinta();
    expect(html).toContain('data-pausa-abierta="gas"');
    expect(html).toContain("⏸ Stopped: ⛽ Gas · ");
    expect(html).toContain("▶ Continue");
    expect(html).not.toContain("⏸ Log a stop");
  });
  it("quien no es chofer va a su inicio, no a «Not available»", async () => {
    estado.me = { id: "u-w", role: "warehouse", full_name: "Almacén" };
    vi.doMock("next/navigation", () => ({ usePathname: () => "/my-route", useRouter: () => ({ replace: () => {} }) }));
    vi.resetModules();
    const { default: MyRoutePage } = await import("@/app/(app)/my-route/page");
    const html = renderToStaticMarkup(createElement(MyRoutePage));
    expect(html).toContain('data-sin-permiso="/warehouse"');
    expect(html).not.toContain("Not available");
    vi.doUnmock("next/navigation");
  });
});
