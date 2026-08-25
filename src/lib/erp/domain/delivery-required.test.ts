import { describe, it, expect } from "vitest";
import {
  missingFields,
  submitBlockers,
  missingKeys,
  orderTypeRule,
  isStoreToStore,
  type RequiredOrder,
  type OrderTypeRules,
} from "./delivery-required";

const full: RequiredOrder = {
  order_type: "Customer",
  store: "RDZ McAllen",
  pickup_name: "Warehouse",
  pickup_address: "1 Depot Rd",
  delivery_address: "9 Elm St",
  contact: "Ana",
  delivery_phone: "956-555-1234",
  delivery_date: "2026-09-01",
  delivery_windows: "0830-1200",
  est_pallets: 3,
  invoice_num: "INV-1",
  delivery_fee: 140,
};
const keys = (d: RequiredOrder, r?: OrderTypeRules) => missingFields(d, r).map((m) => m.key);

describe("orderTypeRule fallbacks", () => {
  it("treats Intertienda / Intra-Tienda as store-to-store needing any one document", () => {
    expect(orderTypeRule("Intertienda")).toMatchObject({ storeToStore: true, docRef: "any" });
    expect(orderTypeRule("Intra-Tienda")).toMatchObject({ storeToStore: true, docRef: "any" });
  });

  it("treats pickup-flavoured types as store-to-store needing no document", () => {
    for (const t of ["Transfer", "Will Call", "PU", "pick-up"]) {
      expect(orderTypeRule(t)).toMatchObject({ storeToStore: true, docRef: "none" });
    }
  });

  it("does NOT treat Customer as a pickup — it is the standard delivery", () => {
    expect(orderTypeRule("Customer")).toMatchObject({ storeToStore: false, docRef: "invoice" });
    expect(isStoreToStore("Customer")).toBe(false);
  });

  it("defaults an unknown or blank type to a customer delivery", () => {
    expect(orderTypeRule("WeirdNewType")).toMatchObject({ storeToStore: false, docRef: "invoice" });
    expect(orderTypeRule("")).toMatchObject({ storeToStore: false, docRef: "invoice" });
    expect(orderTypeRule(null)).toMatchObject({ storeToStore: false, docRef: "invoice" });
  });

  it("prefers an explicitly configured rule over the keyword fallback", () => {
    const rules = { Transfer: { docRef: "estimate", storeToStore: true } } as unknown as OrderTypeRules;
    expect(orderTypeRule("Transfer", rules).docRef).toBe("estimate");
  });
});

describe("missingFields", () => {
  it("reports nothing for a complete customer order", () => {
    expect(keys(full)).toEqual([]);
  });

  it("lists every always-required field for an empty draft", () => {
    expect(keys({})).toEqual([
      "order_type", "store", "pickup_name", "pickup_address", "delivery_address",
      "contact", "delivery_phone", "delivery_date", "delivery_windows", "est_pallets",
    ]);
  });

  it("does not ask for a document until a type is chosen", () => {
    // Which paperwork applies depends on the type, so asking before one is picked is noise.
    expect(keys({})).not.toContain("invoice_num");
    expect(keys({})).not.toContain("doc_ref");
  });

  it("treats whitespace-only values as empty", () => {
    expect(keys({ ...full, store: "   ", contact: "  " })).toEqual(["store", "contact"]);
  });

  it("skips contact and phone on a store-to-store move", () => {
    // No external customer exists to call.
    const s2s = { ...full, order_type: "Intertienda", contact: null, delivery_phone: null, po2: "PO-9" };
    expect(keys(s2s)).toEqual([]);
  });
});

describe("pallets and fee edge cases", () => {
  it("treats zero or null pallets as missing", () => {
    expect(keys({ ...full, est_pallets: 0 })).toEqual(["est_pallets"]);
    expect(keys({ ...full, est_pallets: null })).toEqual(["est_pallets"]);
  });

  it("accepts a zero delivery fee — a free delivery is a real choice", () => {
    expect(keys({ ...full, delivery_fee: 0 })).toEqual([]);
  });

  it("treats a null delivery fee as missing on an invoice-type order", () => {
    expect(keys({ ...full, delivery_fee: null })).toEqual(["delivery_fee"]);
  });
});

