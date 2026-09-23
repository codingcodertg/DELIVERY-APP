import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { redondeaDinero, redondeaMillas, sumaDinero, sumaMillas } from "./totales";
import { computeKpis, driverStats, groupVolume } from "./analytics";
import { buildDailySummary } from "./daily-summary";
import { mkDelivery } from "./__fixtures";
import type { Delivery } from "./types";

/**
 * Sumar dinero y millas, cada uno con su unidad (D-NEXT).
 *
 * Cifras inventadas: los importes y las millas de verdad son datos del dueño y no se afirman aquí.
 * Lo que se elige a propósito son valores que **contradicen** la implementación equivocada —céntimos
 * que se pierden al redondear a la décima, décimas que se pierden al redondear a entero—, porque una
 * prueba con datos ya redondos pasa con cualquier cosa.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

const dinero = (...xs: (number | null)[]) => sumaDinero(xs, (x) => x);
const millas = (...xs: (number | null)[]) => sumaMillas(xs, (x) => x);

describe("el dinero, al centavo", () => {
  it("suma sin dejar cola, aunque los sumandos la dejen en coma flotante", () => {
    // 0.1 + 0.2 en coma flotante es 0.30000000000000004. Aquí no.
    expect(dinero(0.1, 0.2)).toBe(0.3);
    expect(dinero(...Array(10).fill(0.1))).toBe(1);
  });

  it("y NO se va a la décima: los centavos son la unidad, y se ven", () => {
    // El caso que delata el redondeo equivocado: a la décima, 12.34 sería 12.3 y se perderían 4
    // centavos por orden. Con dos órdenes la diferencia ya es de 9 centavos.
    expect(dinero(12.34, 7.65)).toBe(19.99);
    expect(dinero(0.05)).toBe(0.05);
    expect(dinero(0.04)).toBe(0.04);
  });

  it("lo vacío, lo nulo y lo que no es número cuentan como cero", () => {
    expect(dinero(null, 5, null)).toBe(5);
    expect(sumaDinero([{ v: undefined }, { v: 3 }], (x) => x.v)).toBe(3);
    expect(sumaDinero([{ v: Number.NaN }, { v: 2 }], (x) => x.v)).toBe(2);
    expect(dinero()).toBe(0);
  });

  it("`redondeaDinero` es la misma unidad, para lo que no es una suma", () => {
    expect(redondeaDinero(12.345)).toBe(12.35);
    expect(redondeaDinero(12.344)).toBe(12.34);
    expect(redondeaDinero(Number.NaN)).toBe(0);
  });
});

describe("las millas, a la décima", () => {
  it("suma sin cola y baja a la décima al final", () => {
    expect(millas(1.24, 2.31)).toBe(3.6);   // 3.55 → 3.6
    expect(millas(0.1, 0.2)).toBe(0.3);
  });

  it("y NO redondea cada sumando: diez tramos de 0,04 son 0,4, no 0", () => {
    // Es el caso que importa. Redondeando por sumando —el error fácil— cada 0.04 daría 0 y el total
    // sería 0: un número mal y creíble, que es lo que D-362 llama peor porque no deja cola.
    expect(millas(...Array(10).fill(0.04))).toBe(0.4);
    expect(millas(0.04)).toBe(0);            // una sola sí se va a cero: es la décima, y es correcto
  });

  it("lo vacío cuenta como cero", () => {
    expect(millas(null, 12.5, null)).toBe(12.5);
    expect(millas()).toBe(0);
  });

  it("`redondeaMillas` es la misma unidad", () => {
    expect(redondeaMillas(3.55)).toBe(3.6);
    expect(redondeaMillas(3.54)).toBe(3.5);
    expect(redondeaMillas(Number.NaN)).toBe(0);
  });
});

describe("el resto de D-362 que quedaba en el Panel: pallets a ENTERO", () => {
  /** Cuatro órdenes de 0,1: el caso exacto que D-362 describe. */
  const cuatroDeDiezmo: Delivery[] = Array.from({ length: 4 }, (_, i) =>
    mkDelivery({ id: `p${i}`, stage: "approved", est_pallets: 0.1, actual_pallets: null, route_miles: null, delivery_fee: null }));

  it("el total del día ya no enseña «0» cuando hay 0,4", () => {
    expect(computeKpis(cuatroDeDiezmo).totalPallets).toBe(0.4);
  });

  it("ni «4» cuando hay 4,43", () => {
    const ordenes = [0.03, 0.4, 4].map((p, i) => mkDelivery({ id: `q${i}`, stage: "approved", est_pallets: p, actual_pallets: null }));
    expect(computeKpis(ordenes).totalPallets).toBe(4.4);
  });

  it("y por chofer tampoco, que es donde más se nota", () => {
    const suyas = cuatroDeDiezmo.map((d) => ({ ...d, assigned_driver: "Ana" }));
    expect(driverStats(suyas)[0].pallets).toBe(0.4);
  });

  it("ni el volumen por tienda y por cuenta, que estaba ocho líneas más abajo", () => {
    // El cuarto, en el mismo fichero: se arregla lo que se está mirando y el barrido no se hace
    // entero. Por eso además de estos casos hay una puerta, abajo.
    const suyas = cuatroDeDiezmo.map((d) => ({ ...d, store: "Norte", account: "ACME" }));
    expect(groupVolume(suyas, "store")[0].pallets).toBe(0.4);
    expect(groupVolume(suyas, "account")[0].pallets).toBe(0.4);
  });

  it("y el resumen que se publica en Notion no manda la cola de decimales", () => {
    // Es el único sitio del barrido donde el número se imprime TAL CUAL: sin `sumaPallets` decía
    // «4.430000000000001 pallets».
    const ordenes = [0.03, 0.4, 4].map((p, i) => mkDelivery({
      id: `n${i}`, stage: "delivered", est_pallets: p, actual_pallets: null,
      assigned_driver: "Ana", delivery_date: "2026-09-23", pod_delivered_at: "2026-09-23T10:00:00Z",
    }));
    const resumen = buildDailySummary(ordenes, [], "2026-09-23", () => "");
    expect(resumen.perDriver[0].pallets).toBe(4.4);
  });
});

