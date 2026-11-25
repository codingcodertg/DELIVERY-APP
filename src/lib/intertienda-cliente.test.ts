import { describe, expect, it } from "vitest";
import { mkDelivery } from "@/lib/__fixtures";
import type { Delivery, NamedLocation } from "@/lib/types";
import type { OrderTypeRules } from "@/lib/required";
import { alPartir, esIntertiendaCliente, hayQuePartirla, pasaACliente, pasaPorLaTiendaQueVende, subtipoDeIntertienda, textoDeLosPasos } from "./intertienda-cliente";
import { primerDiaDelPasoB } from "./relevo";

const TIENDAS: NamedLocation[] = [
  { name: "RDZ McAllen", address: "1 Main St, McAllen, TX", lat: 26.2, lng: -98.23 },
  { name: "RDZ Pharr", address: "4 Cage Blvd, Pharr, TX" },
  { name: "RDZ Weslaco", address: "2 Texas Blvd, Weslaco, TX" },
];

const REGLAS: OrderTypeRules = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Transfer: { storeToStore: true, docRef: "none" },
  Intertienda: { storeToStore: true, homeIsDestination: true, docRef: "any" },
};

/** La intertienda de cliente del ejemplo: la vende RDZ Pharr, se recoge en RDZ McAllen, va a una casa. */
const ic = (over: Partial<Delivery> = {}): Delivery => mkDelivery({
  id: "madre", order_no: 2222, order_code: "FV222", order_type: "Customer", stage: "approved",
  store: "RDZ Pharr", pickup_name: "RDZ McAllen", pickup_address: "1 Main St, McAllen, TX",
  delivery_name: "Ana Cliente", delivery_address: "55 Oak Rd, Edinburg, TX",
  delivery_date: "2026-11-20", est_pallets: 6, actual_pallets: 6, delivery_fee: 40,
  assigned_driver: "Julio Jijon", route_seq: 2, pickup_seq: 1, invoice_num: "170099",
  relay_step: null, order_suffix: null,
  ...over,
} as Partial<Delivery>);

const ahora = "2026-11-18T15:00:00.000Z";

describe("pasaPorLaTiendaQueVende", () => {
  it("el caso base: cliente, la vende Pharr y se recoge en McAllen", () => {
    const r = pasaPorLaTiendaQueVende(ic(), REGLAS, TIENDAS);
    expect(r?.origen.name).toBe("RDZ McAllen");
    expect(r?.tienda.name).toBe("RDZ Pharr");
  });

  it("tienda a tienda (sin cliente detrás) no entra", () => {
    expect(pasaPorLaTiendaQueVende(ic({ order_type: "Transfer" }), REGLAS, TIENDAS)).toBeNull();
    expect(pasaPorLaTiendaQueVende(ic({ order_type: "Intertienda", delivery_name: "RDZ Weslaco" }), REGLAS, TIENDAS)).toBeNull();
  });

  it("recogida igual a la tienda que vende: no", () => {
    expect(pasaPorLaTiendaQueVende(ic({ pickup_name: "RDZ Pharr" }), REGLAS, TIENDAS)).toBeNull();
  });

  it("recogida que no es una tienda de Ajustes: no", () => {
    expect(pasaPorLaTiendaQueVende(ic({ pickup_name: "Bodega externa" }), REGLAS, TIENDAS)).toBeNull();
  });

  it("tienda que vende que no es de Ajustes: no", () => {
    expect(pasaPorLaTiendaQueVende(ic({ store: "RDZ Fantasma" }), REGLAS, TIENDAS)).toBeNull();
  });

  it("ya es un paso de relevo: no", () => {
    expect(pasaPorLaTiendaQueVende(ic({ relay_step: 1, order_suffix: "a" }), REGLAS, TIENDAS)).toBeNull();
  });

  it("carga partida (letra sin relevo): no", () => {
    expect(pasaPorLaTiendaQueVende(ic({ order_suffix: "a", relay_step: null }), REGLAS, TIENDAS)).toBeNull();
  });

  it("el destino es la tienda que vende (por nombre o por su dirección): no", () => {
    expect(pasaPorLaTiendaQueVende(ic({ delivery_name: "RDZ Pharr" }), REGLAS, TIENDAS)).toBeNull();
    expect(pasaPorLaTiendaQueVende(ic({ delivery_name: "Mostrador", delivery_address: "4 cage  blvd, pharr, tx" }), REGLAS, TIENDAS)).toBeNull();
  });

  it("mismo grupo de tiendas (D-293): no hay que partirla", () => {
    const grupo = TIENDAS.map((t) => (t.name === "RDZ McAllen" || t.name === "RDZ Pharr" ? { ...t, group: "Valle" } : t));
    expect(pasaPorLaTiendaQueVende(ic(), REGLAS, grupo)).toBeNull();
    // Con otro grupo sí.
    const otro = TIENDAS.map((t) => (t.name === "RDZ McAllen" ? { ...t, group: "Norte" } : t));
    expect(pasaPorLaTiendaQueVende(ic(), REGLAS, otro)).not.toBeNull();
  });

  it("nombres sin distinguir mayúsculas ni espacios", () => {
    const r = pasaPorLaTiendaQueVende(ic({ store: "  rdz   pharr ", pickup_name: "RDZ  mcallen" }), REGLAS, TIENDAS);
    expect(r?.tienda.name).toBe("RDZ Pharr");
    expect(r?.origen.name).toBe("RDZ McAllen");
  });
});

