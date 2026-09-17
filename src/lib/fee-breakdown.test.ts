import { describe, it, expect } from "vitest";
import {
  conSuelo, deliveryFee, filasDeLaFormula, FACTOR_MILLA, MINIMO_MEDIO, pasoTarifa, redondear,
  suggestDeliveryFee, TARIFA, UMBRAL_CORTO, UMBRAL_LARGO,
} from "./pricing";
import { todayISO } from "./utils";
import { readFileSync } from "node:fs";

// El desglose existe para que un admin pueda ver POR QUÉ el botón dice lo que dice. Si pudiera
// discrepar del botón sería peor que no tenerlo, así que lo que se prueba aquí no es que el
// texto quede bonito: es que los pasos **reconstruyen** el importe, y que el importe sale de
// esos mismos pasos.

const MILLAS = [0, 5, 10, 10.9, 11, 25, 37.4, 50, 50.1, 51, 80, 120];

describe("el desglose reconstruye el importe, tramo a tramo", () => {
  it("bruto redondeado, con su suelo, más recargo es exactamente el total", () => {
    for (const local of [true, false]) {
      for (const mi of MILLAS) {
        for (const recargo of [0, 35]) {
          const p = pasoTarifa(mi, local, recargo);
          const esperado = conSuelo(redondear(p.bruto), p.minimo) + recargo;
          expect(p.total, `${mi} mi · local=${local} · recargo=${recargo}`).toBe(esperado);
          expect(p.redondeado + p.recargo).toBe(p.total);
        }
      }
    }
  });

  it("y el bruto es base más millas por factor, que es la regla que se enseña", () => {
    for (const local of [true, false]) {
      for (const mi of MILLAS) {
        const p = pasoTarifa(mi, local);
        expect(p.bruto, `${mi} mi · local=${local}`).toBeCloseTo(p.base + mi * p.factor, 10);
      }
    }
  });

  it("el escalón del redondeo viaja en el paso, para que la pantalla no lo escriba a mano", () => {
    for (const mi of MILLAS) expect(pasoTarifa(mi, true).redondeo).toBe(redondear(mi) === 0 ? 5 : 5);
  });
});

describe("la función de tarifa sale del desglose, no al lado", () => {
  // El control de que no hay dos cálculos: si alguien reintrodujera un `if` propio en
  // `deliveryFee`, esto caería en cuanto los dos se separaran en un solo valor.
  it("deliveryFee coincide con su paso para cada milla", () => {
    for (const local of [true, false]) {
      for (const mi of MILLAS) {
        expect(deliveryFee(mi, local), `${mi}/${local}`).toBe(pasoTarifa(mi, local).redondeado);
      }
    }
  });
});

describe("los bordes de los tramos son los del código, no los que uno diría", () => {
  it("10.9 es corto, 11 y 50 son del medio, 50.1 es largo", () => {
    expect(pasoTarifa(10.9, true).tramo).toBe("local-corto");
    expect(pasoTarifa(UMBRAL_CORTO, true).tramo).toBe("local-medio");
    expect(pasoTarifa(UMBRAL_LARGO, true).tramo).toBe("local-medio");
    expect(pasoTarifa(50.1, true).tramo).toBe("local-largo");
  });

  it("y una tabla que dijera «hasta 10 / 11 a 49 / 50 o más» estaría mintiendo", () => {
    // Control explícito del error que se quiere evitar: en 50 el precio es el del medio, y no
    // el del tramo largo. Si alguien cambiara el comparador, esta cae.
    expect(deliveryFee(UMBRAL_LARGO, true)).toBe(redondear(TARIFA.baseMedio + UMBRAL_LARGO * FACTOR_MILLA));
    expect(deliveryFee(UMBRAL_LARGO, true)).not.toBe(redondear(TARIFA.baseLargo + UMBRAL_LARGO * FACTOR_MILLA));
  });

  it("fuera de la zona local no hay tramos: una sola regla", () => {
    for (const mi of MILLAS) expect(pasoTarifa(mi, false).tramo).toBe("nolocal");
  });
});

