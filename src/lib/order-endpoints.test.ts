import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { submitBlockers } from "./required";
import { mismaDireccion, normalizaLugar, opcionesDeOrigen, origenEsDestino } from "./order-endpoints";
import type { Delivery, OrderTypeRule, NamedLocation } from "./types";

// Una orden no puede ir de un sitio a ese mismo sitio (D-267). Lo que decide —`submitBlockers`— se
// importa de verdad, y se le da el borrador tal como lo arma el modal: en una Intertienda,
// `withTypeDefaults` pone la tienda del usuario como destino, y al elegir «Sold From» se copian su
// nombre y su dirección a la recogida. Nombres de tienda neutros: nada de los datos del dueño.

// Las reglas de producción, medidas por el orquestador en `settings.order_type_rules`.
const RULES: Record<string, OrderTypeRule> = {
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Transfer: { docRef: "estimate", storeToStore: true },
  Customer: { docRef: "invoice", storeToStore: false },
};

const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave, Ciudad TX" },
  { name: "Tienda Sur", address: "200 Sur Blvd, Ciudad TX" },
];

/** Lo que no tiene que ver con los sitios, relleno para que solo hablen las reglas nuevas. */
const resto = {
  delivery_date: "2026-09-20", delivery_windows: "0900-1100", est_pallets: 3, po2: "PO-1",
  invoice_num: "INV-1", delivery_fee: 50, contact: "Recibe", delivery_phone: "5550001111",
};

/** Una Intertienda armada con los mismos pasos que el modal. `casa` es la tienda del usuario. */
function borradorIntertienda(casa: string, origen: string): Partial<Delivery> {
  const home = TIENDAS.find((s) => s.name === casa)!;
  const elegida = TIENDAS.find((s) => s.name === origen)!;
  // withTypeDefaults: destino = la tienda del usuario; el origen lo elige él.
  const tras_tipo: Partial<Delivery> = { order_type: "Intertienda", delivery_name: casa, delivery_address: home.address, store: "" };
  // onChange de «Sold From»: tienda, y su nombre y dirección como recogida.
  return { ...resto, ...tras_tipo, store: origen, pickup_name: origen, pickup_address: elegida.address };
}

const claves = (d: Partial<Delivery>) => submitBlockers(d, RULES, TIENDAS).map((m) => m.key).sort();

describe("tienda-a-tienda: el origen no puede ser el destino", () => {
  it("de una tienda a otra, se envía", () => {
    expect(submitBlockers(borradorIntertienda("Tienda Norte", "Tienda Sur"), RULES, TIENDAS)).toEqual([]);
  });

  it("de una tienda a sí misma, se bloquea — y como comparten dirección, las dos reglas lo dicen", () => {
    const d = borradorIntertienda("Tienda Norte", "Tienda Norte");
    expect(claves(d)).toEqual(["delivery_address", "store"]);
    expect(submitBlockers(d, RULES, TIENDAS).every((m) => m.conflict === true)).toBe(true);
  });

  it("el mismo nombre escrito distinto sigue siendo la misma tienda", () => {
    const d = { ...borradorIntertienda("Tienda Norte", "Tienda Sur"), store: "  tienda  NORTE " };
    expect(claves(d)).toContain("store");
  });

  it("vale para cualquier tipo tienda-a-tienda, no solo Intertienda", () => {
    const d: Partial<Delivery> = {
      ...resto, order_type: "Transfer", store: "Tienda Sur", delivery_name: "Tienda Sur",
      pickup_name: "Tienda Sur", pickup_address: "Patio 1", delivery_address: "Patio 2",
    };
    expect(claves(d)).toEqual(["store"]);
  });
});

describe("cualquier tipo: recogida y entrega en la misma dirección", () => {
  const cliente = (extra: Partial<Delivery>): Partial<Delivery> => ({
    ...resto, order_type: "Customer", store: "Tienda Norte", pickup_name: "Tienda Norte",
    pickup_address: "100 Norte Ave, Ciudad TX", delivery_name: "Obra", delivery_address: "999 Otra St, Ciudad TX", ...extra,
  });

  it("una entrega a cliente normal se envía", () => {
    expect(submitBlockers(cliente({}), RULES, TIENDAS)).toEqual([]);
  });

  it("la misma dirección con otras mayúsculas y espacios se bloquea", () => {
    expect(claves(cliente({ delivery_address: "  100  NORTE ave,  ciudad tx " }))).toEqual(["delivery_address"]);
  });

  it("en una entrega a cliente, el mismo NOMBRE con otra dirección no bloquea: dos locales de una cadena", () => {
    expect(submitBlockers(cliente({ pickup_name: "Obra", delivery_name: "Obra" }), RULES, TIENDAS)).toEqual([]);
  });

  it("sin dirección de recogida no hay nada que comparar", () => {
    expect(mismaDireccion({ pickup_address: "", delivery_address: "" })).toBe(false);
  });
});

