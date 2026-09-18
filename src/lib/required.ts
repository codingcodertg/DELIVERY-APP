import type { Delivery, NamedLocation, OrderTypeRule } from "@/lib/types";
import { mismaDireccion, origenEsDestino } from "@/lib/order-endpoints";

// ============================================================
// Required-field rules for an order.
//
// Always required:
//   • Order Type
//   • Store (Sold From)
//   • Contact name + Delivery phone (except Intra-Tienda — no external customer)
//   • Pickup name + address
//   • Dropoff (delivery) address (dropoff name is optional)
//   • Delivery Date + Delivery Window
//   • Est. Pallets
//
// Document reference — depends on the order type:
//   • Intra-Tienda  → PO # (see the "po" rule; it used to accept any one)
//   • Transfer / Customer (picked up by the customer themselves) → optional (nothing required)
//   • Everything else (Delivery…) → Invoice # required
//
// Nothing here hard-blocks: the rep is shown exactly what's missing and asked
// whether to continue anyway.
// ============================================================

export interface MissingField {
  /** Matches the form field so the UI can highlight it. */
  key: string;
  /** True when the order is not MISSING something but CONTRADICTS itself — the same place at both
   * ends (D-267). The submit message words these differently from «still missing». */
  conflict?: boolean;
  en: string;
  es: string;
}

export type OrderTypeRules = Record<string, OrderTypeRule> | undefined;

/** Keyword-based fallback rule for a type that has no explicit rule configured
 * (a legacy type, or one an admin added without setting rules). "Customer" is
 * deliberately NOT treated as a pickup here — it's the standard delivery type. */
function fallbackRule(orderType: string): OrderTypeRule {
  const s = orderType.toLowerCase();
  if (/intra|tienda/.test(s)) return { storeToStore: true, docRef: "any" };
  if (/pick\s*-?\s*up|will\s*call|transfer|^\s*pu\s*$/.test(s)) return { storeToStore: true, docRef: "none" };
  return { storeToStore: false, docRef: "invoice" };
}

/** The effective rule for an order type: the explicit configured rule if there
 * is one, otherwise a sensible keyword-based default. */
export function orderTypeRule(orderType: string | null | undefined, rules?: OrderTypeRules): OrderTypeRule {
  const key = (orderType ?? "").trim();
  if (!key) return { storeToStore: false, docRef: "invoice" };
  const explicit = rules?.[key];
  if (explicit) return explicit;
  return fallbackRule(key);
}

/** Store-to-store move (branch → branch) — destination is another store and no
 * external customer contact is collected. */
export const isStoreToStore = (orderType: string | null | undefined, rules?: OrderTypeRules) =>
  orderTypeRule(orderType, rules).storeToStore === true;

const filled = (v: unknown) => !!String(v ?? "").trim();

export function missingFields(d: Partial<Delivery>, rules?: OrderTypeRules): MissingField[] {
  const out: MissingField[] = [];

  if (!filled(d.order_type)) out.push({ key: "order_type", en: "Order Type", es: "Tipo de Orden" });
  if (!filled(d.store)) out.push({ key: "store", en: "Store (Sold From)", es: "Tienda (Vendido Desde)" });
  if (!filled(d.pickup_name)) out.push({ key: "pickup_name", en: "Pickup Name", es: "Nombre de Recolección" });
  if (!filled(d.pickup_address)) out.push({ key: "pickup_address", en: "Pickup Address", es: "Dirección de Recolección" });
  // Dropoff Name is optional — the address is what matters for the delivery.
  if (!filled(d.delivery_address)) out.push({ key: "delivery_address", en: "Delivery Address (dropoff)", es: "Dirección de Entrega (destino)" });
  // Store-to-store moves have no external customer, so no contact/phone to collect.
  if (!isStoreToStore(d.order_type, rules)) {
    if (!filled(d.contact)) out.push({ key: "contact", en: "Contact name", es: "Nombre de Contacto" });
    // A usable phone: at least 7 digits once punctuation is stripped.
    if (String(d.delivery_phone ?? "").replace(/\D/g, "").length < 7) {
      out.push({ key: "delivery_phone", en: "Delivery Phone Number", es: "Teléfono de Entrega" });
    }
  }
  if (!filled(d.delivery_date)) out.push({ key: "delivery_date", en: "Delivery Date", es: "Fecha de Entrega" });
  if (!filled(d.delivery_windows)) out.push({ key: "delivery_windows", en: "Delivery Time Window", es: "Ventana de Entrega" });
  if (d.est_pallets == null || Number(d.est_pallets) <= 0) {
    out.push({ key: "est_pallets", en: "Est. Pallets", es: "Pallets Estimadas" });
  }

  // ---- Document reference, by order type ----
  // Which paperwork is needed is set explicitly per type (docRef rule), so
  // until a type is picked we only ask for the type itself.
  const type = d.order_type;
  if (!filled(type)) return out;

  const docRef = orderTypeRule(type, rules).docRef ?? "invoice";
  if (docRef === "any") {
    // Any one of the three is enough for a store-to-store move. SO # is not
    // required (and never flagged) — a PO # or Invoice # is what we ask for.
    if (!filled(d.po2) && !filled(d.so_num) && !filled(d.invoice_num)) {
      out.push({ key: "doc_ref", en: "PO # or Invoice # (any one)", es: "PO # o Factura # (cualquiera)" });
    }
  } else if (docRef === "po") {
    // The PO specifically, not "any one document". Intertienda used "any", so
    // an order carrying only an invoice passed validation — and then failed a
    // SEPARATE rule that auto-approval needs a PO, landing in Pending with no
    // explanation. Two rules disagreeing about the same order; this is the one
    // that now decides.
    if (!filled(d.po2)) {
      out.push({ key: "po2", en: "PO #", es: "PO #" });
    }
  } else if (docRef === "invoice") {
    // Regular customer delivery — the customer invoice is required, and the
    // delivery fee charged to the customer is mandatory (0 is allowed for a
    // free delivery; only a blank field counts as missing).
    if (!filled(d.invoice_num)) {
      out.push({ key: "invoice_num", en: "Invoice #", es: "Factura #" });
    }
    if (d.delivery_fee == null) {
      out.push({ key: "delivery_fee", en: "Delivery Fee charged ($)", es: "Costo de Entrega cobrado ($)" });
    }
  }
  // docRef === "none": no document reference required.

  return out;
}