describe("hayQuePartirla", () => {
  const sola = [{ id: "madre" }];
  it("por etapa: pendiente no, aprobada sí, recogida no", () => {
    expect(hayQuePartirla(ic({ stage: "pending" }), sola, REGLAS, TIENDAS)).toBe(false);
    expect(hayQuePartirla(ic({ stage: "approved" }), sola, REGLAS, TIENDAS)).toBe(true);
    expect(hayQuePartirla(ic({ stage: "picked_up" }), sola, REGLAS, TIENDAS)).toBe(false);
  });
  it("con una hermana (ya partida en cargas): no", () => {
    expect(hayQuePartirla(ic(), [{ id: "madre" }, { id: "otra" }], REGLAS, TIENDAS)).toBe(false);
  });
});

describe("esIntertiendaCliente", () => {
  it("el paso a termina en la tienda que vende", () => {
    expect(esIntertiendaCliente({ relay_step: 1, store: "RDZ Pharr", pickup_name: "RDZ McAllen", delivery_name: "RDZ Pharr" })).toBe(true);
  });
  it("el paso b se recoge en la tienda que vende", () => {
    expect(esIntertiendaCliente({ relay_step: 2, store: "RDZ Pharr", pickup_name: "RDZ Pharr", delivery_name: "Ana Cliente" })).toBe(true);
  });
  it("un relevo por una TERCERA tienda no es de cliente", () => {
    expect(esIntertiendaCliente({ relay_step: 1, store: "RDZ Pharr", pickup_name: "RDZ McAllen", delivery_name: "RDZ Weslaco" })).toBe(false);
    expect(esIntertiendaCliente({ relay_step: 2, store: "RDZ Pharr", pickup_name: "RDZ Weslaco", delivery_name: "Ana Cliente" })).toBe(false);
  });
  it("una orden que no es relevo no es de cliente", () => {
    expect(esIntertiendaCliente({ relay_step: null, store: "RDZ Pharr", pickup_name: "RDZ Pharr", delivery_name: "RDZ Pharr" })).toBe(false);
  });
});

describe("alPartir", () => {
  const hoy = "2026-11-18";
  const madre = ic();
  const r = alPartir(madre, REGLAS, TIENDAS, { id: "paso-b", ahora, creador: "logi", hoy })!;

  it("el paso a termina en la tienda que vende y el paso b se recoge allí y va al cliente", () => {
    expect(r.madre.order_suffix).toBe("a");
    expect(r.madre.relay_step).toBe(1);
    expect(r.madre.delivery_name).toBe("RDZ Pharr");
    expect(r.paso.order_suffix).toBe("b");
    expect(r.paso.relay_step).toBe(2);
    expect(r.paso.pickup_name).toBe("RDZ Pharr");
    expect(r.paso.delivery_name).toBe("Ana Cliente");
    expect(r.paso.delivery_address).toBe("55 Oak Rd, Edinburg, TX");
    expect(r.paso.store).toBe("RDZ Pharr");
    expect(r.madre.store).toBeUndefined();
  });

  it("los dos pasos llevan todos los pallets", () => {
    // El paso a es la misma fila: el parche de la madre no toca los pallets, y el paso b copia los de la madre.
    expect(r.madre).not.toHaveProperty("est_pallets");
    expect(r.paso.est_pallets).toBe(6);
    expect(r.paso.actual_pallets).toBe(6);
  });

  it("la tarifa se queda solo en el paso b", () => {
    expect(r.madre.delivery_fee).toBeNull();
    expect(r.paso.delivery_fee).toBe(40);
  });

  it("el día del paso b es primerDiaDelPasoB", () => {
    expect(r.paso.delivery_date).toBe(primerDiaDelPasoB(madre.delivery_date, hoy));
    expect(r.paso.delivery_date).toBe("2026-11-20");
  });

  it("null si no hay que partirla", () => {
    expect(alPartir(ic({ order_type: "Transfer" }), REGLAS, TIENDAS, { id: "x", ahora, creador: null, hoy })).toBeNull();
  });
});

