import { afterEach, describe, it, expect, vi } from "vitest";
import { demoDeliveries, demoSettings, demoNotifications, DEMO_USERS } from "@/lib/demo-data";
import { computeKpis, driverStats, groupVolume, overdueOrders, inDateRange } from "@/lib/analytics";
import { checkSchedule } from "@/lib/scheduling";
import { missingFields } from "@/lib/required";
import { driverNames, canTransition, STAGES, hasCap } from "@/lib/constants";
import { routeOrder, suggestDriver, windowConflicts, parseWindow } from "@/lib/dispatch";
import { isOverdue, fmtMoney, deliveryColumns } from "@/lib/utils";
import type { Stage } from "@/lib/types";

// ============================================================
// End-to-end exercise of the whole business-logic stack against the full demo
// dataset — the same 20+ orders the app seeds. This is the closest thing to
// "click through everything" that can run automatically.
// ============================================================

const settings = demoSettings();
const orders = demoDeliveries(settings);
const users = DEMO_USERS;

describe("dataset shape", () => {
  it("has at least 20 orders", () => {
    expect(orders.length).toBeGreaterThanOrEqual(20);
  });

  it("gives every order a unique id and order number", () => {
    expect(new Set(orders.map((o) => o.id)).size).toBe(orders.length);
    expect(new Set(orders.map((o) => o.order_no)).size).toBe(orders.length);
  });

  it("covers every workflow stage", () => {
    const seen = new Set(orders.map((o) => o.stage));
    for (const s of STAGES) expect(seen.has(s.key), `stage ${s.key} missing from demo data`).toBe(true);
  });

  it("covers every store", () => {
    const seen = new Set(orders.map((o) => o.store));
    for (const s of settings.stores) expect(seen.has(s.name), `store ${s.name} missing`).toBe(true);
  });

  it("only assigns drivers who actually exist as users", () => {
    const valid = new Set(driverNames(users));
    for (const o of orders) if (o.assigned_driver) expect(valid.has(o.assigned_driver), `${o.assigned_driver} is not a driver user`).toBe(true);
  });

  it("uses only configured order types", () => {
    const valid = new Set(settings.order_types);
    for (const o of orders) if (o.order_type) expect(valid.has(o.order_type)).toBe(true);
  });

  it("parses every delivery window it sets", () => {
    for (const o of orders) if (o.delivery_windows) expect(parseWindow(o.delivery_windows), `bad window on #${o.order_no}`).not.toBeNull();
  });
});

describe("dashboard KPIs over the full dataset", () => {
  const k = computeKpis(orders);

  it("counts every order exactly once across the buckets", () => {
    const drafts = orders.filter((o) => o.stage === "draft").length;
    const rejected = orders.filter((o) => o.stage === "rejected").length;
    const summed = k.pending + k.approved + k.inWarehouse + k.outForDelivery + k.delivered + k.canceled + drafts + rejected;
    expect(summed).toBe(k.total);
  });

  it("reports a real on-time percentage", () => {
    expect(k.onTimePct).not.toBeNull();
    expect(k.onTimePct!).toBeGreaterThanOrEqual(0);
    expect(k.onTimePct!).toBeLessThanOrEqual(100);
    // #1019 was delivered after its date, so we must not be at a perfect 100%.
    expect(k.onTimePct!).toBeLessThan(100);
  });

  it("excludes the canceled order's fee from revenue", () => {
    const canceled = orders.find((o) => o.stage === "canceled")!;
    expect(canceled.delivery_fee).toBe(999); // deliberate trap in the data
    const live = orders.filter((o) => o.stage !== "canceled").reduce((s, o) => s + (o.delivery_fee ?? 0), 0);
    expect(k.totalFees).toBeCloseTo(live, 2);
    // …and the canceled order's 999 must not have been added on top.
    expect(k.totalFees).not.toBeCloseTo(live + 999, 2);
  });

  it("adds up pallets and miles", () => {
    expect(k.totalPallets).toBeGreaterThan(0);
    expect(k.totalMiles).toBeGreaterThan(0);
  });

  it("flags the overdue orders", () => {
    expect(k.overdue).toBeGreaterThan(0);
    expect(k.overdue).toBe(orders.filter(isOverdue).length);
  });
});

