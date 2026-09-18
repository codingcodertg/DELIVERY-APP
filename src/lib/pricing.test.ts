import { describe, it, expect } from "vitest";
import {
  conSuelo, deliveryFee, isLocalCity, pasoTarifa, redondear, REDONDEO, suggestDeliveryFee, TARIFA,
  UMBRAL_CORTO, UMBRAL_LARGO,
} from "@/lib/pricing";

/**
 * El suelo del tramo del medio de la LISTA. Estas pruebas miran `deliveryFee` sin pedir precio, que
 * es la lista; desde D-317 el descuento tiene el suyo (`TARIFA.discount.minimoMedio`) y no es este.
 */
const MINIMO_MEDIO = TARIFA.list.minimoMedio;
import { todayISO } from "@/lib/utils";

describe("isLocalCity", () => {
  it("matches a local-zone city case-insensitively", () => {
    expect(isLocalCity("McAllen")).toBe(true);
    expect(isLocalCity("mcallen")).toBe(true);
    expect(isLocalCity("BROWNSVILLE")).toBe(true);
  });
  it("rejects a city outside the zone", () => {
    expect(isLocalCity("Laredo")).toBe(false);
    expect(isLocalCity("")).toBe(false);
  });
  it("honors an admin-overridden city list", () => {
    expect(isLocalCity("McAllen", { local_cities: ["Roma"] })).toBe(false);
    expect(isLocalCity("Roma", { local_cities: ["Roma"] })).toBe(true);
  });
});

// La fórmula del dueño (D-283): «more than 50 miles 300+(0.80$ x mile), when below 50 miles
// min 105+(0.80 per mile) and round to the nearest 5». El tramo plano de menos de 11 millas se
// queda, por respuesta suya.
describe("deliveryFee: un solo precio, redondeado a 5", () => {
  it("es plano de $100 por debajo de 11 millas", () => {
    expect(deliveryFee(0)).toBe(100);
    expect(deliveryFee(10)).toBe(100);
    expect(deliveryFee(10.9)).toBe(100);
  });

  it("de 11 a 50 millas: 105 + 0,80 × millas", () => {
    expect(deliveryFee(11)).toBe(115);   // 105 + 8,8 = 113,8 → 115
    expect(deliveryFee(13)).toBe(115);   // 105 + 10,4 = 115,4 → 115
    expect(deliveryFee(27)).toBe(125);   // 105 + 21,6 = 126,6 → 125
    expect(deliveryFee(50)).toBe(145);   // 105 + 40 = 145 → 145
  });

  it("por encima de 50 millas: 300 + 0,80 × millas", () => {
    expect(deliveryFee(50.1)).toBe(340); // 300 + 40,08 = 340,08 → 340
    expect(deliveryFee(51)).toBe(340);   // 300 + 40,8 = 340,8 → 340
    expect(deliveryFee(60)).toBe(350);   // 300 + 48 = 348 → 350
    expect(deliveryFee(180)).toBe(445);  // 300 + 144 = 444 → 445
  });

  it("el borde de las 50 millas está en el tramo de abajo, no en el de arriba", () => {
    expect(pasoTarifa(UMBRAL_LARGO, true).tramo).toBe("local-medio");
    expect(pasoTarifa(UMBRAL_LARGO + 0.1, true).tramo).toBe("local-largo");
    // Y el salto que eso deja, que es de los números del dueño: 145 a 50 millas y 340 a 50,1.
    expect([deliveryFee(UMBRAL_LARGO), deliveryFee(UMBRAL_LARGO + 0.1)]).toEqual([145, 340]);
  });

  it("el borde de las 11 millas: plano abajo, fórmula desde 11, con su escalón", () => {
    expect(pasoTarifa(UMBRAL_CORTO - 0.1, true).tramo).toBe("local-corto");
    expect(pasoTarifa(UMBRAL_CORTO, true).tramo).toBe("local-medio");
    // 10,9 millas cuestan 100 y 11 millas cuestan 115: el escalón sube 15 al cruzar.
    expect([deliveryFee(10.9), deliveryFee(11)]).toEqual([100, 115]);
  });

  it("fuera de la zona local: 500 + 0,80 × millas", () => {
    expect(deliveryFee(13, false)).toBe(510);  // 500 + 10,4 = 510,4 → 510
    expect(deliveryFee(60, false)).toBe(550);  // 500 + 48 = 548 → 550
  });
});