describe("suggestDeliveryFee: el desglose y el importe son el mismo número", () => {
  const pedido = (extra: Record<string, unknown> = {}) => ({
    delivery_address: "100 Main St, McAllen, TX", route_miles: 32, ...extra,
  });

  it("el importe sale del desglose", () => {
    const f = suggestDeliveryFee(pedido());
    expect(f.breakdown).not.toBeNull();
    expect(f.fee).toBe(f.breakdown!.paso.total);
  });

  it("con recargo de mismo día, el desglose lo lleva dentro y sigue cuadrando", () => {
    const f = suggestDeliveryFee(pedido({ delivery_date: todayISO() }), { same_day_surcharge: 35 });
    expect(f.sameDay).toBe(true);
    expect(f.breakdown!.paso.recargo).toBe(35);
    expect(f.fee).toBe(f.breakdown!.paso.redondeado + 35);
    // Y el control: sin recargo, el mismo pedido da el mismo redondeado y otro total.
    const sin = suggestDeliveryFee(pedido());
    expect(sin.breakdown!.paso.redondeado).toBe(f.breakdown!.paso.redondeado);
    expect(sin.fee).toBe(f.fee! - 35);
  });

  it("sin millas no hay desglose, porque no hay nada que explicar", () => {
    const f = suggestDeliveryFee(pedido({ route_miles: null }));
    expect(f.fee).toBeNull();
    expect(f.breakdown).toBeNull();
  });

  it("sin dirección tampoco", () => {
    expect(suggestDeliveryFee({ delivery_address: "" }).breakdown).toBeNull();
  });
});

// ---- La tabla de Ajustes sale del código, no de una copia -----------------------------------
// El encargo pedía «las reglas tal como están en el comentario de pricing.ts». Copiarlas a mano
// habría sido escribir una segunda fuente que envejece: el día que alguien cambie un 105, el
// precio cambia y la tabla sigue diciendo lo de antes, con la firma de la app detrás.
describe("filasDeLaFormula", () => {
  const filas = filasDeLaFormula();

  it("son cuatro reglas, una por tramo: ya no hay columna de descuento", () => {
    expect(filas).toHaveLength(4);
    expect(filas.map((f) => f.regla)).toHaveLength(4);
    expect(filas.every((f) => "regla" in f)).toBe(true);
  });

  // Se comparan los DATOS y no las frases: el texto es de quien pinta, y en su idioma. Una
  // prueba sobre cadenas en español habría pasado igual con la tabla saliendo solo en español
  // bajo cabeceras traducidas, que es exactamente el fallo que tenía.
  it("los bordes son los comparadores del código, con 11 y 50 en el medio", () => {
    expect(filas.map((f) => [f.desde, f.hasta])).toEqual([
      [null, UMBRAL_CORTO],
      [UMBRAL_CORTO, UMBRAL_LARGO],
      [UMBRAL_LARGO, null],
      [null, null],
    ]);
  });

  it("y las reglas llevan las constantes de verdad, no números escritos aparte", () => {
    const local = filas.filter((f) => f.zona === "local");
    expect(local[0].regla).toEqual({ base: TARIFA.planoCorto, factor: 0, minimo: null });
    expect(local[1].regla).toEqual({ base: TARIFA.baseMedio, factor: FACTOR_MILLA, minimo: MINIMO_MEDIO });
    expect(local[2].regla).toEqual({ base: TARIFA.baseLargo, factor: FACTOR_MILLA, minimo: null });
    expect(filas[3].regla).toEqual({ base: TARIFA.baseNoLocal, factor: FACTOR_MILLA, minimo: null });
  });

  it("el suelo es del tramo del medio y de ningún otro", () => {
    expect(filas.filter((f) => f.regla.minimo != null).map((f) => f.tramo)).toEqual(["local-medio"]);
  });

  it("cada fila nombra el tramo que de verdad aplica a esas millas", () => {
    // El control de que la tabla se GENERA evaluando y no describiendo: el tramo de cada fila
    // tiene que coincidir con el que `pasoTarifa` elige para una milla de ese rango.
    expect(filas[0].tramo).toBe(pasoTarifa(0, true).tramo);
    expect(filas[1].tramo).toBe(pasoTarifa(UMBRAL_CORTO, true).tramo);
    expect(filas[2].tramo).toBe(pasoTarifa(UMBRAL_LARGO + 1, true).tramo);
    expect(filas[3].tramo).toBe(pasoTarifa(0, false).tramo);
  });
});

