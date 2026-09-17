import { describe, it, expect } from "vitest";
import { missingFields, missingKeys, isStoreToStore, orderTypeRule, submitBlockers } from "@/lib/required";
import type { OrderTypeRule } from "@/lib/types";

// The default rule set the app ships with.
const RULES: Record<string, OrderTypeRule> = {
  Customer:    { storeToStore: false, docRef: "invoice" },
  Intertienda: { storeToStore: true,  docRef: "any" },
  Transfer:    { storeToStore: true,  docRef: "none" },
};

// A fully-valid regular customer delivery.
const complete = {
  order_type: "Customer",
  store: "McAllen",
  pickup_name: "RDZ McAllen Warehouse",
  pickup_address: "2400 N 23rd St, McAllen TX",
  delivery_name: "Rio Tile Co.",
  delivery_address: "123 Main St, McAllen TX",
  contact: "Ana",
  delivery_phone: "9561234567",
  delivery_date: "2026-07-20",
  delivery_windows: "0900-1100",
  est_pallets: 4,
  invoice_num: "INV-1",
  delivery_fee: 75,
};
const keys = (d: object, r = RULES) => missingFields(d, r).map((m) => m.key).sort();

describe("orderTypeRule + isStoreToStore", () => {
  it("uses the explicit rule when configured", () => {
    expect(orderTypeRule("Customer", RULES)).toEqual({ storeToStore: false, docRef: "invoice" });
    expect(isStoreToStore("Intertienda", RULES)).toBe(true);
    expect(isStoreToStore("Transfer", RULES)).toBe(true);
    expect(isStoreToStore("Customer", RULES)).toBe(false);
  });

  it("an explicit rule overrides the name (a custom store-to-store type)", () => {
    const rules = { "Yard Move": { storeToStore: true, docRef: "none" as const } };
    expect(isStoreToStore("Yard Move", rules)).toBe(true);
  });

  it("falls back to keyword defaults for a type with no rule", () => {
    expect(isStoreToStore("Intra-Tienda")).toBe(true);   // "tienda"
    expect(isStoreToStore("Transfer")).toBe(true);
    expect(isStoreToStore("Will Call")).toBe(true);
    expect(isStoreToStore("Customer")).toBe(false);       // NOT a pickup anymore
    expect(orderTypeRule("Delivery").docRef).toBe("invoice");
  });
});

describe("missingFields — always-required", () => {
  it("passes a complete delivery", () => {
    expect(missingFields(complete, RULES)).toEqual([]);
  });

  it("flags every required field when the order is empty", () => {
    expect(keys({})).toEqual([
      "contact", "delivery_address", "delivery_date", "delivery_phone",
      "delivery_windows", "est_pallets", "order_type", "pickup_address", "pickup_name", "store",
    ]);
  });

  it("flags a missing pickup name or address", () => {
    expect(keys({ ...complete, pickup_name: "" })).toContain("pickup_name");
    expect(keys({ ...complete, pickup_address: "" })).toContain("pickup_address");
  });

  it("flags a missing dropoff address (name is optional)", () => {
    expect(keys({ ...complete, delivery_name: null })).not.toContain("delivery_name");
    expect(keys({ ...complete, delivery_address: null })).toContain("delivery_address");
  });

  it("flags a missing contact name and phone on a customer order", () => {
    expect(keys({ ...complete, contact: "  " })).toContain("contact");
    expect(keys({ ...complete, delivery_phone: null })).toContain("delivery_phone");
    expect(keys({ ...complete, delivery_phone: "555" })).toContain("delivery_phone");
  });

  it("accepts a formatted phone number", () => {
    expect(missingFields({ ...complete, delivery_phone: "(956) 555-0142" }, RULES)).toEqual([]);
  });

  it("flags a missing order type / store", () => {
    expect(keys({ ...complete, order_type: "   " })).toContain("order_type");
    expect(keys({ ...complete, store: null })).toContain("store");
  });

  it("flags a missing delivery date or window and bad pallets", () => {
    expect(keys({ ...complete, delivery_date: null })).toContain("delivery_date");
    expect(keys({ ...complete, delivery_windows: "  " })).toContain("delivery_windows");
    expect(keys({ ...complete, est_pallets: 0 })).toContain("est_pallets");
  });
});

describe("missingFields — document reference by rule", () => {
  it("Customer (docRef invoice) requires the customer invoice", () => {
    expect(keys({ ...complete, invoice_num: "" })).toContain("invoice_num");
  });

  it("Intertienda (docRef any) accepts ANY ONE of PO/SO/Invoice", () => {
    const base = { ...complete, order_type: "Intertienda", invoice_num: "", so_num: "", po2: "" };
    expect(keys(base)).toContain("doc_ref");
    expect(missingFields({ ...base, po2: "PO-1" }, RULES)).toEqual([]);
    expect(missingFields({ ...base, so_num: "SO-1" }, RULES)).toEqual([]);
    expect(missingFields({ ...base, invoice_num: "INV-1" }, RULES)).toEqual([]);
  });

  it("store-to-store types collect no contact/phone", () => {
    // No contact + no phone, but Intertienda/Transfer don't need them.
    const stripped = { ...complete, contact: "", delivery_phone: "" };
    expect(missingFields({ ...stripped, order_type: "Intertienda", po2: "PO-1" }, RULES)).toEqual([]);
    expect(missingFields({ ...stripped, order_type: "Transfer", invoice_num: "" }, RULES)).toEqual([]);
  });

  it("Transfer (docRef none) needs no paperwork", () => {
    expect(missingFields({ ...complete, order_type: "Transfer", invoice_num: "" }, RULES)).toEqual([]);
  });
});

