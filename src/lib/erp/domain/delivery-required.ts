// Required-field rules for a delivery order. Ported from the deliveries app (ADR 0010).
// Framework-free (ADR 0006).
//
// Always required: order type · store · pickup name + address · delivery address · delivery date +
// window · est. pallets. Contact name + phone too, EXCEPT on a store-to-store move (no external
// customer to contact).
//
// The document reference depends on the order type's configured rule:
//   docRef "po"      → PO # specifically
//   docRef "any"     → any one of PO / SO / Invoice
//   docRef "invoice" → Invoice # AND a delivery fee (0 is valid; only blank is missing)
//   docRef "none"    → nothing required
//
// TWO TIERS, deliberately. missingFields() is a SOFT list — the rep sees what is empty and may
// continue anyway, which is right for most fields (a typo'd phone should not make an order
// un-submittable). submitBlockers() is the hard gate: pallets and the document reference actually
// refuse, because without them there is nothing to size a truck for and nothing to reconcile
// against. Both are derived from the same function so only one place decides what "missing" means.

export interface MissingField {
  /** Matches the form field so the UI can highlight it. */
  key: string;
  en: string;
  es: string;
}

export interface OrderTypeRule {
  storeToStore?: boolean;
  docRef?: "po" | "any" | "invoice" | "none";
  homeIsDestination?: boolean;
}

export type OrderTypeRules = Record<string, OrderTypeRule> | undefined;

export interface RequiredOrder {
  order_type?: string | null;
  store?: string | null;
  pickup_name?: string | null;
  pickup_address?: string | null;
  delivery_address?: string | null;
  contact?: string | null;
  delivery_phone?: string | null;
  delivery_date?: string | null;
  delivery_windows?: string | null;
  est_pallets?: number | null;
  po2?: string | null;
  so_num?: string | null;
  invoice_num?: string | null;
  delivery_fee?: number | null;
}

/**
 * Keyword fallback for a type with no configured rule (a legacy type, or one an admin added without
 * setting rules). "Customer" is deliberately NOT treated as a pickup — it is the standard delivery.
 */
function fallbackRule(orderType: string): OrderTypeRule {
  const s = orderType.toLowerCase();
  if (/intra|tienda/.test(s)) return { storeToStore: true, docRef: "any" };
  if (/pick\s*-?\s*up|will\s*call|transfer|^\s*pu\s*$/.test(s)) return { storeToStore: true, docRef: "none" };
  return { storeToStore: false, docRef: "invoice" };
}

/** The effective rule for an order type: the configured one, else a keyword-based default. */
export function orderTypeRule(orderType: string | null | undefined, rules?: OrderTypeRules): OrderTypeRule {
  const key = (orderType ?? "").trim();
  if (!key) return { storeToStore: false, docRef: "invoice" };
  const explicit = rules?.[key];
  if (explicit) return explicit;
  return fallbackRule(key);
}

/** Branch → branch move: destination is another store, no external customer contact collected. */
export const isStoreToStore = (orderType: string | null | undefined, rules?: OrderTypeRules) =>
  orderTypeRule(orderType, rules).storeToStore === true;

const filled = (v: unknown) => !!String(v ?? "").trim();

export function missingFields(d: RequiredOrder, rules?: OrderTypeRules): MissingField[] {
  const out: MissingField[] = [];

  if (!filled(d.order_type)) out.push({ key: "order_type", en: "Order Type", es: "Tipo de Orden" });
  if (!filled(d.store)) out.push({ key: "store", en: "Store (Sold From)", es: "Tienda (Vendido Desde)" });
  if (!filled(d.pickup_name)) out.push({ key: "pickup_name", en: "Pickup Name", es: "Nombre de Recolección" });
  if (!filled(d.pickup_address)) out.push({ key: "pickup_address", en: "Pickup Address", es: "Dirección de Recolección" });
  // Dropoff Name is optional — the address is what matters for the delivery.
  if (!filled(d.delivery_address))
    out.push({ key: "delivery_address", en: "Delivery Address (dropoff)", es: "Dirección de Entrega (destino)" });

  if (!isStoreToStore(d.order_type, rules)) {
    if (!filled(d.contact)) out.push({ key: "contact", en: "Contact name", es: "Nombre de Contacto" });
    // A usable phone: at least 7 digits once punctuation is stripped.
    if (String(d.delivery_phone ?? "").replace(/\D/g, "").length < 7) {
      out.push({ key: "delivery_phone", en: "Delivery Phone Number", es: "Teléfono de Entrega" });
    }
  }

  if (!filled(d.delivery_date)) out.push({ key: "delivery_date", en: "Delivery Date", es: "Fecha de Entrega" });
  if (!filled(d.delivery_windows))
    out.push({ key: "delivery_windows", en: "Delivery Time Window", es: "Ventana de Entrega" });
  if (d.est_pallets == null || Number(d.est_pallets) <= 0) {
    out.push({ key: "est_pallets", en: "Est. Pallets", es: "Pallets Estimadas" });
  }

  // Document reference, by order type. Until a type is picked we only ask for the type itself.
  const type = d.order_type;
  if (!filled(type)) return out;

  const docRef = orderTypeRule(type, rules).docRef ?? "invoice";
  if (docRef === "any") {
    if (!filled(d.po2) && !filled(d.so_num) && !filled(d.invoice_num)) {
      out.push({ key: "doc_ref", en: "PO # or Invoice # (any one)", es: "PO # o Factura # (cualquiera)" });
    }
  } else if (docRef === "po") {
    // The PO specifically, not "any one document" — an order carrying only an invoice used to pass
    // validation here and then fail a SEPARATE auto-approval rule that needs a PO, landing in
    // Pending with no explanation. This is the rule that decides.
    if (!filled(d.po2)) out.push({ key: "po2", en: "PO #", es: "PO #" });
  } else if (docRef === "invoice") {
    if (!filled(d.invoice_num)) out.push({ key: "invoice_num", en: "Invoice #", es: "Factura #" });
    // 0 is a valid fee (a free delivery); only a blank field counts as missing.
    if (d.delivery_fee == null) {
      out.push({ key: "delivery_fee", en: "Delivery Fee charged ($)", es: "Costo de Entrega cobrado ($)" });
    }
  }
  // docRef === "none": no document reference required.

  return out;
}

/** The two things whose absence makes an order unplannable or unbillable. */
const SUBMIT_BLOCKING_KEYS: ReadonlySet<string> = new Set(["est_pallets", "doc_ref", "po2", "invoice_num"]);

/** The subset of missingFields() that must hard-block a draft → pending submission or a resubmit. */
export function submitBlockers(d: RequiredOrder, rules?: OrderTypeRules): MissingField[] {
  return missingFields(d, rules).filter((m) => SUBMIT_BLOCKING_KEYS.has(m.key));
}

/** Field keys to highlight in the form. */
export function missingKeys(d: RequiredOrder, rules?: OrderTypeRules): Set<string> {
  const keys = new Set(missingFields(d, rules).map((m) => m.key));
  // "doc_ref" means a PO # or Invoice # is needed — light both up. SO # is optional for these
  // (Intertienda) orders, so it is never flagged.
  if (keys.has("doc_ref")) {
    keys.add("po2");
    keys.add("invoice_num");
  }
  return keys;
}