describe("lo que falta y lo que se contradice van juntos, pero marcados distinto", () => {
  it("una orden a sí misma sin pallets devuelve los dos, y solo el choque lleva `conflict`", () => {
    const d = { ...borradorIntertienda("Tienda Norte", "Tienda Norte"), est_pallets: null };
    const bs = submitBlockers(d, RULES, TIENDAS);
    expect(bs.find((m) => m.key === "est_pallets")?.conflict).toBeUndefined();
    expect(bs.filter((m) => m.conflict).map((m) => m.key).sort()).toEqual(["delivery_address", "store"]);
  });
});

describe("la orden vieja que ya lo tiene: se ve y se corrige, pero no vuelve a enviarse así", () => {
  const vieja = { ...borradorIntertienda("Tienda Norte", "Tienda Norte"), stage: "approved" as const };

  it("su valor actual sigue en el desplegable, aunque sea la otra punta", () => {
    expect(opcionesDeOrigen(vieja, TIENDAS, true)).toEqual(["Tienda Norte", "Tienda Sur"]);
  });

  it("y al volver a enviarla, se bloquea", () => {
    expect(claves(vieja)).toEqual(["delivery_address", "store"]);
  });

  it("corregida, pasa", () => {
    const corregida = { ...vieja, store: "Tienda Sur", pickup_name: "Tienda Sur", pickup_address: TIENDAS[1].address };
    expect(submitBlockers(corregida, RULES, TIENDAS)).toEqual([]);
  });
});

describe("los desplegables no ofrecen la otra punta", () => {
  // Desde D-276 el filtro pregunta a la regla con el mismo manejador que aplica la elección; los
  // recorridos completos, en cualquier orden, están en order-sites.test.ts.
  const tres: NamedLocation[] = [...TIENDAS, { name: "Tienda Este", address: "300 Este Rd, Ciudad TX" }];
  const nombres = tres.map((s) => s.name);

  it("quita la otra punta, comparando normalizado", () => {
    expect(opcionesDeOrigen({ order_type: "Intertienda", delivery_name: " tienda norte " }, tres, true)).toEqual(["Tienda Sur", "Tienda Este"]);
  });

  it("sin otra punta elegida, ofrece todas; fuera de tienda-a-tienda, también", () => {
    expect(opcionesDeOrigen({}, tres, true)).toEqual(nombres);
    expect(opcionesDeOrigen({ delivery_name: null, delivery_address: null }, tres, true)).toEqual(nombres);
    expect(opcionesDeOrigen({ delivery_name: "Tienda Norte" }, tres, false)).toEqual(nombres);
  });

  it("fuera de tienda-a-tienda, el origen igual al destino no es un choque", () => {
    expect(origenEsDestino({ store: "Tienda Norte", delivery_name: "Tienda Norte" }, false, TIENDAS)).toBe(false);
    expect(normalizaLugar("  A   B ")).toBe("a b");
  });
});

describe("el modal usa estas reglas, en los dos caminos de envío", () => {
  const modal = readFileSync("src/components/OrderModal.tsx", "utf8").split("\r\n").join("\n");

  it("la regla de dirección del guardado es la compartida, no una copia", () => {
    expect(modal).toContain("const pickupEqualsDropoff = mismaDireccion(d);");
    expect(modal).not.toContain("const normAddr =");
  });

  it("los dos «Sold From» y el destino filtran la otra punta", () => {
    const origen = "opts={opcionesDeOrigen(d, settings.stores, storeToStore)}";
    // Dos otra vez desde D-NEXT, que revirtió D-282: el primer paso y el formulario completo.
    expect(modal.split(origen).length - 1).toBe(2);
    expect(modal).toContain("opts={opcionesDeDestino(d, settings.stores)}");
  });

  it("crear-y-enviar y guardar pasan los dos por `passesChecks`, que llama a `submitBlockers`", () => {
    expect(modal).toContain("if (blockSubmit(draft)) return false;");
    expect(modal).toContain("const blockers = submitBlockers(draft, settings.order_type_rules, settings.stores);");
    // Guardar una orden que no es borrador, y el botón de crear y enviar.
    expect(modal).toContain('if ((payload.stage ?? "draft") !== "draft" && !(await passesChecks(payload))) return;');
    expect(modal).toContain("if (!(await passesChecks(payload))) return;");
  });

  it("y el mensaje separa lo que falta de lo que se contradice", () => {
    expect(modal).toContain("const choques = blockers.filter((m) => m.conflict);");
  });
});
