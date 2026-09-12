import { describe, it, expect } from "vitest";
import {
  suggestDeliveryFee, pasoTarifa, listFee, discountFee,
  TARIFA_LISTA, TARIFA_DESCUENTO, UMBRAL_CORTO, UMBRAL_LARGO, FACTOR_MEDIO, filasDeLaFormula,
} from "./pricing";
import { todayISO } from "./utils";

// El desglose existe para que un admin pueda ver POR QUÉ el botón dice lo que dice. Si pudiera
// discrepar del botón sería peor que no tenerlo, así que lo que se prueba aquí no es que el
// texto quede bonito: es que los pasos **reconstruyen** el importe, y que el importe sale de
// esos mismos pasos.

const MILLAS = [0, 5, 10, 10.9, 11, 25, 37.4, 50, 50.1, 51, 80, 120];

describe("el desglose reconstruye el importe, tramo a tramo", () => {
  it("bruto redondeado más recargo es exactamente el total, en los dos caminos", () => {
    for (const local of [true, false]) {
      for (const mi of MILLAS) {
        for (const recargo of [0, 35]) {
          for (const tabla of [TARIFA_LISTA, TARIFA_DESCUENTO]) {
            const p = pasoTarifa(mi, local, tabla, recargo);
            const esperado = Math.round(p.bruto / 10) * 10 + recargo;
            expect(p.total, `${mi} mi · local=${local} · recargo=${recargo}`).toBe(esperado);
            expect(p.redondeado + p.recargo).toBe(p.total);
          }
        }
      }
    }
  });

  it("y el bruto es base más millas por factor, que es la regla que se enseña", () => {
    for (const local of [true, false]) {
      for (const mi of MILLAS) {
        const p = pasoTarifa(mi, local, TARIFA_LISTA);
        expect(p.bruto, `${mi} mi · local=${local}`).toBeCloseTo(p.base + mi * p.factor, 10);
      }
    }
  });
});

describe("las funciones de tarifa salen del desglose, no al lado", () => {
  // El control de que no hay dos cálculos: si alguien reintrodujera un `if` propio en `listFee`,
  // esto caería en cuanto los dos se separaran en un solo valor.
  it("listFee y discountFee coinciden con su paso para cada milla", () => {
    for (const local of [true, false]) {
      for (const mi of MILLAS) {
        expect(listFee(mi, local), `list ${mi}/${local}`).toBe(pasoTarifa(mi, local, TARIFA_LISTA).redondeado);
        expect(discountFee(mi, local), `disc ${mi}/${local}`).toBe(pasoTarifa(mi, local, TARIFA_DESCUENTO).redondeado);
      }
    }
  });
});

describe("los bordes de los tramos son los del código, no los que uno diría", () => {
  it("10.9 es corto, 11 y 50 son del medio, 50.1 es largo", () => {
    expect(pasoTarifa(10.9, true, TARIFA_LISTA).tramo).toBe("local-corto");
    expect(pasoTarifa(UMBRAL_CORTO, true, TARIFA_LISTA).tramo).toBe("local-medio");
    expect(pasoTarifa(UMBRAL_LARGO, true, TARIFA_LISTA).tramo).toBe("local-medio");
    expect(pasoTarifa(50.1, true, TARIFA_LISTA).tramo).toBe("local-largo");
  });

  it("y una tabla que dijera «hasta 10 / 11 a 49 / 50 o más» estaría mintiendo", () => {
    // Control explícito del error que se quiere evitar: en 50 el precio es el del medio, y no
    // el del tramo largo. Si alguien cambiara el comparador, esta cae.
    expect(listFee(UMBRAL_LARGO, true)).toBe(Math.round((TARIFA_LISTA.baseMedio + UMBRAL_LARGO * FACTOR_MEDIO) / 10) * 10);
    expect(listFee(UMBRAL_LARGO, true)).not.toBe(Math.round((TARIFA_LISTA.baseLargo + UMBRAL_LARGO) / 10) * 10);
  });

  it("fuera de la zona local no hay tramos: una sola regla", () => {
    for (const mi of MILLAS) expect(pasoTarifa(mi, false, TARIFA_LISTA).tramo).toBe("nolocal");
  });
});

