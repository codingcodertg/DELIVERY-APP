import { describe, it, expect } from "vitest";
import { attentionItems, deliveredWithoutProof, missingPin, noFeeCharged, overdueUnassigned } from "./attention";
import { blankDelivery } from "./blank-delivery";
import type { Delivery } from "./types";

const TODAY = "2026-08-16";
const mk = (over: Partial<Delivery>): Delivery => ({ ...blankDelivery(), ...over });

describe("overdueUnassigned", () => {
  it("catches live work past its date with nobody driving it", () => {
    // The real one this was written for: eleven days past, still 'approved',
    // no driver, and nothing anywhere said so.
    const d = mk({ stage: "approved", delivery_date: "2026-08-05", assigned_driver: null });
    expect(overdueUnassigned([d], TODAY)).toHaveLength(1);
  });

  it("stays quiet about TODAY's unassigned work", () => {
    // Normal at 8am. Flagging it would cry wolf every single morning.
    const d = mk({ stage: "ready", delivery_date: TODAY, assigned_driver: null });
    expect(overdueUnassigned([d], TODAY)).toHaveLength(0);
  });

  it("ignores an overdue order that already has a driver", () => {
    const d = mk({ stage: "ready", delivery_date: "2026-08-05", assigned_driver: "Maximo Garza" });
    expect(overdueUnassigned([d], TODAY)).toHaveLength(0);
  });

  it("ignores finished and abandoned orders", () => {
    for (const stage of ["delivered", "canceled", "rejected", "draft"] as const) {
      expect(overdueUnassigned([mk({ stage, delivery_date: "2026-08-01", assigned_driver: null })], TODAY)).toHaveLength(0);
    }
  });

  it("ignores an undated order", () => {
    expect(overdueUnassigned([mk({ stage: "ready", delivery_date: null, assigned_driver: null })], TODAY)).toHaveLength(0);
  });
});

describe("missingPin", () => {
  it("catches live work the optimizer would silently skip", () => {
    expect(missingPin([mk({ stage: "ready", delivery_lat: null })])).toHaveLength(1);
  });

  it("ignores a stop that has coordinates", () => {
    expect(missingPin([mk({ stage: "ready", delivery_lat: 25.9, delivery_lng: -97.5 })])).toHaveLength(0);
  });

  it("ignores drafts nobody has committed to", () => {
    expect(missingPin([mk({ stage: "draft", delivery_lat: null })])).toHaveLength(0);
  });
});

describe("deliveredWithoutProof", () => {
  it("catches a delivery recorded with nothing at all", () => {
    const d = mk({ stage: "delivered", pod_delivered_at: "2026-08-14T19:32:00Z" });
    expect(deliveredWithoutProof([d])).toHaveLength(1);
  });

  it("ignores the backlog that was marked in bulk", () => {
    // 35 orders were marked delivered when the system was set up. They never
    // had proof and never will; flagging them would bury the ones that matter.
    const d = mk({ stage: "delivered", pod_delivered_at: null });
    expect(deliveredWithoutProof([d])).toHaveLength(0);
  });

  it("accepts ANY one piece of evidence as enough", () => {
    const base = { stage: "delivered" as const, pod_delivered_at: "2026-08-14T19:32:00Z" };
    expect(deliveredWithoutProof([mk({ ...base, pod_received_by: "Ana" })])).toHaveLength(0);
    expect(deliveredWithoutProof([mk({ ...base, pod_signature: "data:image/png;base64,x" })])).toHaveLength(0);
    expect(deliveredWithoutProof([mk({ ...base, pod_lat: 25.9, pod_lng: -97.5 })])).toHaveLength(0);
    expect(deliveredWithoutProof([mk({ ...base, photos: ["u"] })])).toHaveLength(0);
  });
});