// ---- Donde se enseña la tarifa, se enseña cómo salió (D-249) -------------------------------
// D-244 puso el desglose en UN sitio, y «Tarifa sugerida» se pinta en dos: el bloque de zona
// local y el del paso del mapa. El dueño calculó la tarifa desde el mapa —que es el camino de
// quien crea un pedido paso a paso— y no encontró el «¿Cómo se calculó?».
//
// La prueba recorre el fichero en vez de mirar una lista escrita a mano, así que el tercer sitio
// que aparezca tampoco podrá quedarse sin él.
describe("todo sitio que pinte «Tarifa sugerida» pinta también el desglose", () => {
  const src = readFileSync("src/components/OrderModal.tsx", "utf8");
  const lineas = src.split(/\r?\n/);

  const dondeSePinta = (aguja: string) =>
    lineas.reduce<number[]>((acc, l, i) => (l.includes(aguja) ? [...acc, i] : acc), []);

  const sitios = dondeSePinta('t("Suggested fee:"');
  const desgloses = dondeSePinta("<FeeBreakdownDetails");

  it("hay al menos dos sitios, que es lo que hizo falta descubrir", () => {
    // Control: si el recorrido devolviera cero o uno, la prueba de abajo pasaría sin comprobar
    // nada — que es exactamente cómo D-244 se quedó a medias.
    expect(sitios.length).toBeGreaterThanOrEqual(2);
  });

  it("y hay un desglose por cada uno", () => {
    expect(desgloses).toHaveLength(sitios.length);
  });

  it("cada desglose va después de su «Tarifa sugerida» y antes del siguiente", () => {
    // Que los números cuadren no basta: los dos desgloses podrían estar juntos al final. Se
    // exige que cada bloque tenga el suyo dentro de su tramo.
    for (let i = 0; i < sitios.length; i++) {
      const desde = sitios[i];
      const hasta = i + 1 < sitios.length ? sitios[i + 1] : lineas.length;
      const dentro = desgloses.filter((d) => d > desde && d < hasta);
      expect(dentro, `el bloque de la línea ${desde + 1} no tiene desglose`).toHaveLength(1);
    }
  });

  it("y los dos con la misma condición: rol REAL admin", () => {
    const conGuarda = lineas.filter((l) => l.includes('realRole === "admin" && feeSuggestion.breakdown'));
    expect(conGuarda).toHaveLength(sitios.length);
  });
});

// ---- Un solo precio, en las tres pantallas (D-NEXT) ----------------------------------------
describe("donde había dos precios ahora hay uno", () => {
  const modal = readFileSync("src/components/OrderModal.tsx", "utf8");
  const desglose = readFileSync("src/components/FeeBreakdown.tsx", "utf8");
  const ajustes = readFileSync("src/app/(app)/settings/page.tsx", "utf8");

  it("el modal ya no nombra el descuento, y el botón es el precio único", () => {
    expect(modal).not.toMatch(/feeSuggestion\.(list|discount)/);
    expect(modal).toContain("feeSuggestion.fee");
  });

  it("y cobrar por debajo de ESE precio sigue pidiendo aprobación", () => {
    // Hasta D-NEXT el suelo del aviso era el descuento. Al quedar un solo precio, el suelo es
    // ese; si el aviso desapareciera, nadie se enteraría de que hace falta aprobación.
    expect(modal).toContain("d.delivery_fee < feeSuggestion.fee");
    expect(modal).toMatch(/requires approval/);
  });

  it("el desglose enseña el mínimo solo cuando mordió, y con su texto compartido", () => {
    expect(desglose).toContain("paso.minimoAplicado");
    expect(desglose).toContain("textoDelMinimo(t, paso.minimo)");
    expect(desglose).toContain("textoDelRedondeo(t, paso.redondeo)");
  });

  it("la tabla de Ajustes pasa el mínimo, o diría una regla sin su suelo", () => {
    expect(ajustes).toContain("f.regla.minimo");
    expect(ajustes).not.toContain("f.descuento");
  });
});