describe("suggestDeliveryFee: el desglose y el importe son el mismo número", () => {
  const pedido = (extra: Record<string, unknown> = {}) => ({
    delivery_address: "100 Main St, McAllen, TX", route_miles: 32, ...extra,
  });

  it("list y discount salen del desglose", () => {
    const f = suggestDeliveryFee(pedido());
    expect(f.breakdown).not.toBeNull();
    expect(f.list).toBe(f.breakdown!.list.total);
    expect(f.discount).toBe(f.breakdown!.discount.total);
  });

  it("con recargo de mismo día, el desglose lo lleva dentro y sigue cuadrando", () => {
    const f = suggestDeliveryFee(pedido({ delivery_date: todayISO() }), { same_day_surcharge: 35 });
    expect(f.sameDay).toBe(true);
    expect(f.breakdown!.list.recargo).toBe(35);
    expect(f.list).toBe(f.breakdown!.list.redondeado + 35);
    // Y el control: sin recargo, el mismo pedido da el mismo redondeado y otro total.
    const sin = suggestDeliveryFee(pedido());
    expect(sin.breakdown!.list.redondeado).toBe(f.breakdown!.list.redondeado);
    expect(sin.list).toBe(f.list! - 35);
  });

  it("sin millas no hay desglose, porque no hay nada que explicar", () => {
    const f = suggestDeliveryFee(pedido({ route_miles: null }));
    expect(f.list).toBeNull();
    expect(f.breakdown).toBeNull();
  });

  it("sin dirección tampoco", () => {
    expect(suggestDeliveryFee({ delivery_address: "" }).breakdown).toBeNull();
  });
});

// ---- La tabla de Ajustes sale del código, no de una copia -----------------------------------
// El encargo pedía «las reglas tal como están en el comentario de pricing.ts». Copiarlas a mano
// habría sido escribir una segunda fuente que envejece: el día que alguien cambie un 120, el
// precio cambia y la tabla sigue diciendo lo de antes, con la firma de la app detrás.
describe("filasDeLaFormula", () => {
  const filas = filasDeLaFormula();

  it("son cuatro filas por dos columnas: ocho reglas, no cinco", () => {
    expect(filas).toHaveLength(4);
    expect(filas.flatMap((f) => [f.lista, f.descuento])).toHaveLength(8);
  });

  it("los rangos son los comparadores del código, con 11 y 50 en el medio", () => {
    expect(filas.map((f) => f.rango)).toEqual([
      `< ${UMBRAL_CORTO} mi`,
      `${UMBRAL_CORTO}–${UMBRAL_LARGO} mi`,
      `> ${UMBRAL_LARGO} mi`,
      "cualquier distancia",
    ]);
  });

  it("y las reglas llevan las constantes de verdad, no números escritos aparte", () => {
    const local = filas.filter((f) => f.zona === "local");
    expect(local[0].lista).toBe(`$${TARIFA_LISTA.planoCorto} fijo`);
    expect(local[0].descuento).toBe(`$${TARIFA_DESCUENTO.planoCorto} fijo`);
    expect(local[1].lista).toBe(`${TARIFA_LISTA.baseMedio} + ${FACTOR_MEDIO} × mi`);
    expect(local[2].lista).toBe(`${TARIFA_LISTA.baseLargo} + mi`);
    expect(filas[3].lista).toBe(`${TARIFA_LISTA.baseNoLocal} + mi`);
    expect(filas[3].descuento).toBe(`${TARIFA_DESCUENTO.baseNoLocal} + mi`);
  });

  it("cada fila nombra el tramo que de verdad aplica a esas millas", () => {
    // El control de que la tabla se GENERA evaluando y no describiendo: el tramo de cada fila
    // tiene que coincidir con el que `pasoTarifa` elige para una milla de ese rango.
    expect(filas[0].tramo).toBe(pasoTarifa(0, true, TARIFA_LISTA).tramo);
    expect(filas[1].tramo).toBe(pasoTarifa(UMBRAL_CORTO, true, TARIFA_LISTA).tramo);
    expect(filas[2].tramo).toBe(pasoTarifa(UMBRAL_LARGO + 1, true, TARIFA_LISTA).tramo);
    expect(filas[3].tramo).toBe(pasoTarifa(0, false, TARIFA_LISTA).tramo);
  });
});