describe("phone validation", () => {
  it("requires at least 7 digits", () => {
    expect(keys({ ...full, delivery_phone: "555" })).toEqual(["delivery_phone"]);
  });

  it("ignores punctuation when counting digits", () => {
    expect(keys({ ...full, delivery_phone: "(956) 555-1234" })).toEqual([]);
  });
});

describe("document reference by type", () => {
  it('docRef "none" requires no paperwork at all', () => {
    const t = { ...full, order_type: "Transfer", contact: null, delivery_phone: null, invoice_num: null, delivery_fee: null };
    expect(keys(t)).toEqual([]);
  });

  it('docRef "any" accepts a PO, an SO or an invoice', () => {
    const base = { ...full, order_type: "Intertienda", contact: null, delivery_phone: null, invoice_num: null, po2: null, so_num: null };
    expect(keys(base)).toEqual(["doc_ref"]);
    expect(keys({ ...base, po2: "PO-1" })).toEqual([]);
    expect(keys({ ...base, so_num: "SO-1" })).toEqual([]);
    expect(keys({ ...base, invoice_num: "INV-1" })).toEqual([]);
  });

  it('docRef "po" demands the PO specifically, not just any document', () => {
    // The fallback for Intertienda is "any", but a CONFIGURED rule can require the PO. An order
    // carrying only an invoice used to pass here and then fail a separate auto-approval rule that
    // needs a PO — landing in Pending with no explanation.
    const rules = { Intertienda: { docRef: "po", storeToStore: true } } as unknown as OrderTypeRules;
    const d = { ...full, order_type: "Intertienda", contact: null, delivery_phone: null, invoice_num: "INV-1", po2: null };
    expect(keys(d)).toEqual([]); // fallback "any" is satisfied by the invoice
    expect(keys(d, rules)).toEqual(["po2"]); // configured "po" is not
  });
});

describe("submitBlockers — the hard gate", () => {
  it("blocks only on what makes an order unplannable or unbillable", () => {
    // Everything else stays a dismissible warning by design.
    expect(submitBlockers({}).map((m) => m.key)).toEqual(["est_pallets"]);
    expect(submitBlockers({ ...full, invoice_num: null }).map((m) => m.key)).toEqual(["invoice_num"]);
  });

  it("does NOT block on a missing phone, contact or fee", () => {
    expect(submitBlockers({ ...full, delivery_phone: "555" })).toEqual([]);
    expect(submitBlockers({ ...full, contact: null })).toEqual([]);
    expect(submitBlockers({ ...full, delivery_fee: null })).toEqual([]);
  });

  it("is always a subset of missingFields", () => {
    for (const d of [{}, full, { ...full, est_pallets: 0 }, { ...full, invoice_num: null }]) {
      const all = new Set(missingFields(d).map((m) => m.key));
      for (const b of submitBlockers(d)) expect(all.has(b.key)).toBe(true);
    }
  });
});

describe("missingKeys", () => {
  it("expands doc_ref so the form highlights both candidate fields", () => {
    const d = { ...full, order_type: "Intertienda", contact: null, delivery_phone: null, invoice_num: null, po2: null };
    const k = missingKeys(d);
    expect(k.has("doc_ref")).toBe(true);
    expect(k.has("po2")).toBe(true);
    expect(k.has("invoice_num")).toBe(true);
    // SO # is optional for these orders, so it is never highlighted.
    expect(k.has("so_num")).toBe(false);
  });
});

describe("bilingual labels", () => {
  it("gives every missing field both languages, and they differ", () => {
    for (const m of missingFields({})) {
      expect(m.en.length).toBeGreaterThan(0);
      expect(m.es.length).toBeGreaterThan(0);
      expect(m.es).not.toBe(m.en);
    }
  });
});
