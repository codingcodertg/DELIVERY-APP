// Warehouse-queue port checks (ADR 0010).
//
// Same caveat as driver-queue: in the source these rules are an inline filter inside a client
// component, so there was nothing to import and dump expectations from. They were transcribed and
// are covered here by cases pinning each rule's intent. That is a weaker check than the
// differential tests used for the exported modules, and is recorded rather than glossed over.
import { test, expect } from "vitest";
import {
  atStore,
  effectiveStore,
  scopedForWarehouse,
  warehouseRows,
  loadSheetOrders,
  ACTIVE_LOAD_STAGES,
  loadSheetGroups,
  windowStartMinutes,
  stopRef,
  type LoadSheetOrder,
} from "./warehouse-queue";

const PHARR = "RDZ Pharr";
const PHARR_ADDR = "123 Main St, Pharr TX";

function order(over: Partial<LoadSheetOrder> = {}): LoadSheetOrder {
  return {
    order_no: 1,
    stage: "approved",
    store: PHARR,
    invoice_num: "INV-100",
    delivery_date: "2026-03-10",
    pickup_name: null,
    pickup_address: null,
    ...over,
  };
}

// --- atStore ----------------------------------------------------------------
test("an order sold from this branch is at this branch", () => {
  expect(atStore(order(), PHARR)).toBe(true);
});

test("an order sold from another branch is not, by itself, at this one", () => {
  expect(atStore(order({ store: "RDZ McAllen" }), PHARR)).toBe(false);
});

test("an order picked up here IS this warehouse's work, whoever sold it", () => {
  // The whole reason atStore is not just `d.store === store`: an Intertienda sold from McAllen but
  // collected at Pharr is Pharr's pallets to stage.
  expect(atStore(order({ store: "RDZ McAllen", pickup_name: PHARR }), PHARR)).toBe(true);
});

test("a pickup address matching the branch address also counts", () => {
  expect(
    atStore(order({ store: "RDZ McAllen", pickup_address: PHARR_ADDR }), PHARR, PHARR_ADDR)
  ).toBe(true);
});

test("pickup name and address are compared trimmed", () => {
  expect(atStore(order({ store: "RDZ McAllen", pickup_name: "  RDZ Pharr  " }), PHARR)).toBe(true);
  expect(
    atStore(order({ store: "RDZ McAllen", pickup_address: "  " + PHARR_ADDR + " " }), PHARR, PHARR_ADDR)
  ).toBe(true);
});

test("an empty branch address never matches an empty pickup address", () => {
  // Otherwise every order with no pickup address would land in every store's queue.
  expect(atStore(order({ store: "RDZ McAllen", pickup_address: "" }), PHARR, "")).toBe(false);
  expect(atStore(order({ store: "RDZ McAllen", pickup_address: null }), PHARR, "")).toBe(false);
});

test("no store selected means no narrowing", () => {
  expect(atStore(order({ store: "RDZ McAllen" }), "")).toBe(true);
});

// --- effectiveStore ---------------------------------------------------------
test("a warehouse worker is locked to their own branch", () => {
  const r = effectiveStore({ role: "warehouse", realRole: "warehouse", ownStore: PHARR, picked: "RDZ McAllen" });
  expect(r).toEqual({ store: PHARR, locked: true, unassigned: false });
});

test("an admin previewing warehouse is not locked, and keeps the picker", () => {
  const r = effectiveStore({ role: "warehouse", realRole: "admin", ownStore: PHARR, picked: "RDZ McAllen" });
  expect(r).toEqual({ store: "RDZ McAllen", locked: false, unassigned: false });
});

test("a warehouse worker with no branch is flagged, not silently shown everything", () => {
  // This is the case v4_76 exists to prevent, and it must still be visible when it happens.
  const r = effectiveStore({ role: "warehouse", realRole: "warehouse", ownStore: null });
  expect(r).toEqual({ store: "", locked: true, unassigned: true });
});

test("blank-string and whitespace branches count as unassigned", () => {
  expect(effectiveStore({ role: "warehouse", realRole: "warehouse", ownStore: "   " }).unassigned).toBe(true);
});

