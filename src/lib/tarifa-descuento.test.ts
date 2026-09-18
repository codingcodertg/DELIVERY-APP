import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  deliveryFee, FACTOR_MILLA, MINIMO_MEDIO, pasoTarifa, redondear, suggestDeliveryFee, TARIFA,
  UMBRAL_CORTO, UMBRAL_LARGO,
} from "./pricing";

/**
 * El precio con descuento, de vuelta (D-303).
 *
 * D-283 lo quitó porque el dueño pidió un solo precio esa mañana; esa misma tarde pidió el descuento
 * de vuelta: «discounted fee was removed, bring it back». La cifra es suya, literal: «discounted
 * price for local deliveries over 50 mi will be = 105+(0.80 x miles)».
 *
 * Lo que se mide aquí es la tabla de millas entera y las dos reglas que no pueden romperse: que el
 * descuento **nunca** supere a la lista, y que una orden ya guardada no se recalcule sola.
 */

describe("la tabla de millas, lista y descuento", () => {
  // Las cifras del dueño, contadas una vez y a mano. Si alguna cambia, cambia el precio de verdad.
  const CASOS: { mi: number; local: boolean; lista: number; descuento: number; cuenta: string }[] = [
    { mi: 0,    local: true,  lista: 100, descuento: 100, cuenta: "plano, los dos" },
    { mi: 10.9, local: true,  lista: 100, descuento: 100, cuenta: "plano hasta el borde" },
    { mi: 11,   local: true,  lista: 115, descuento: 115, cuenta: "105 + 8,8 = 113,8 → 115" },
    { mi: 27,   local: true,  lista: 125, descuento: 125, cuenta: "105 + 21,6 = 126,6 → 125" },
    { mi: 50,   local: true,  lista: 145, descuento: 145, cuenta: "105 + 40 = 145" },
    { mi: 50.1, local: true,  lista: 340, descuento: 145, cuenta: "lista 300 + 40,08 → 340 · descuento 105 + 40,08 = 145,08 → 145" },
    { mi: 60,   local: true,  lista: 350, descuento: 155, cuenta: "lista 300 + 48 = 348 → 350 · descuento 105 + 48 = 153 → 155" },
    { mi: 180,  local: true,  lista: 445, descuento: 250, cuenta: "lista 300 + 144 = 444 → 445 · descuento 105 + 144 = 249 → 250" },
    { mi: 13,   local: false, lista: 510, descuento: 510, cuenta: "fuera de zona, 500 + 10,4 → 510 (provisional)" },
    { mi: 60,   local: false, lista: 550, descuento: 550, cuenta: "fuera de zona, 500 + 48 = 548 → 550" },
  ];

  for (const { mi, local, lista, descuento, cuenta } of CASOS) {
    it(`${mi} mi ${local ? "local" : "fuera de zona"} → lista ${lista}, descuento ${descuento} (${cuenta})`, () => {
      expect(deliveryFee(mi, local, "list")).toBe(lista);
      expect(deliveryFee(mi, local, "discount")).toBe(descuento);
    });
  }

  it("por defecto se pide la lista, que es lo que cobraba quien llamaba con dos argumentos", () => {
    for (const { mi, local, lista } of CASOS) expect(deliveryFee(mi, local), `${mi}/${local}`).toBe(lista);
  });
});