describe("la puerta cerrada: nadie vuelve a redondear pallets a entero", () => {
  /**
   * Los casos de arriba prueban los sitios que había. Esto impide el **cuarto**.
   *
   * D-362 arregló quince sitios y se le escaparon seis; esta rama arregló tres y se le escaparon
   * otros tres —los encontró el orquestador en el mismo fichero que yo estaba tocando—. El patrón
   * es siempre el mismo: se arregla lo que se está mirando y el barrido no se hace entero. Así que
   * lo que se fija aquí no es una lista de sitios, es que **no haya ninguno**.
   *
   * Lo que se busca: una línea con `Math.round(` que hable de pallets **y que no divida después**,
   * que es lo que lo convierte en «a entero». Un `Math.round(x * 10) / 10` legítimo —la décima— no
   * cuenta, y por eso `pallets.ts` y los minutos de `utils.ts` no saltan.
   *
   * **No se mira la estructura con paréntesis, y es a propósito:** la primera versión exigía que
   * `pallets` apareciera dentro de los paréntesis del `Math.round` y se le escapó
   * `Math.round(suyas.reduce((n, d) => n + Number(d.est_pallets ?? 0), 0))`, porque el `[^)]*` se
   * paraba en el primer `)`, que era el de `Number(`. Medido con ese mutante. Una regla por línea
   * entera no tiene esa trampa.
   */
  const esEntero = (l: string) =>
    /Math\.round\(/.test(l) && /pallets/i.test(l) && !/\/\s*(10|100)\b/.test(l) && !/minPerPallet/.test(l);

  function ficherosDeSrc(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(...ficherosDeSrc(p));
      else if (/\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test.")) out.push(p);
    }
    return out;
  }

  it("ningún `Math.round` deja pallets en entero, en todo `src`", () => {
    const culpables: string[] = [];
    for (const f of ficherosDeSrc("src")) {
      // `pallets.ts` es el sitio donde la regla vive, y su `Math.round(n * 10) / 10` sí divide.
      if (f === "src/lib/pallets.ts") continue;
      leer(f).split("\n").forEach((l, i) => {
        if (l.trim().startsWith("//") || l.trim().startsWith("*")) return;  // comentarios, no código
        if (esEntero(l)) culpables.push(`${f}:${i + 1} ${l.trim().slice(0, 90)}`);
      });
    }
    expect(culpables, "pallets a entero: usa `sumaPallets` o `aLaDecima`").toEqual([]);
  });

  it("control: SÍ ve los cuatro que había, o la prueba de arriba no diría nada", () => {
    // Sin esto, un error en la regla haría que la puerta pareciera cerrada estando abierta — el
    // fallo más caro de una prueba de barrido. Son los cuatro sitios reales, copiados tal cual.
    expect(esEntero("    totalPallets: Math.round(totalPallets),")).toBe(true);
    expect(esEntero("    .map((s) => ({ ...s, pallets: Math.round(s.pallets) }))")).toBe(true);
    expect(esEntero('<span>🚚 {t("Truckload", "Viaje")} {ti + 1} · {Math.round(pallets)} pallets</span>')).toBe(true);
    // Y el que se le escapó a la primera versión, con paréntesis anidados dentro del `Math.round`.
    expect(esEntero(".map(({ suyas, ...s }) => ({ ...s, pallets: Math.round(suyas.reduce((n, d) => n + Number(d.est_pallets ?? 0), 0)) }))")).toBe(true);
    // Y NO ve los legítimos: la décima, y los minutos por pallet de `utils.ts`.
    expect(esEntero("return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;")).toBe(false);
    expect(esEntero("  return `${Math.round(n * minPerPallet)} min`;")).toBe(false);
  });
});

describe("el Excel que alguien concilia no cambia de valor", () => {
  /**
   * `export.ts` es lo único que sale de la app para que una persona lo compare con otra cosa. El
   * cambio unifica **dónde** se redondea, no **a qué**: estas cifras tienen que salir iguales a las
   * de antes. Se comprueba contra la fórmula vieja, escrita aquí a mano.
   */
  const ordenes: Delivery[] = [
    mkDelivery({ id: "a", route_miles: 12.34, delivery_fee: 105 }),
    mkDelivery({ id: "b", route_miles: 7.65, delivery_fee: 140.5 }),
    mkDelivery({ id: "c", route_miles: 0.04, delivery_fee: 0 }),
    mkDelivery({ id: "d", route_miles: null, delivery_fee: null }),
  ];

  it("las millas del banner: mismo número que `Math.round(suma * 10) / 10`", () => {
    const vieja = Math.round(ordenes.reduce((s, o) => s + (o.route_miles ?? 0), 0) * 10) / 10;
    expect(sumaMillas(ordenes, (o) => o.route_miles)).toBe(vieja);
  });

  it("y el dinero: mismo número que `suma.toFixed(2)`", () => {
    const vieja = ordenes.reduce((s, o) => s + (o.delivery_fee ?? 0), 0);
    expect(sumaDinero(ordenes, (o) => o.delivery_fee).toFixed(2)).toBe(vieja.toFixed(2));
  });

  it("y el banner del Excel sigue pintando las dos con su formato", () => {
    const src = leer("src/lib/export.ts");
    expect(src).toContain("sumaMillas(orders, (o) => o.route_miles)");
    expect(src).toContain("sumaDinero(orders, (o) => o.delivery_fee)");
    expect(src).toContain("${totalMiles} mi · $${totalFees.toFixed(2)}");
  });
});

describe("nadie suma dinero ni millas por su cuenta", () => {
  const ficheros = [
    "src/lib/analytics.ts", "src/lib/export.ts", "src/lib/manifest.ts",
    "src/app/(app)/accounts/page.tsx", "src/app/(app)/summary/page.tsx",
    "src/app/(app)/dashboard/page.tsx", "src/app/(app)/routes/page.tsx",
  ];

  it("ni acumulando a mano `delivery_fee` o `route_miles`", () => {
    for (const f of ficheros) {
      const src = leer(f);
      expect(src, f).not.toMatch(/\+=\s*Number\(d\.(delivery_fee|route_miles)/);
      expect(src, f).not.toMatch(/reduce\([^)]*\+\s*\(?[a-z]\.(delivery_fee|route_miles)/);
    }
  });

  it("ni escribiendo la regla de redondeo a mano en esos ficheros", () => {
    // Es el motivo del cambio: la regla estaba copiada en 27 sitios y en tres grafías. Aquí se
    // exige que en los ficheros tocados no quede ninguna copia sobre dinero ni millas.
    for (const f of ["src/lib/analytics.ts", "src/lib/manifest.ts", "src/app/(app)/accounts/page.tsx", "src/app/(app)/summary/page.tsx"]) {
      const src = leer(f);
      expect(src, f).not.toMatch(/Math\.round\([^)]*\* *100\) *\/ *100/);
      expect(src, f).not.toMatch(/Math\.round\([^)]*\* *10\) *\/ *10/);
    }
  });

  it("y la unidad de cada magnitud se dice en UN sitio", () => {
    const src = leer("src/lib/totales.ts");
    expect(src).toContain("Math.round(n * 100) / 100");   // dinero
    expect(src).toContain("Math.round(n * 10) / 10");     // millas
  });

  it("se acumula en ENTEROS, y eso hay que fijarlo leyendo, no midiendo", () => {
    // Aquí el valor no puede decidir: con estas magnitudes, acumular en coma flotante y redondear
    // una vez da exactamente lo mismo — el error de la coma flotante necesitaría del orden de 1e15
    // sumas para mover un centavo. Medido con ese mutante: sobrevivió a la tanda entera.
    //
    // Se acumula en enteros igualmente porque así no hay nada que explicar, y lo que se fija es
    // **de dónde sale el sumando**: la línea entera, no el fragmento. `Math.round(n * 100)` sin más
    // lo contiene también `Math.round(n * 100) / 100`, así que un `toContain` corto no vale.
    const src = leer("src/lib/totales.ts");
    expect(src).toContain("return Number.isFinite(n) ? Math.round(n * 100) : 0;");
  });
});