// ------------------------------------------------------------------
// Submit-time hard gate (D-049).
//
// missingFields() above is a SOFT list: the rep sees what's empty and can
// choose "Continue anyway?" — that's deliberate for most fields (an order
// with a typo'd phone shouldn't be un-submittable). But two fields let an
// order through with no way to plan or bill it: pallets (nothing to load,
// nothing to size a truck for) and the document reference (nothing to
// reconcile against). Those two must actually refuse, not just warn.
//
// Reuses missingFields() rather than re-deriving the doc-ref branch, so
// there's exactly one place that decides what "the document is missing"
// means per order type.
// ------------------------------------------------------------------
const SUBMIT_BLOCKING_KEYS: ReadonlySet<string> = new Set(["est_pallets", "doc_ref", "po2", "invoice_num"]);

/** The subset of missingFields() that must hard-block a draft → pending
 * submission (or a resubmit). Everything else stays a dismissible warning.
 * `tiendas` (settings.stores) is required: the same-store rule compares the
 * origin store's saved address too (D-276). */
export function submitBlockers(d: Partial<Delivery>, rules: OrderTypeRules, tiendas: NamedLocation[]): MissingField[] {
  return [...missingFields(d, rules).filter((m) => SUBMIT_BLOCKING_KEYS.has(m.key)), ...conflictosDeSitio(d, rules, tiendas)];
}

/**
 * An order that goes nowhere (D-267): «a store can't sell to itself, nor pick up and deliver at
 * itself». These also refuse, not warn — same mechanism as pallets and the document. Living here,
 * and not only in the modal's save, is what makes them apply to BOTH submit paths: the old
 * same-address check ran on save and the create-and-submit button skipped it.
 *
 * Its own function since D-276, because approving and every write that puts an order into
 * pending or approved check THIS and only this (`order-sites.ts`): extending D-049's missing-field
 * gate to approval was not asked for.
 */
export function conflictosDeSitio(d: Partial<Delivery>, rules: OrderTypeRules, tiendas: NamedLocation[]): MissingField[] {
  const out: MissingField[] = [];
  const regla = orderTypeRule(d.order_type, rules);
  if (origenEsDestino(d, regla, tiendas)) {
    // El campo que se marca es el que la persona puede cambiar: en un tipo que recibe, «Vendido desde»
    // está congelado y lo que se elige es la recogida, así que señalar `store` la dejaría mirando un
    // campo deshabilitado (D-NEXT).
    out.push({
      key: regla.homeIsDestination === true ? "pickup_name" : "store", conflict: true,
      en: "The origin store and the destination store are the same",
      es: "La tienda de origen y la de destino son la misma",
    });
  }
  if (mismaDireccion(d)) {
    out.push({
      key: "delivery_address", conflict: true,
      en: "Pickup and delivery are at the same address",
      es: "La recolección y la entrega están en la misma dirección",
    });
  }
  return out;
}

/** Field keys to highlight in the form. */
export function missingKeys(d: Partial<Delivery>, rules?: OrderTypeRules): Set<string> {
  const keys = new Set(missingFields(d, rules).map((m) => m.key));
  // "doc_ref" means a PO # or Invoice # is needed — light those up. SO # is
  // optional for these (Intertienda) orders, so it's never flagged.
  if (keys.has("doc_ref")) { keys.add("po2"); keys.add("invoice_num"); }
  return keys;
}
