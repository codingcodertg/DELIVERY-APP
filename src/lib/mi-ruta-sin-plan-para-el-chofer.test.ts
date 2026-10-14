import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// D-NEXT · «Mi ruta» PINTADA con un plan publicado que ya no cuadra con la ruta: el chofer no ve ni la tarjeta
// «▸ Planned order of the day» (D-324) ni el aviso amarillo «Your route changed after the plan was published» (D-341);
// el admin, en la misma página (su pestaña «Chofer», D-502), sigue viendo las dos. El dueño, 2026-10-13: «remove that
// yellow message is not require for the driver» y «also take plan order of the day for driver».
// ============================================================

const estado = vi.hoisted(() => ({
  me: null as null | { id: string; role: string; full_name: string },
  /** El chofer cuya ruta se mira (la pestaña «Chofer» del admin, D-502); `null` = la propia. */
  ajeno: null as null | { id: string; role: string; full_name: string },
  deliveries: [] as unknown[],
}));
vi.mock("@/lib/ruta-de-un-chofer", async (original) => ({
  ...(await original<typeof import("@/lib/ruta-de-un-chofer")>()),
  useChoferDeLaRuta: () => estado.ajeno,
}));

vi.mock("@/lib/data-provider", () => ({
  useData: () => ({
    me: estado.me, realRole: estado.me?.role ?? null, users: [], deliveries: estado.deliveries, events: [],
    settings: { stores: [], driver_capacity: {}, default_truck_capacity: 12, driver_colors: {} },
    driverLocations: [], ready: true, setStage: async () => true, updateDelivery: async () => true, notify: () => {},
    marcarParada: async () => true, pushNotifs: async () => {}, teaching: false,
  }),
}));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));
// El plan publicado tiene una orden («Z9») que ya no es del chofer: la ruta cambió después de publicarlo.
vi.mock("@/lib/route-plan/usePlanPublicado", () => ({
  usePlanPublicadoDelChofer: () => ({
    version: 1, publishedAt: null, entregas: 1, inicio: 480, fin: 600,
    paradas: [
      { seq: 1, kind: "P", delivery_id: "Z9", order_ref: "Z9", label: "P1", place: "McAllen", window_start: null, window_end: null, is_hard: false, eta: 480, etd: 490, load_after: 2, aBordoAlLlegar: 0 },
      { seq: 2, kind: "D", delivery_id: "Z9", order_ref: "Z9", label: "D1", place: null, window_start: null, window_end: null, is_hard: false, eta: 560, etd: 570, load_after: 0, aBordoAlLlegar: 2 },
    ],
  }),
}));
vi.mock("@/lib/usePausasDelChofer", () => ({
  usePausasDelChofer: () => ({ pausas: [], estado: "lista", empezar: async () => ({ ok: true }), seguir: async () => ({ ok: true }), ubicarTarde: async () => {} }),
}));
vi.mock("@/components/LeaveAtStore", () => ({ LeaveAtStore: () => null }));
vi.mock("@/components/MapView", () => ({ MapView: () => null }));
vi.mock("@/app/(app)/routes/page", () => ({ default: () => null }));
vi.mock("@/components/OrderModalLazy", () => ({ OrderModal: () => null }));
vi.mock("@/lib/useStoreMarkers", () => ({ useStoreMarkers: () => [] }));
vi.mock("@/lib/confirm", () => ({ useConfirm: () => async () => true }));

const HOY = todayISO();
const orden = (id: string, stage: string, seq: number): Delivery => ({
  id, order_no: seq, invoice_num: `INV-${id}`, assigned_driver: "Carlos R.", stage, delivery_date: HOY, route_seq: seq,
  delivery_address: `${id} Main St`, delivery_windows: null, store: "McAllen", photos: [],
}) as unknown as Delivery;

beforeEach(() => {
  estado.deliveries = [orden("A1", "ready", 1), orden("A2", "ready", 2)];
});

const pinta = async () => {
  const { default: MyRoutePage } = await import("@/app/(app)/my-route/page");
  return renderToStaticMarkup(createElement(MyRoutePage));
};

describe("«Mi ruta» con un plan publicado que ya no cuadra", () => {
  it("el chofer: ni la tarjeta del orden planeado ni el aviso amarillo; su lista, sí", async () => {
    estado.me = { id: "u-carlos", role: "driver", full_name: "Carlos R." };
    estado.ajeno = null;
    const html = await pinta();
    expect(html).toContain("INV-A1");
    expect(html).not.toContain("Planned order of the day");
    expect(html).not.toContain("Your route changed after the plan was published.");
  }, 60000);

  it("el admin mirando la ruta de ese chofer (su pestaña «Chofer»): las dos siguen (y es el control de que existen)", async () => {
    // Decide el rol de QUIEN MIRA (admin), no el del chofer de la ruta (driver).
    estado.me = { id: "u-admin", role: "admin", full_name: "Ana Admin" };
    estado.ajeno = { id: "u-carlos", role: "driver", full_name: "Carlos R." };
    const html = await pinta();
    expect(html).toContain("INV-A1");
    expect(html).toContain("Planned order of the day");
    expect(html).toContain("Your route changed after the plan was published.");
    expect(html).toContain("Removed");
  }, 60000);
});