describe("missingKeys", () => {
  it("lights up PO and Invoice (but not the optional SO) when doc_ref is missing", () => {
    const k = missingKeys({ ...complete, order_type: "Intertienda", invoice_num: "", so_num: "", po2: "" }, RULES);
    expect(k.has("po2")).toBe(true);
    expect(k.has("so_num")).toBe(false);
    expect(k.has("invoice_num")).toBe(true);
  });

  it("is empty for a complete order", () => {
    expect(missingKeys(complete, RULES).size).toBe(0);
  });
});

// ---- docRef: "po" -----------------------------------------------------------
describe("a type that requires the PO specifically", () => {
  const rules = { Intertienda: { storeToStore: true, docRef: "po" as const, homeIsDestination: true } };
  const base = {
    order_type: "Intertienda", store: "RDZ Brownsville",
    pickup_name: "RDZ Brownsville", pickup_address: "3913 North Expy, Brownsville",
    delivery_address: "1102 W Expressway 83, Weslaco",
    delivery_date: "2026-08-18", delivery_windows: "0830-1730", est_pallets: 6,
  };

  it("asks for the PO when it's missing", () => {
    expect(missingFields(base, rules).map((m) => m.key)).toContain("po2");
  });

  it("is NOT satisfied by an invoice alone", () => {
    // The exact shape of FQ503: an invoice, no PO. Under the old "any one"
    // rule it passed validation and then silently failed to auto-approve,
    // because a separate rule wanted the PO. Now one rule decides.
    expect(missingFields({ ...base, invoice_num: "178156" }, rules).map((m) => m.key)).toContain("po2");
  });

  it("is satisfied by the PO", () => {
    expect(missingFields({ ...base, po2: "PO-991" }, rules).map((m) => m.key)).not.toContain("po2");
  });

  it("still collects no customer contact for a store-to-store type", () => {
    const keys = missingFields({ ...base, po2: "PO-991" }, rules).map((m) => m.key);
    expect(keys).not.toContain("contact");
    expect(keys).not.toContain("delivery_phone");
  });

  it("leaves the other types alone", () => {
    const all = { Customer: { storeToStore: false, docRef: "invoice" as const }, ...rules };
    const cust = missingFields({ ...base, order_type: "Customer", contact: "Ana", delivery_phone: "9561234567", delivery_fee: 0, invoice_num: "1" }, all);
    expect(cust.map((m) => m.key)).toEqual([]);
  });
});

// ---- submitBlockers (D-049) --------------------------------------------------
// The hard gate at draft → pending. Only pallets and the document reference
// block; every other required field (contact, addresses, dates…) is a
// dismissible warning elsewhere and must NOT show up here.
describe("submitBlockers", () => {
  it("is empty for a complete order — a draft with everything filled submits clean", () => {
    expect(submitBlockers(complete, RULES, [])).toEqual([]);
  });

  it("blocks on missing pallets even though a draft can be saved without them", () => {
    // This is the exact bug: a draft with no pallets saved fine (correct —
    // draft save skips validation entirely), and nothing stopped it from
    // then being submitted to approval with the same gap.
    const noPallets = { ...complete, est_pallets: null };
    expect(submitBlockers(noPallets, RULES, []).map((m) => m.key)).toEqual(["est_pallets"]);
  });

  it("blocks on pallets = 0, not just null/undefined", () => {
    expect(submitBlockers({ ...complete, est_pallets: 0 }, RULES, []).map((m) => m.key)).toContain("est_pallets");
  });

  it("blocks a Customer order with no invoice (the existing doc rule still fires here)", () => {
    expect(submitBlockers({ ...complete, invoice_num: "" }, RULES, []).map((m) => m.key)).toEqual(["invoice_num"]);
  });

  it("blocks an Intertienda order with none of PO/SO/Invoice", () => {
    const base = { ...complete, order_type: "Intertienda", invoice_num: "", so_num: "", po2: "" };
    expect(submitBlockers(base, RULES, []).map((m) => m.key)).toEqual(["doc_ref"]);
  });

  it("does not block on the delivery fee — that stays a soft warning, not part of D-049", () => {
    const noFee = { ...complete, delivery_fee: null };
    expect(submitBlockers(noFee, RULES, [])).toEqual([]);
    expect(missingFields(noFee, RULES).map((m) => m.key)).toContain("delivery_fee"); // still soft-warned elsewhere
  });

  it("does not block on contact/phone/addresses — those stay dismissible", () => {
    const messyButHasPalletsAndDoc = { ...complete, contact: "", delivery_phone: "", pickup_address: "" };
    expect(submitBlockers(messyButHasPalletsAndDoc, RULES, [])).toEqual([]);
  });

  it("both missing at once are reported together, not one at a time", () => {
    const both = { ...complete, est_pallets: null, invoice_num: "" };
    expect(submitBlockers(both, RULES, []).map((m) => m.key).sort()).toEqual(["est_pallets", "invoice_num"]);
  });

  it("a Transfer order (docRef none) blocks only on pallets, never on paperwork", () => {
    expect(submitBlockers({ ...complete, order_type: "Transfer", est_pallets: null, invoice_num: "" }, RULES, []).map((m) => m.key)).toEqual(["est_pallets"]);
  });
});