describe("subtipoDeIntertienda", () => {
  it("customer: una orden de cliente que pasa por la tienda que vende", () => {
    expect(subtipoDeIntertienda(ic(), REGLAS, TIENDAS)).toBe("customer");
  });
  it("customer: un paso de relevo de cliente", () => {
    expect(subtipoDeIntertienda(ic({ relay_step: 2, order_suffix: "b", pickup_name: "RDZ Pharr" }), REGLAS, TIENDAS)).toBe("customer");
  });
  it("stock: tienda a tienda cuyo destino es la tienda que la pide", () => {
    const stock = ic({ order_type: "Intertienda", store: "RDZ Pharr", pickup_name: "RDZ McAllen", delivery_name: "RDZ Pharr", delivery_address: "4 Cage Blvd, Pharr, TX" });
    expect(subtipoDeIntertienda(stock, REGLAS, TIENDAS)).toBe("stock");
  });
  it("null: lo demás", () => {
    expect(subtipoDeIntertienda(ic({ order_type: "Transfer", delivery_name: "RDZ Weslaco" }), REGLAS, TIENDAS)).toBeNull();
    expect(subtipoDeIntertienda(ic({ order_type: "Transfer", delivery_name: "RDZ Pharr" }), REGLAS, TIENDAS)).toBeNull();
  });
});

describe("textoDeLosPasos", () => {
  it("en y es, con el nombre del cliente", () => {
    expect(textoDeLosPasos("RDZ McAllen", "RDZ Pharr", "Ana Cliente")).toEqual({
      en: "A: RDZ McAllen → RDZ Pharr · B: RDZ Pharr → Ana Cliente",
      es: "A: RDZ McAllen → RDZ Pharr · B: RDZ Pharr → Ana Cliente",
    });
  });
  it("sin destino: customer / cliente", () => {
    expect(textoDeLosPasos("RDZ McAllen", "RDZ Pharr", "  ")).toEqual({
      en: "A: RDZ McAllen → RDZ Pharr · B: RDZ Pharr → customer",
      es: "A: RDZ McAllen → RDZ Pharr · B: RDZ Pharr → cliente",
    });
    expect(textoDeLosPasos("RDZ McAllen", "RDZ Pharr", null).es).toContain("→ cliente");
  });
});

describe("pasaACliente: el botón «Customer» del formulario", () => {
  it("la tienda de origen elegida queda como recogida, con su dirección, y la que vende es la mía", () => {
    const antes = { store: "RDZ McAllen", pickup_name: "RDZ McAllen", pickup_address: "1 Main St, McAllen, TX", order_type: "Intertienda" } as Partial<Delivery>;
    const conTipo = { order_type: "Customer", store: "RDZ Pharr", pickup_name: "RDZ Pharr", pickup_address: "4 Cage Blvd, Pharr, TX" } as Partial<Delivery>;
    const r = pasaACliente(antes, conTipo, "RDZ Pharr", TIENDAS);
    expect(r.order_type).toBe("Customer");
    expect(r.pickup_name).toBe("RDZ McAllen");
    expect(r.pickup_address).toBe("1 Main St, McAllen, TX");
    expect(r.store).toBe("RDZ Pharr");
  });

  it("sin recogida elegida, la tienda de «Vendido desde» es el origen y su dirección sale de Ajustes", () => {
    const r = pasaACliente({ store: "RDZ Weslaco", pickup_name: null }, { order_type: "Customer" }, "RDZ Pharr", TIENDAS);
    expect(r.pickup_name).toBe("RDZ Weslaco");
    expect(r.pickup_address).toBe("2 Texas Blvd, Weslaco, TX");
  });

  it("sin origen no toca la recogida; sin tienda propia no cambia la tienda", () => {
    const r = pasaACliente({ store: null, pickup_name: null }, { order_type: "Customer", store: "X" }, null, TIENDAS);
    expect(r).toEqual({ order_type: "Customer", store: "X" });
  });
});