describe("el redondeo y el suelo", () => {
  it("redondea al múltiplo de 5 más cercano, y el medio sube", () => {
    expect(REDONDEO).toBe(5);
    expect(redondear(2.5)).toBe(5);
    expect(redondear(7.5)).toBe(10);
    expect(redondear(2.4)).toBe(0);
    expect(redondear(117.5)).toBe(120);
    // Una tarifa real que cae justo en el medio: 105 + 0,8 × 15,625 = 117,5.
    expect(deliveryFee(15.625)).toBe(120);
  });

  it("baja cuando toca bajar", () => {
    expect(redondear(126.6)).toBe(125);
    expect(deliveryFee(27)).toBe(125);
  });

  it("el suelo se aplica DESPUÉS de redondear, así que el redondeo no se lo come", () => {
    expect(conSuelo(100, MINIMO_MEDIO)).toBe(MINIMO_MEDIO);
    expect(conSuelo(110, MINIMO_MEDIO)).toBe(110);
    expect(conSuelo(100, null)).toBe(100);
    // Con un suelo que no sea múltiplo del escalón, el orden importa: redondear después lo
    // dejaría por debajo del mínimo.
    expect(conSuelo(redondear(101), 103)).toBe(103);
    expect(redondear(conSuelo(101, 103))).toBe(105);
  });

  it("ningún precio del tramo del medio queda por debajo del suelo", () => {
    for (let mi = UMBRAL_CORTO; mi <= UMBRAL_LARGO; mi += 0.5) {
      expect(deliveryFee(mi), `${mi} mi`).toBeGreaterThanOrEqual(MINIMO_MEDIO);
    }
  });

  it("hoy el suelo no muerde, y el tramo plano se queda por debajo de él", () => {
    // Está escrito, no porque haga falta con estas cifras, sino para que siga estando el día que
    // alguien baje la base. Si algún día muerde, este falso cae y hay que mirar por qué.
    for (const mi of [UMBRAL_CORTO, 20, UMBRAL_LARGO]) expect(pasoTarifa(mi, true).minimoAplicado).toBe(false);
    // Y el suelo es del tramo del medio, no de todo lo local: el plano sigue en 100 < 105.
    expect(pasoTarifa(0, true).minimo).toBeNull();
    expect(deliveryFee(0)).toBeLessThan(MINIMO_MEDIO);
  });
});

describe("suggestDeliveryFee", () => {
  it("prices by miles and marks a local city as no-approval", () => {
    const s = suggestDeliveryFee({ delivery_address: "123 Main St, McAllen, TX 78501", route_miles: 13 });
    expect(s.zone).toBe("local");
    expect(s.list).toBe(115);      // 105 + 10,4 = 115,4 → 115
    expect(s.discount).toBe(110);  // 100 + 10,4 = 110,4 → 110 (D-317: fila propia del descuento)
    expect(s.needsApproval).toBe(false);
  });
  it("uses the not-local formula (500 + mi·0.8) and flags for approval", () => {
    const s = suggestDeliveryFee({ delivery_address: "500 Ranch Rd, Falfurrias, TX", route_miles: 60 });
    expect(s.zone).toBe("nonlocal");
    expect(s.list).toBe(550);       // 500 + 48 = 548 → 550
    expect(s.discount).toBe(450);   // 400 + 48 = 448 → 450 (D-317: deja de ser igual a la lista)
    expect(s.needsApproval).toBe(true);
  });
  it("leaves the fee null until the route miles are known", () => {
    const s = suggestDeliveryFee({ delivery_address: "1 Palm Ave, McAllen, TX", route_miles: null });
    expect(s.list).toBeNull();
    expect(s.discount).toBeNull();
    expect(s.breakdown).toBeNull();
  });
  it("stays 'unknown' with no delivery address", () => {
    expect(suggestDeliveryFee({ delivery_address: "", route_miles: 20 }).zone).toBe("unknown");
  });

  it("adds the same-day surcharge only when the delivery date is today", () => {
    // "Today" must come from the business-timezone helper the code itself
    // uses. Building it from the machine's local date only agreed by luck —
    // it broke as soon as the two disagreed, which they do every evening on a
    // machine that isn't set to US Central.
    const iso = todayISO();
    const base = { delivery_address: "123 Main St, McAllen, TX 78501", route_miles: 13 };

    const same = suggestDeliveryFee({ ...base, delivery_date: iso }, { same_day_surcharge: 50 });
    expect(same.sameDay).toBe(true);
    expect(same.sameDaySurcharge).toBe(50);
    expect(same.list).toBe(165);  // 115 + 50: el recargo se suma DESPUÉS de redondear

    const other = suggestDeliveryFee({ ...base, delivery_date: "2020-01-01" }, { same_day_surcharge: 50 });
    expect(other.sameDay).toBe(false);
    expect(other.list).toBe(115);
  });

  it("does not surcharge when the amount is 0 (feature off)", () => {
    const s = suggestDeliveryFee({ delivery_address: "1 Palm Ave, McAllen, TX", route_miles: 13, delivery_date: todayISO() }, { same_day_surcharge: 0 });
    expect(s.sameDay).toBe(false);
    expect(s.list).toBe(115);
  });

  it("es una SUGERENCIA: no toca la orden que recibe", () => {
    const orden = { delivery_address: "123 Main St, McAllen, TX 78501", route_miles: 13, delivery_fee: 999 };
    const copia = { ...orden };
    const s = suggestDeliveryFee(orden);
    expect(orden).toEqual(copia);
    // Y la tarifa guardada sigue siendo la que estaba, no la sugerida.
    expect(orden.delivery_fee).toBe(999);
    expect(s.list).toBe(115);
  });
});
