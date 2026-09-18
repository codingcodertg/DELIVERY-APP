import { describe, it, expect } from "vitest";
import {
  conSuelo, deliveryFee, filasDeLaFormula, FACTOR_MILLA, pasoTarifa, redondear,
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
    expect(deliveryFee(UMBRAL_LARGO, true)).toBe(redondear(TARIFA.list.baseMedio + UMBRAL_LARGO * FACTOR_MILLA));
    expect(deliveryFee(UMBRAL_LARGO, true)).not.toBe(redondear(TARIFA.list.baseLargo + UMBRAL_LARGO * FACTOR_MILLA));
  });

  it("fuera de la zona local no hay tramos: una sola regla", () => {
    for (const mi of MILLAS) expect(pasoTarifa(mi, false).tramo).toBe("nolocal");
  });
});

describe("suggestDeliveryFee: el desglose y el importe son el mismo número", () => {
  const pedido = (extra: Record<string, unknown> = {}) => ({
    delivery_address: "100 Main St, McAllen, TX", route_miles: 32, ...extra,
  });

  it("los dos importes salen del desglose", () => {
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
    // El recargo va en los DOS precios: si solo cayera en la lista, el descuento saldría barato
    // en la misma pantalla.
    expect(f.breakdown!.discount.recargo).toBe(35);
    expect(f.discount).toBe(f.breakdown!.discount.redondeado + 35);
    // Y el control: sin recargo, el mismo pedido da el mismo redondeado y otro total.
    const sin = suggestDeliveryFee(pedido());
    expect(sin.breakdown!.list.redondeado).toBe(f.breakdown!.list.redondeado);
    expect(sin.list).toBe(f.list! - 35);
    expect(sin.discount).toBe(f.discount! - 35);
  });

  it("sin millas no hay desglose, porque no hay nada que explicar", () => {
    const f = suggestDeliveryFee(pedido({ route_miles: null }));
    expect(f.list).toBeNull();
    expect(f.discount).toBeNull();
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

  it("son cuatro filas, una por tramo, y cada una con sus dos columnas", () => {
    expect(filas).toHaveLength(4);
    expect(filas.every((f) => "lista" in f && "descuento" in f)).toBe(true);
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

  it("y las reglas de la lista llevan las constantes de verdad, no números escritos aparte", () => {
    const local = filas.filter((f) => f.zona === "local");
    expect(local[0].lista).toEqual({ base: TARIFA.list.planoCorto, factor: 0, minimo: null });
    expect(local[1].lista).toEqual({ base: TARIFA.list.baseMedio, factor: FACTOR_MILLA, minimo: TARIFA.list.minimoMedio });
    expect(local[2].lista).toEqual({ base: TARIFA.list.baseLargo, factor: FACTOR_MILLA, minimo: TARIFA.list.minimoLargo });
    expect(filas[3].lista).toEqual({ base: TARIFA.list.baseNoLocal, factor: FACTOR_MILLA, minimo: null });
  });

  it("y las del descuento, las suyas: la columna sale de su propia fila (D-NEXT)", () => {
    // Antes esta prueba decía «el descuento solo se separa en el tramo largo» y comprobaba que en
    // los otros tres las dos columnas eran la MISMA cifra. Desde D-NEXT el descuento tiene fila
    // propia, así que lo que se fija es lo contrario: que cada columna lleve sus constantes.
    const local = filas.filter((f) => f.zona === "local");
    expect(local[0].descuento).toEqual({ base: TARIFA.discount.planoCorto, factor: 0, minimo: null });
    expect(local[1].descuento).toEqual({ base: TARIFA.discount.baseMedio, factor: FACTOR_MILLA, minimo: TARIFA.discount.minimoMedio });
    expect(local[2].descuento).toEqual({ base: TARIFA.discount.baseLargo, factor: FACTOR_MILLA, minimo: TARIFA.discount.minimoLargo });
    expect(filas[3].descuento).toEqual({ base: TARIFA.discount.baseNoLocal, factor: FACTOR_MILLA, minimo: null });
  });

  it("las CUATRO filas enseñan dos precios distintos, que es lo que el dueño no veía", () => {
    const iguales = filas.filter((f) => JSON.stringify(f.lista) === JSON.stringify(f.descuento));
    expect(iguales.map((f) => f.tramo)).toEqual([]);
    // Y más barato, no solo distinto: una columna «distinta» y más cara no sería un descuento.
    for (const f of filas) expect(f.descuento.base, f.tramo).toBeLessThan(f.lista.base);
  });

  it("el suelo de la lista es del tramo del medio y de ningún otro", () => {
    expect(filas.filter((f) => f.lista.minimo != null).map((f) => f.tramo)).toEqual(["local-medio"]);
  });

  it("y el del descuento, del medio y del largo: su tramo largo sí lleva suelo", () => {
    expect(filas.filter((f) => f.descuento.minimo != null).map((f) => f.tramo)).toEqual(["local-medio", "local-largo"]);
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

// ---- Un solo precio, en las tres pantallas (D-283) ----------------------------------------
// Este bloque fijaba «donde había dos precios ahora hay uno» (D-283). El dueño pidió el descuento
// de vuelta el mismo día —«discounted fee was removed, bring it back»— así que **se reescribe al
// revés en vez de borrarse**: sigue siendo el canario de que las tres pantallas enseñan lo mismo
// que calcula `pricing.ts`, solo que ahora lo que tienen que enseñar son dos precios (D-303).
describe("los dos precios llegan a las tres pantallas", () => {
  const modal = readFileSync("src/components/OrderModal.tsx", "utf8");
  const desglose = readFileSync("src/components/FeeBreakdown.tsx", "utf8");
  const ajustes = readFileSync("src/app/(app)/settings/page.tsx", "utf8");

  it("el modal vuelve a nombrar los dos, y ya no queda el precio único", () => {
    expect(modal).toContain("feeSuggestion.list");
    expect(modal).toContain("feeSuggestion.discount");
    // El campo viejo tiene que haber desaparecido: si quedara uno suelto, esa pantalla seguiría
    // leyendo algo que ya no existe. Con la palabra pegada al punto, para no cazar `.fee` de otra
    // cosa.
    expect(modal).not.toMatch(/feeSuggestion\.fee\b/);
  });

  it("y TODOS los botones dicen cuál es cuál, en los dos sitios donde salen", () => {
    // Sin etiqueta, dos botones con el MISMO importe —que es lo que pasa por debajo de 50 millas—
    // se leen como un error de la pantalla.
    //
    // Se recorren TODAS las apariciones y no se busca el texto una vez: los botones están escritos
    // dos veces en el modal (el bloque compacto y el de zona), así que un `toContain` se quedaba
    // contento con que UNO llevara etiqueta mientras el otro la perdía. Lo enseñó un mutante.
    for (const [campo, etiqueta] of [
      ["feeSuggestion.list", '{t("List", "Lista")}'],
      ["feeSuggestion.discount", '{t("Discount", "Descuento")}'],
    ] as const) {
      const apariciones = [...modal.matchAll(new RegExp(`fmtMoney\\(${campo.replace(".", "\\.")}\\)`, "g"))];
      expect(apariciones.length, campo).toBeGreaterThanOrEqual(2);
      for (const m of apariciones) {
        expect(modal.slice(Math.max(0, m.index - 80), m.index), `${campo} sin etiqueta`).toContain(etiqueta);
      }
    }
  });

  it("cobrar por debajo del DESCUENTO pide aprobación, como antes de D-283", () => {
    expect(modal).toContain("d.delivery_fee < feeSuggestion.discount");
    expect(modal).toMatch(/requires approval/);
    // Y el suelo NO es la lista: con la lista de suelo, cobrar el descuento pediría aprobación.
    expect(modal).not.toContain("d.delivery_fee < feeSuggestion.list");
  });

  it("el desglose enseña los dos caminos, cada uno con su título", () => {
    expect(desglose).toContain("desglose.list");
    expect(desglose).toContain("desglose.discount");
    expect(desglose).toContain('titulo={t("Discount", "Descuento")}');
  });

  it("el desglose enseña el mínimo solo cuando mordió, y con su texto compartido", () => {
    expect(desglose).toContain("paso.minimoAplicado");
    expect(desglose).toContain("textoDelMinimo(t, paso.minimo)");
    expect(desglose).toContain("textoDelRedondeo(t, paso.redondeo)");
  });

  it("la tabla de Ajustes pinta las dos columnas, cada una con su suelo", () => {
    expect(ajustes).toContain("f.lista.minimo");
    expect(ajustes).toContain("f.descuento.minimo");
    expect(ajustes).toContain('{t("Discount", "Descuento")}');
  });
});