describe("overdue detection", () => {
  const late = overdueOrders(orders);

  it("finds past-due orders that aren't finished", () => {
    expect(late.length).toBeGreaterThanOrEqual(2);
  });

  it("never flags a delivered or canceled order", () => {
    for (const o of late) expect(["delivered", "canceled"]).not.toContain(o.stage);
  });

  it("sorts the most overdue first", () => {
    const dates = late.map((o) => o.delivery_date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("driver workload", () => {
  const stats = driverStats(orders);

  it("reports every driver that has work", () => {
    expect(stats.length).toBeGreaterThan(0);
    for (const s of stats) expect(driverNames(users)).toContain(s.driver);
  });

  it("never counts more delivered than total", () => {
    for (const s of stats) expect(s.delivered).toBeLessThanOrEqual(s.total);
  });

  it("totals match the raw order count per driver", () => {
    for (const s of stats) {
      expect(s.total).toBe(orders.filter((o) => o.assigned_driver === s.driver).length);
    }
  });

  it("suggests the least-busy driver", () => {
    const suggestion = suggestDriver(driverNames(users), orders);
    expect(driverNames(users)).toContain(suggestion!);
  });
});

describe("volume grouping", () => {
  it("groups by store, totalling to the dataset", () => {
    const g = groupVolume(orders, "store");
    expect(g.reduce((s, x) => s + x.total, 0)).toBe(orders.length);
  });

  it("groups by account, sorted busiest first", () => {
    const g = groupVolume(orders, "account");
    expect(g[0].total).toBeGreaterThanOrEqual(g[g.length - 1].total);
  });
});

describe("required-field rules across real orders", () => {
  it("passes every order that is past draft", () => {
    // Anything submitted for approval or beyond should be complete.
    const live = orders.filter((o) => !["draft", "canceled"].includes(o.stage));
    for (const o of live) {
      expect(missingFields(o, settings.order_type_rules), `#${o.order_no} (${o.order_type}) is missing fields`).toEqual([]);
    }
  });

  it("accepts the Intertienda order on its SO # alone", () => {
    const intra = orders.find((o) => o.order_type === "Intertienda")!;
    expect(intra.invoice_num).toBeNull();
    expect(intra.so_num).toBeTruthy();
    expect(missingFields(intra, settings.order_type_rules)).toEqual([]);
  });

  it("accepts Transfer with no customer invoice", () => {
    for (const t of ["Transfer"]) {
      const o = orders.find((x) => x.order_type === t)!;
      expect(o.invoice_num).toBeNull();
      expect(missingFields(o, settings.order_type_rules), `${t} should not need paperwork`).toEqual([]);
    }
  });
});

describe("workflow transitions on real orders", () => {
  it("allows the legal next step for each live order", () => {
    const nexts: Partial<Record<Stage, Stage>> = {
      draft: "pending", pending: "approved", approved: "fulfilling",
      fulfilling: "ready", ready: "picked_up", picked_up: "delivered",
    };
    for (const o of orders) {
      const to = nexts[o.stage];
      if (to) expect(canTransition(o.stage, to), `#${o.order_no} ${o.stage}→${to}`).toBe(true);
    }
  });

  it("blocks skipping approval — draft can never jump to fulfilling", () => {
    const draft = orders.find((o) => o.stage === "draft")!;
    expect(canTransition(draft.stage, "fulfilling")).toBe(false);
    expect(canTransition(draft.stage, "delivered")).toBe(false);
  });

  it("treats delivered and canceled as terminal", () => {
    for (const s of ["delivered", "canceled"] as Stage[]) {
      for (const t of STAGES) expect(canTransition(s, t.key)).toBe(false);
    }
  });
});

describe("proof of delivery", () => {
  const delivered = orders.filter((o) => o.stage === "delivered");

  it("has delivered orders with a signer recorded", () => {
    expect(delivered.length).toBeGreaterThanOrEqual(3);
    for (const o of delivered) expect(o.pod_received_by, `#${o.order_no} has no signer`).toBeTruthy();
  });

  it("has at least one delivery documented end-to-end (signature + GPS + photo)", () => {
    const full = delivered.find((o) => o.pod_signature && o.pod_lat != null && o.photos?.length);
    expect(full, "no fully-documented delivery in the demo data").toBeDefined();
    expect(full!.pod_signature).toMatch(/^data:image\//);
    expect(full!.pod_accuracy).toBeGreaterThan(0);
  });

  it("stores any signature it has as a real image data URL", () => {
    for (const o of delivered.filter((x) => x.pod_signature)) {
      expect(o.pod_signature, `#${o.order_no}`).toMatch(/^data:image\//);
    }
  });

  it("never records proof on an undelivered order", () => {
    for (const o of orders.filter((x) => x.stage !== "delivered")) {
      expect(o.pod_received_by, `#${o.order_no} shouldn't have POD`).toBeNull();
    }
  });
});

describe("re-delivery linkage", () => {
  it("links the repeat back to the original with a reason", () => {
    const repeat = orders.find((o) => o.redelivery_of)!;
    expect(repeat.redelivery_reason).toBeTruthy();
    expect(orders.some((o) => o.id === repeat.redelivery_of)).toBe(true);
  });
});

describe("scheduling rules against real bookings", () => {
  it("detects a same-window clash when booking over an existing order", () => {
    const existing = orders.find((o) => o.delivery_windows && !["canceled", "rejected"].includes(o.stage))!;
    const w = checkSchedule(
      { store: existing.store, delivery_date: existing.delivery_date, delivery_windows: existing.delivery_windows },
      orders,
    );
    expect(w.map((x) => x.code)).toContain("same_window");
  });

  it("passes a clean slot at a quiet store", () => {
    // Far-future date at a store with nothing booked → no warnings.
    expect(checkSchedule({ store: "Edinburg", delivery_date: "2099-01-05", delivery_windows: "0900-1100" }, orders)).toEqual([]);
  });

  it("flags a window outside working hours", () => {
    const w = checkSchedule({ store: "Edinburg", delivery_date: "2099-01-05", delivery_windows: "0600-0700" }, orders);
    expect(w.map((x) => x.code)).toContain("outside_hours");
  });
});

describe("driver route + conflicts", () => {
  it("sequences a driver's stops by window", () => {
    const mine = orders.filter((o) => o.assigned_driver === "Diego Driver" && o.delivery_windows);
    const seq = routeOrder(mine);
    const starts = seq.map((o) => parseWindow(o.delivery_windows)![0]);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("does not double-book any driver in the demo data", () => {
    // The seeded data should be internally consistent.
    for (const o of orders) {
      const clashes = windowConflicts(
        { id: o.id, assigned_driver: o.assigned_driver, delivery_date: o.delivery_date, delivery_windows: o.delivery_windows },
        orders,
      );
      expect(clashes, `#${o.order_no} double-booked with #${clashes.map((c) => c.order_no)}`).toHaveLength(0);
    }
  });
});

describe("permissions across the demo team", () => {
  it("gives every seeded user a usable role", () => {
    for (const u of users) expect(["admin", "manager", "sales", "warehouse", "driver", "logistics"]).toContain(u.role);
  });

  it("keeps the role matrix sane", () => {
    const mgr = users.find((u) => u.role === "manager")!;
    const sales = users.find((u) => u.role === "sales")!;
    expect(hasCap(mgr, "approve")).toBe(true);
    expect(hasCap(sales, "approve")).toBe(false);
    expect(hasCap(sales, "create")).toBe(true);
  });

  it("has at least one driver to assign work to", () => {
    expect(driverNames(users).length).toBeGreaterThanOrEqual(2);
  });
});

describe("exports and formatting", () => {
  it("builds a full CSV column set for every order", () => {
    const width = deliveryColumns(orders[0]).length;
    for (const o of orders) expect(deliveryColumns(o).length).toBe(width);
  });

  it("formats fees as money", () => {
    const withFee = orders.find((o) => (o.delivery_fee ?? 0) > 0)!;
    expect(fmtMoney(withFee.delivery_fee)).toMatch(/^\$\d+\.\d{2}$/);
  });
});

describe("date-range filtering", () => {
  it("returns a subset for a narrow window and everything for a wide one", () => {
    expect(inDateRange(orders, "1900-01-01", "2999-01-01").length).toBe(orders.length);
    expect(inDateRange(orders, "2999-01-01", "2999-12-31").length).toBe(0);
  });
});

describe("notifications", () => {
  it("targets real users and real orders", () => {
    const notifs = demoNotifications(orders);
    expect(notifs.length).toBeGreaterThan(0);
    for (const n of notifs) {
      expect(users.some((u) => u.id === n.user_id), `notif for unknown user ${n.user_id}`).toBe(true);
      expect(orders.some((o) => o.id === n.delivery_id)).toBe(true);
    }
  });
});

// D-NEXT. El CI del PR #7 falló en "finds past-due orders that aren't finished" a las 03:57
// UTC y en local pasaba. `iso()` de demo-data fechaba con el reloj de la MÁQUINA y
// `isOverdue` compara contra el hoy del NEGOCIO (America/Chicago, `todayISO`): entre la
// medianoche UTC y la de Chicago la máquina va un día por delante, "ayer" se convertía en
// "hoy" y los pedidos de ayer dejaban de estar vencidos. Esta prueba fija el reloj en esa
// ventana Y pone la máquina en UTC, como el runner: con el reloj solo no basta, porque en una
// máquina que ya esté en el huso de Chicago (la del dueño) el bug no se ve. Con el código de
// main da 1; con el arreglo sigue dando ≥ 2.
describe("la demo fecha con el día del negocio, no con el de la máquina", () => {
  const tzAntes = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (tzAntes === undefined) delete process.env.TZ; else process.env.TZ = tzAntes;
  });

  it("entre medianoche UTC y medianoche de Chicago, los pedidos de ayer siguen vencidos", () => {
    process.env.TZ = "UTC"; // Node aplica el cambio a las fechas que se creen a partir de aquí
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T03:57:00Z")); // 22:57 del 4 en Chicago; ya el 5 en UTC
    expect(new Date().getTimezoneOffset(), "la máquina tiene que estar en UTC para reproducirlo").toBe(0);
    const late = overdueOrders(demoDeliveries(demoSettings()));
    expect(late.length).toBeGreaterThanOrEqual(2);
    // Y ninguno lleva la fecha de la máquina como "hoy": todos son anteriores al 4.
    for (const o of late) expect(o.delivery_date!.slice(0, 10) < "2026-09-04").toBe(true);
  });
});
