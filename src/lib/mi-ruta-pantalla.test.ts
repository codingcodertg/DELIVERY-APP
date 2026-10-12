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
  it("Pendientes abierta, Entregadas plegada, cada una con su cuenta de paradas", async () => {
    const html = await pinta();
    expect(html).toMatch(/<details data-seccion="pendientes" open=""/);
    expect(html).toMatch(/<details data-seccion="hechas"(?! open)/);
    expect(html).toContain("🕒 Pending (");
    expect(html).toContain("✓ Delivered (");
    const s = secciones(html);
    expect(s.hechas).toContain("INV-A4");
    expect(s.pendientes).not.toContain("INV-A4");
    expect(s.pendientes).toContain("INV-A3");
  });
  it("la recogida que el almacén no tiene lista: «Picked up» a la vista, apagado y con el motivo; la lista, encendida", async () => {
    const html = await pinta();
    const deA1 = html.slice(html.indexOf('data-recogida="A1"'), html.indexOf('data-recogida="A2"'));
    expect(deA1).toMatch(/data-accion="recoger" data-apagado=""[^>]*disabled=""/);
    expect(deA1).toContain("The warehouse doesn&#x27;t have it ready yet");
    const deA2 = html.slice(html.indexOf('data-recogida="A2"'));
    expect(deA2.slice(0, deA2.indexOf("</button>"))).not.toContain("disabled");
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
    expect([...tarjeta.matchAll(/data-accion="([a-z]+)"/g)].map((m) => m[1])).toEqual(["llegue"]);
  });
  it("ya llegó a la tienda: «✓ Arrived HH:MM» en vez del botón, que no se repite", async () => {
    estado.events = [{ id: "e1", delivery_id: "A1", kind: KIND_LLEGO_A_RECOGER, note: null, created_by: "u-carlos", created_at: new Date().toISOString() }];
    const html = await pinta();
    const s = secciones(html);
    expect((s.pendientes.match(/data-accion="llegue"/g) ?? []).length).toBe(1);
    expect(s.pendientes).toMatch(/data-llegada="hecha"[^>]*>✓ Arrived/);
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