test("an office role visiting the queue uses the picker", () => {
  const r = effectiveStore({ role: "manager", realRole: "manager", picked: PHARR });
  expect(r).toEqual({ store: PHARR, locked: false, unassigned: false });
});

// --- scoping ----------------------------------------------------------------
test("the queue narrows to the branch", () => {
  const out = scopedForWarehouse({
    deliveries: [order(), order({ order_no: 2, store: "RDZ McAllen" })],
    store: PHARR,
    today: "2026-03-10",
  });
  expect(out.map((d) => d.order_no)).toEqual([1]);
});

test("older work drops out of the recent window", () => {
  const out = scopedForWarehouse({
    deliveries: [order({ delivery_date: "2025-06-01" })],
    store: PHARR,
    today: "2026-03-10",
  });
  expect(out).toHaveLength(0);
});

test("invoice search reaches past the window, and still respects the branch", () => {
  const mine = order({ delivery_date: "2025-06-01", invoice_num: "INV-777" });
  const theirs = order({ order_no: 2, store: "RDZ McAllen", delivery_date: "2025-06-01", invoice_num: "INV-777" });
  const out = scopedForWarehouse({
    deliveries: [mine, theirs],
    store: PHARR,
    query: "777",
    today: "2026-03-10",
  });
  expect(out.map((d) => d.order_no)).toEqual([1]);
});

test("an admin previewing the role sees the full history", () => {
  const out = scopedForWarehouse({
    deliveries: [order({ delivery_date: "2024-01-01" })],
    store: PHARR,
    adminAllAccess: true,
    today: "2026-03-10",
  });
  expect(out).toHaveLength(1);
});

// --- tabs and load sheets ---------------------------------------------------
test("the all tab is newest first; a stage tab is that stage only", () => {
  const scoped = [order({ order_no: 3, stage: "ready" }), order({ order_no: 8, stage: "approved" })];
  expect(warehouseRows(scoped, "all").map((d) => d.order_no)).toEqual([8, 3]);
  expect(warehouseRows(scoped, "ready").map((d) => d.order_no)).toEqual([3]);
});

test("warehouseRows does not mutate the scoped list", () => {
  const scoped = [order({ order_no: 3 }), order({ order_no: 8 })];
  const copy = JSON.parse(JSON.stringify(scoped));
  warehouseRows(scoped, "all");
  expect(JSON.parse(JSON.stringify(scoped))).toEqual(copy);
});

test("load sheets cover the day's active work at this branch only", () => {
  const rows = loadSheetOrders(
    [
      order({ order_no: 1, stage: "ready" }),
      order({ order_no: 2, stage: "delivered" }),          // already done
      order({ order_no: 3, stage: "ready", delivery_date: "2026-03-11" }), // another day
      order({ order_no: 4, stage: "ready", store: "RDZ McAllen" }),        // another branch
      order({ order_no: 5, stage: "picked_up" }),
    ],
    "2026-03-10",
    PHARR
  );
  expect(rows.map((d) => d.order_no)).toEqual([1, 5]);
});

test("a canceled or rejected order never reaches a load sheet", () => {
  expect(ACTIVE_LOAD_STAGES).not.toContain("canceled");
  expect(ACTIVE_LOAD_STAGES).not.toContain("rejected");
  expect(ACTIVE_LOAD_STAGES).not.toContain("delivered");
});

// --- load sheet grouping ----------------------------------------------------
test("one group per driver, sorted by name", () => {
  const groups = loadSheetGroups([
    order({ order_no: 1, assigned_driver: "Beto Cruz" }),
    order({ order_no: 2, assigned_driver: "Ana Reyes" }),
    order({ order_no: 3, assigned_driver: "Ana Reyes" }),
  ]);
  expect(groups.map((g) => g.driver)).toEqual(["Ana Reyes", "Beto Cruz"]);
  expect(groups[0].stops).toHaveLength(2);
});