describe("attentionItems", () => {
  // Cada fixture tiene UNA cosa mal y el resto en orden — incluida la tarifa cobrada, o
  // el aviso de "sale sin cobrar nada" se colaría en todas y estas pruebas dejarían de
  // medir lo que dicen medir.
  const noProof = mk({ id: "a", stage: "delivered", pod_delivered_at: "2026-08-14T19:32:00Z", delivery_fee: 95 });
  const overdue = mk({ id: "b", stage: "approved", delivery_date: "2026-08-05", assigned_driver: null, delivery_lat: 25.9, delivery_lng: -97.5, delivery_fee: 95 });

  it("puts overdue work ahead of bookkeeping", () => {
    const items = attentionItems([noProof, overdue], TODAY, true);
    expect(items[0].kind).toBe("overdue_unassigned");
    expect(items[items.length - 1].kind).toBe("no_proof");
  });

  it("says nothing about missing proof when no proof was asked for", () => {
    // Signatures and require_pod are both off by choice, so a delivery with
    // nothing attached is the configured outcome. Raising it every day would
    // be the app arguing with its owner's own setting until they stopped
    // reading the panel.
    const items = attentionItems([noProof], TODAY, false);
    expect(items).toEqual([]);
  });

  it("defaults to staying quiet about it", () => {
    expect(attentionItems([noProof], TODAY)).toEqual([]);
  });

  it("still raises it once proof IS required", () => {
    // Then a delivery with nothing attached really is a rule going unmet.
    expect(attentionItems([noProof], TODAY, true).map((i) => i.kind)).toEqual(["no_proof"]);
  });

  it("keeps raising the other two either way", () => {
    for (const required of [true, false]) {
      expect(attentionItems([overdue], TODAY, required).map((i) => i.kind)).toEqual(["overdue_unassigned"]);
    }
  });

  it("is empty on a healthy board", () => {
    expect(attentionItems([mk({ stage: "ready", delivery_date: TODAY, assigned_driver: "Maximo Garza", delivery_lat: 25.9, delivery_lng: -97.5, delivery_fee: 95 })], TODAY)).toEqual([]);
  });
});

describe("missingPin covers what Routes Manager can plan", () => {
  it("catches a PENDING order with no coordinates", () => {
    // FQ503: pending, dated for tomorrow, full Weslaco address, no pin. It is
    // schedulable, so the optimizer would load it into a route and silently
    // drop it — and the old rule started at "approved", so nothing said so.
    expect(missingPin([mk({ stage: "pending", delivery_lat: null })])).toHaveLength(1);
  });

  it("still ignores drafts", () => {
    expect(missingPin([mk({ stage: "draft", delivery_lat: null })])).toHaveLength(0);
  });

  it("ignores an order already out on a truck", () => {
    // Picked up: the driver has it, a missing pin is no longer actionable.
    expect(missingPin([mk({ stage: "picked_up", delivery_lat: null })])).toHaveLength(0);
  });
});

describe("noFeeCharged", () => {
  it("marca la entrega que va a salir con la tarifa VACÍA", () => {
    // El caso que el aviso del diálogo no veía: comparaba contra la lista de precios,
    // y un hueco no se puede comparar con nada.
    expect(noFeeCharged([mk({ stage: "approved", order_type: "Customer", delivery_fee: null })])).toHaveLength(1);
  });

  it("marca también la que va en $0", () => {
    // Cero es legítimo (cortesía, reentrega que se come la casa) y por eso hay que
    // verlo: desde fuera, un cero deliberado y uno olvidado son idénticos.
    expect(noFeeCharged([mk({ stage: "ready", order_type: "Customer", delivery_fee: 0 })])).toHaveLength(1);
  });

  it("se calla si se cobró algo", () => {
    expect(noFeeCharged([mk({ stage: "ready", order_type: "Customer", delivery_fee: 95 })])).toHaveLength(0);
  });

  it("se le exige a TODOS los tipos, traslados entre tiendas incluidos", () => {
    // D-148, pedido explícitamente: también un traslado mueve un camión. La primera
    // versión los excluía siguiendo a required.ts y se quedaba callada justo donde
    // Andrés quería el aviso.
    for (const tipo of ["Customer", "Intertienda", "Transfer", "Pickup", null]) {
      expect(
        noFeeCharged([mk({ stage: "approved", order_type: tipo, delivery_fee: null })]),
        `tipo ${tipo}`,
      ).toHaveLength(1);
    }
  });

  it("no marca lo ya entregado ni lo que aún no es una orden", () => {
    // Entregada: la tarifa ya es un problema de facturación, y un aviso sobre algo
    // que nadie puede cambiar acaba en "ocultar". Borrador: todavía no es una orden.
    for (const stage of ["delivered", "canceled", "rejected", "draft"] as const) {
      expect(noFeeCharged([mk({ stage, order_type: "Customer", delivery_fee: null })])).toHaveLength(0);
    }
  });

  it("cubre toda la vida útil de la orden, desde pendiente hasta cargada", () => {
    for (const stage of ["pending", "approved", "fulfilling", "ready", "picked_up"] as const) {
      expect(noFeeCharged([mk({ stage, order_type: "Customer", delivery_fee: null })])).toHaveLength(1);
    }
  });

  it("sale en el panel, y antes que el aviso del mapa", () => {
    const d = mk({ stage: "approved", order_type: "Customer", delivery_fee: null, delivery_lat: null });
    const kinds = attentionItems([d], TODAY).map((i) => i.kind);
    expect(kinds).toContain("no_fee");
    expect(kinds.indexOf("no_fee")).toBeLessThan(kinds.indexOf("no_pin"));
  });
});
