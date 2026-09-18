import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  deliveryFee, FACTOR_MILLA, pasoTarifa, redondear, suggestDeliveryFee, TARIFA,
  UMBRAL_CORTO, UMBRAL_LARGO,
} from "./pricing";

/**
 * El precio con descuento, con su propia fila de cifras (D-303, y D-317).
 *
 * D-283 lo quitó porque el dueño pidió un solo precio esa mañana; esa misma tarde pidió el descuento
 * de vuelta: «discounted fee was removed, bring it back», con una cifra suya para el tramo largo:
 * «discounted price for local deliveries over 50 mi will be = 105+(0.80 x miles)».
 *
 * Eso dejó el descuento como **un solo tramo que se cobraba distinto**: en los otros tres cobraba
 * exactamente lo mismo que la lista. El dueño lo leyó como que no existía — *«the original
 * calculation of the discount is not appearing fix it and work on that»*—, y D-317 le devuelve su
 * fila entera: más barato en los **cuatro** tramos.
 *
 * Lo que se mide aquí es la tabla de millas entera y las dos reglas que no pueden romperse: que el
 * descuento **nunca** supere a la lista, y que una orden ya guardada no se recalcule sola.
 */

describe("la tabla de millas, lista y descuento", () => {
  // Las cifras del dueño, contadas una vez y a mano. Si alguna cambia, cambia el precio de verdad.
  const CASOS: { mi: number; local: boolean; lista: number; descuento: number; cuenta: string }[] = [
    { mi: 0,    local: true,  lista: 100, descuento: 80,  cuenta: "planos los dos: 100 y 80" },
    { mi: 10.9, local: true,  lista: 100, descuento: 80,  cuenta: "planos hasta el borde" },
    { mi: 11,   local: true,  lista: 115, descuento: 110, cuenta: "lista 105 + 8,8 = 113,8 → 115 · descuento 100 + 8,8 = 108,8 → 110" },
    { mi: 27,   local: true,  lista: 125, descuento: 120, cuenta: "lista 105 + 21,6 = 126,6 → 125 · descuento 100 + 21,6 = 121,6 → 120" },
    { mi: 50,   local: true,  lista: 145, descuento: 140, cuenta: "lista 105 + 40 = 145 · descuento 100 + 40 = 140" },
    { mi: 50.1, local: true,  lista: 340, descuento: 145, cuenta: "lista 300 + 40,08 → 340 · descuento 105 + 40,08 = 145,08 → 145" },
    { mi: 60,   local: true,  lista: 350, descuento: 155, cuenta: "lista 300 + 48 = 348 → 350 · descuento 105 + 48 = 153 → 155" },
    { mi: 180,  local: true,  lista: 445, descuento: 250, cuenta: "lista 300 + 144 = 444 → 445 · descuento 105 + 144 = 249 → 250" },
    { mi: 13,   local: false, lista: 510, descuento: 410, cuenta: "fuera de zona: lista 500 + 10,4 → 510 · descuento 400 + 10,4 → 410" },
    { mi: 60,   local: false, lista: 550, descuento: 450, cuenta: "fuera de zona: lista 500 + 48 = 548 → 550 · descuento 400 + 48 = 448 → 450" },
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

describe("el descuento, estrictamente por debajo de la lista", () => {
  it("en cada milla de 0 a 200, de media en media, y en los CUATRO tramos", () => {
    // Antes era «≤», porque coincidían en tres de los cuatro tramos. Desde D-317 es «<» de verdad:
    // el descuento tiene su propia fila de bases, así que nunca vuelve a repetir el precio de lista.
    // Se recogen los tramos vistos para que la prueba no pueda pasar recorriendo solo uno.
    const tramosVistos = new Set<string>();
    for (const local of [true, false]) {
      for (let mi = 0; mi <= 200; mi += 0.5) {
        const lista = deliveryFee(mi, local, "list");
        const descuento = deliveryFee(mi, local, "discount");
        expect(descuento, `${mi} mi · local=${local}`).toBeLessThan(lista);
        tramosVistos.add(pasoTarifa(mi, local).tramo);
      }
    }
    expect([...tramosVistos].sort()).toEqual(["local-corto", "local-largo", "local-medio", "nolocal"]);
  });

  it("cuánto descuenta cada tramo, contado a mano", () => {
    // El control de que «<» no pasa por un dólar de casualidad, y de que el descuento no se comió
    // la lista: las diferencias son las que salen de las dos filas de bases.
    expect(deliveryFee(5, true, "list") - deliveryFee(5, true, "discount")).toBe(20);      // 100 − 80
    expect(deliveryFee(27, true, "list") - deliveryFee(27, true, "discount")).toBe(5);     // 105 − 100
    expect(deliveryFee(60, true, "list") - deliveryFee(60, true, "discount")).toBe(195);   // 300 − 105
    expect(deliveryFee(60, false, "list") - deliveryFee(60, false, "discount")).toBe(100); // 500 − 400
  });

  it("cada tramo del descuento sale de SU base, no de la de otro tramo", () => {
    const suelo = (x: number, min: number | null) => (min == null ? x : Math.max(min, x));
    const D = TARIFA.discount;
    for (const mi of [0, 5, 10.9]) expect(deliveryFee(mi, true, "discount"), `${mi} mi`).toBe(D.planoCorto);
    for (const mi of [11, 27, 50]) {
      expect(deliveryFee(mi, true, "discount"), `${mi} mi`).toBe(suelo(redondear(D.baseMedio + mi * FACTOR_MILLA), D.minimoMedio));
    }
    for (const mi of [50.1, 60, 97.3, 180]) {
      expect(deliveryFee(mi, true, "discount"), `${mi} mi`).toBe(suelo(redondear(D.baseLargo + mi * FACTOR_MILLA), D.minimoLargo));
    }
    for (const mi of [13, 60]) expect(deliveryFee(mi, false, "discount"), `${mi} mi`).toBe(redondear(D.baseNoLocal + mi * FACTOR_MILLA));
  });

  it("el tramo largo conserva la cifra que dictó el dueño en D-303", () => {
    // «discounted price for local deliveries over 50 mi will be = 105+(0.80 x miles)». Es lo único
    // de la fila del descuento que no se restaura de la tabla vieja: se respeta lo último que dijo.
    expect(TARIFA.discount.baseLargo).toBe(105);
    expect(deliveryFee(60, true, "discount")).toBe(redondear(105 + 60 * FACTOR_MILLA));
  });

  it("y ese 105 sale de SU fila, aunque hoy valga lo mismo que el del medio de la lista", () => {
    // Aquí el valor no puede decidir: `TARIFA.discount.baseLargo` y `TARIFA.list.baseMedio` valen
    // los dos 105, así que calcular el tramo largo del descuento con el de la lista —que es lo que
    // hacía D-303— da exactamente el mismo precio y **ninguna prueba de números lo nota**. Medido
    // con ese mutante: sobrevivió a la tanda entera. Lo que se fija es de dónde se lee.
    expect(TARIFA.discount.baseLargo).toBe(TARIFA.list.baseMedio);
    const src = readFileSync("src/lib/pricing.ts", "utf8");
    const largo = src.slice(src.indexOf('tramo: "local-largo"'));
    const linea = largo.slice(0, largo.indexOf("\n"));
    expect(linea).toContain("base: T.baseLargo");
    expect(linea).toContain("minimo: T.minimoLargo");
    expect(linea).not.toContain("TARIFA.list");
  });

  it("el paso lo dice: mismo tramo para los dos precios, y cada uno con su base y su suelo", () => {
    const d = pasoTarifa(60, true, 0, "discount");
    const l = pasoTarifa(60, true, 0, "list");
    expect([d.tramo, l.tramo]).toEqual(["local-largo", "local-largo"]);
    expect([d.desde, l.desde]).toEqual([UMBRAL_LARGO, UMBRAL_LARGO]);
    expect([d.base, l.base]).toEqual([TARIFA.discount.baseLargo, TARIFA.list.baseLargo]);
    expect([d.minimo, l.minimo]).toEqual([TARIFA.discount.minimoLargo, TARIFA.list.minimoLargo]);
  });

  it("y en los tramos donde antes coincidían, ahora el paso también difiere", () => {
    for (const mi of [0, 10.9, UMBRAL_CORTO, 27, UMBRAL_LARGO]) {
      const d = pasoTarifa(mi, true, 0, "discount");
      const l = pasoTarifa(mi, true, 0, "list");
      expect(d.tramo, `${mi} mi`).toBe(l.tramo);        // el tramo es de la distancia, no del precio
      expect(d.base, `${mi} mi`).not.toBe(l.base);      // la base sí es del precio
    }
    expect(pasoTarifa(60, false, 0, "discount").base).not.toBe(pasoTarifa(60, false, 0, "list").base);
  });

  it("el salto de $5 en el borde de 50 millas se deja dicho, no se arregla", () => {
    // A 50 mi el descuento cae en el tramo del medio (100 + 40 = 140) y a 50,1 en el largo
    // (105 + 40,08 → 145): cruzar el umbral lo SUBE $5. Es lo que sale de las dos cifras del dueño
    // —la del medio es la estructura original, la del largo es su frase de D-303— y no se suaviza
    // por cuenta propia: cambiar cualquiera de las dos es cambiarle el precio a alguien.
    expect([deliveryFee(UMBRAL_LARGO, true, "discount"), deliveryFee(UMBRAL_LARGO + 0.1, true, "discount")])
      .toEqual([140, 145]);
    // La lista salta en el mismo sitio y mucho más, y eso ya era así.
    expect([deliveryFee(UMBRAL_LARGO, true, "list"), deliveryFee(UMBRAL_LARGO + 0.1, true, "list")])
      .toEqual([145, 340]);
  });
});

describe("lo que el dueño no veía: el descuento en la pantalla", () => {
  /** Una orden de cada tramo, con una ciudad local de verdad y otra que no lo es. */
  const CIUDADES = { local: "123 Main St, McAllen, TX 78501", fuera: "500 Ranch Rd, Falfurrias, TX" };
  const MUESTRAS = [
    { mi: 5, addr: CIUDADES.local, tramo: "local-corto" },
    { mi: 27, addr: CIUDADES.local, tramo: "local-medio" },
    { mi: 80, addr: CIUDADES.local, tramo: "local-largo" },
    { mi: 60, addr: CIUDADES.fuera, tramo: "nolocal" },
  ];

  it("en los cuatro tramos, lo que llega a la ficha son DOS números, no dos veces el mismo", () => {
    for (const { mi, addr, tramo } of MUESTRAS) {
      const s = suggestDeliveryFee({ delivery_address: addr, route_miles: mi });
      expect(s.breakdown?.list.tramo, tramo).toBe(tramo);
      expect(s.discount, `${tramo} · ${mi} mi`).not.toBe(s.list);
      expect(s.discount!, `${tramo} · ${mi} mi`).toBeLessThan(s.list!);
    }
  });

  it("y por eso el diálogo del almacén lo enseña siempre, con la condición que ya tenía", () => {
    // El diálogo esconde el descuento cuando coincide con la lista. La prueba de arriba dice que
    // con esta tabla nunca coincide, así que la condición ya no puede esconderlo.
    //
    // Se cita **pegada a la línea que enseña la lista**, y no suelta: la misma condición aparece
    // tres veces en la ficha, así que un `toContain` a secas lo pasaba un cambio que dejara este
    // sitio concreto en `false`. Medido con ese mutante: con la cita suelta sobrevivía.
    const modal = readFileSync("src/components/OrderModal.tsx", "utf8").split("\r\n").join("\n");
    const bloque = `<strong>\${feeSuggestion.list}</strong> {t("list", "lista")}\n`
      + `                  {feeSuggestion.discount != null && feeSuggestion.discount !== feeSuggestion.list\n`
      + `                    && <> · \${feeSuggestion.discount} {t("discounted", "con descuento")}</>}`;
    expect(modal.split(bloque).length - 1).toBe(1);
  });

  it("los dos botones de la ficha salen de `feeSuggestion`, cada uno con su precio", () => {
    // Los dos botones existen y cada uno escribe SU número, no el de al lado. El toggle («si ya
    // está puesto, lo quita») es parte de la cita a propósito: sin él, un botón que escribiera
    // siempre la lista pasaría un `toContain` más corto.
    const modal = readFileSync("src/components/OrderModal.tsx", "utf8");
    const veces = (campo: string) =>
      modal.split(`set("delivery_fee", d.delivery_fee === feeSuggestion.${campo} ? null : feeSuggestion.${campo})`).length - 1;
    // **Se cuentan, no se buscan.** La pareja de botones está en DOS sitios de la ficha, así que un
    // «¿aparece al menos una vez?» lo pasaría un cambio que dejara uno de los dos botones del
    // descuento escribiendo la lista. Medido con ese mutante: con `>= 1` sobrevivía.
    expect([veces("list"), veces("discount")]).toEqual([2, 2]);
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