describe("el descuento nunca por encima de la lista", () => {
  it("en cada milla de 0 a 200, de media en media", () => {
    for (const local of [true, false]) {
      for (let mi = 0; mi <= 200; mi += 0.5) {
        const lista = deliveryFee(mi, local, "list");
        const descuento = deliveryFee(mi, local, "discount");
        // «≤» y no «<»: con estas cifras coinciden en tres de los cuatro tramos, y eso es lo
        // correcto, no un fallo. Lo que no puede pasar nunca es que el descuento salga MÁS caro.
        expect(descuento, `${mi} mi · local=${local}`).toBeLessThanOrEqual(lista);
      }
    }
  });

  it("y donde de verdad descuenta es por encima de 50 millas locales", () => {
    // El control de que la regla de arriba no pasa por ser trivial: si el descuento fuera siempre
    // igual a la lista, esta cae.
    const baratas = [];
    for (let mi = 0; mi <= 200; mi += 0.5) {
      if (deliveryFee(mi, true, "discount") < deliveryFee(mi, true, "list")) baratas.push(mi);
    }
    expect(baratas.length).toBeGreaterThan(0);
    expect(Math.min(...baratas)).toBeGreaterThan(UMBRAL_LARGO);
  });

  it("el descuento de una entrega larga es la fórmula del tramo del medio, no una cifra propia", () => {
    for (const mi of [50.1, 60, 97.3, 180]) {
      expect(deliveryFee(mi, true, "discount"), `${mi} mi`)
        .toBe(Math.max(MINIMO_MEDIO, redondear(TARIFA.baseMedio + mi * FACTOR_MILLA)));
    }
  });

  it("el paso del descuento lo dice: mismo tramo, pero la regla del medio", () => {
    const p = pasoTarifa(60, true, 0, "discount");
    // El tramo sigue siendo el largo —ahí cae la entrega— y la regla que se aplica es la del medio.
    expect(p.tramo).toBe("local-largo");
    expect(p.desde).toBe(UMBRAL_LARGO);
    expect(p.base).toBe(TARIFA.baseMedio);
    expect(p.minimo).toBe(MINIMO_MEDIO);
    // Y la lista, en la misma milla, sigue con la suya.
    expect(pasoTarifa(60, true, 0, "list").base).toBe(TARIFA.baseLargo);
  });

  it("en los tramos donde coinciden, coinciden hasta en el paso", () => {
    for (const mi of [0, 10.9, UMBRAL_CORTO, 27, UMBRAL_LARGO]) {
      expect(pasoTarifa(mi, true, 0, "discount"), `${mi} mi`).toEqual(pasoTarifa(mi, true, 0, "list"));
    }
    expect(pasoTarifa(60, false, 0, "discount")).toEqual(pasoTarifa(60, false, 0, "list"));
  });
});

describe("las órdenes guardadas no se recalculan", () => {
  const orden = {
    delivery_address: "123 Main St, McAllen, TX 78501",
    route_miles: 80,
    delivery_fee: 999,
  };

  it("suggestDeliveryFee sugiere, y no toca lo que recibe", () => {
    const copia = { ...orden };
    const s = suggestDeliveryFee(orden);
    expect(orden).toEqual(copia);
    expect(orden.delivery_fee).toBe(999);
    // Y lo que sugiere es lo nuevo, que es justo lo que NO se le aplicó a la orden.
    expect(s.list).toBe(deliveryFee(80, true, "list"));
    expect(s.discount).toBe(deliveryFee(80, true, "discount"));
    expect(s.list).not.toBe(orden.delivery_fee);
  });

  it("ninguna pantalla escribe la tarifa sola: el importe se pone al pulsar un botón", () => {
    // El cambio de fórmula no puede tocar lo ya cobrado. En la ficha, `delivery_fee` solo cambia
    // dentro de un `onClick`; si alguien lo pusiera en un efecto, esto lo caza.
    const modal = readFileSync("src/components/OrderModal.tsx", "utf8");
    for (const campo of ["feeSuggestion.list", "feeSuggestion.discount"]) {
      for (const trozo of todasLasVeces(modal, `set("delivery_fee", ${campo}`)) {
        expect(trozo, campo).toContain("onClick");
      }
    }
  });
});

/** Los 200 caracteres anteriores a cada aparición, para mirar en qué contexto está. */
function todasLasVeces(texto: string, aguja: string): string[] {
  const trozos: string[] = [];
  let i = texto.indexOf(aguja);
  while (i !== -1) {
    trozos.push(texto.slice(Math.max(0, i - 200), i + aguja.length));
    i = texto.indexOf(aguja, i + 1);
  }
  return trozos;
}