test("the unassigned page comes LAST, which the source got backwards", () => {
  // The source groups these under a " " sentinel and comments that it "sorts unassigned last". It
  // does not: a space sorts before every name, so the page nobody drives printed on top of the
  // stack. Implemented to the stated intent — see the note on loadSheetGroups.
  const groups = loadSheetGroups([
    order({ order_no: 1, assigned_driver: null }),
    order({ order_no: 2, assigned_driver: "Ana Reyes" }),
    order({ order_no: 3, assigned_driver: "Zoe Vega" }),
  ]);
  expect(groups.map((g) => g.driver)).toEqual(["Ana Reyes", "Zoe Vega", "Unassigned"]);
  expect(groups[2].unassigned).toBe(true);
});

test("a blank or whitespace driver counts as unassigned, not as its own page", () => {
  const groups = loadSheetGroups([
    order({ order_no: 1, assigned_driver: "" }),
    order({ order_no: 2, assigned_driver: "   " }),
    order({ order_no: 3, assigned_driver: null }),
  ]);
  expect(groups).toHaveLength(1);
  expect(groups[0].unassigned).toBe(true);
  expect(groups[0].stops).toHaveLength(3);
});

test("stops follow the planned route sequence when there is one", () => {
  const groups = loadSheetGroups([
    order({ order_no: 1, assigned_driver: "Ana", route_seq: 3 }),
    order({ order_no: 2, assigned_driver: "Ana", route_seq: 1 }),
    order({ order_no: 3, assigned_driver: "Ana", route_seq: 2 }),
  ]);
  expect(groups[0].stops.map((s) => s.order_no)).toEqual([2, 3, 1]);
});

test("unsequenced stops fall back to earliest delivery window", () => {
  const groups = loadSheetGroups([
    order({ order_no: 1, assigned_driver: "Ana", delivery_windows: "1300-1700" }),
    order({ order_no: 2, assigned_driver: "Ana", delivery_windows: "0830-1200" }),
  ]);
  expect(groups[0].stops.map((s) => s.order_no)).toEqual([2, 1]);
});

test("a sequenced stop always precedes an unsequenced one", () => {
  const groups = loadSheetGroups([
    order({ order_no: 1, assigned_driver: "Ana", delivery_windows: "0700-0800" }),
    order({ order_no: 2, assigned_driver: "Ana", route_seq: 9, delivery_windows: "1600-1700" }),
  ]);
  expect(groups[0].stops.map((s) => s.order_no)).toEqual([2, 1]);
});

test("pallets are totalled per driver, preferring actual over estimated", () => {
  const groups = loadSheetGroups([
    order({ order_no: 1, assigned_driver: "Ana", est_pallets: 5, actual_pallets: 3 }),
    order({ order_no: 2, assigned_driver: "Ana", est_pallets: 4, actual_pallets: null }),
    order({ order_no: 3, assigned_driver: "Ana", est_pallets: null, actual_pallets: null }),
  ]);
  expect(groups[0].pallets).toBe(7);
});

test("windowStartMinutes reads the first HHMM, and gives up loudly", () => {
  expect(windowStartMinutes("0830-1200")).toBe(510);
  expect(windowStartMinutes("1300-1700")).toBe(780);
  expect(windowStartMinutes(null)).toBe(9999);
  expect(windowStartMinutes("All Day")).toBe(9999);
});

test("stopRef falls back through the source's reference order", () => {
  expect(stopRef(order({ invoice_num: "INV-1", po2: "PO-1" }))).toBe("INV-1");
  expect(stopRef(order({ invoice_num: null, po2: "PO-1" }))).toBe("PO-1");
  expect(stopRef(order({ invoice_num: null, po2: null, so_num: "SO-1" }))).toBe("SO-1");
  expect(stopRef(order({ invoice_num: null, po2: null, so_num: null, estimate_num: "EST-1" }))).toBe("EST-1");
  expect(stopRef(order({ invoice_num: null }))).toBe("—");
});

test("loadSheetGroups does not mutate its input", () => {
  const input = [
    order({ order_no: 1, assigned_driver: "Ana", route_seq: 3 }),
    order({ order_no: 2, assigned_driver: "Ana", route_seq: 1 }),
  ];
  const copy = JSON.parse(JSON.stringify(input));
  loadSheetGroups(input);
  expect(JSON.parse(JSON.stringify(input))).toEqual(copy);
});
