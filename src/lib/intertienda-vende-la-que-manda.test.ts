import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { htmlDelComprobante } from "./slip";
import { tiendasDeLaOrden, tiendaDeLaOrdenEsMia } from "./order-endpoints";
import { aplicaTipo, type ContextoDelUsuario } from "./order-sites";
import type { Delivery, NamedLocation, OrderTypeRule, Settings } from "./types";

/**
 * Lo que arregla que «Vendido desde» diga la tienda que MANDA (D-NEXT).
 *
 * Damaris, de office: *«INV 170059 dice sold from Edinburg y debe de ser Pharr»*. No era solo la
 * pantalla: el comprobante toma la dirección de origen de `store`, así que con el modelo de D-302
 * —donde `store` era la tienda que recibía— **el papel que lleva el chofer decía que el material salía
 * de la tienda que lo estaba recibiendo**. Eso es lo que se fija aquí, además de la visibilidad y la
 * cuenta.
 */

const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave, Ciudad TX" },
  { name: "Tienda Sur", address: "200 Sur Blvd, Ciudad TX" },
];
const [NORTE, SUR] = TIENDAS;
const REGLAS: Record<string, OrderTypeRule> = {
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Customer: { docRef: "invoice", storeToStore: false },
};
const A_TIENDA = { storeToStore: true } as const;

/** Una Intertienda con la forma NUEVA: vende y manda Sur, recibe Norte. */
const ORDEN = {
  id: "o1", order_no: 1, order_code: "AA1", stage: "approved",
  order_type: "Intertienda", store: SUR.name, pickup_name: SUR.name, pickup_address: SUR.address,
  delivery_name: NORTE.name, delivery_address: NORTE.address, account: NORTE.name,
} as unknown as Delivery;

const AJUSTES = { app_name: "RTG", stores: TIENDAS } as unknown as Settings;

describe("el papel dice la tienda que manda", () => {
  const html = htmlDelComprobante(ORDEN, AJUSTES, [], "es");

  it("el comprobante enseña como tienda la que vende y manda, no la que recibe", () => {
    // `slip.ts` pinta `d.store` y saca de ahí la dirección de origen. Con el modelo de D-302 esta
    // misma orden habría dicho «Tienda Norte», que es donde se ENTREGA.
    expect(html).toContain(SUR.name);
    const fila = html.slice(html.indexOf("<th>Tienda</th>"), html.indexOf("<th>Tienda</th>") + 120);
    expect(fila).toContain(SUR.name);
    expect(fila).not.toContain(NORTE.name);
  });

  it("y la dirección de origen del comprobante es la de esa tienda", () => {
    expect(html).toContain(SUR.address);
  });
});

describe("la visibilidad de D-309 sigue valiendo con la forma nueva", () => {
  it("las dos tiendas de la orden son la que manda y la que recibe", () => {
    expect(tiendasDeLaOrden(ORDEN, A_TIENDA)).toEqual([SUR.name, NORTE.name]);
  });

  it("y las ve tanto quien está en la que manda como quien está en la que recibe", () => {
    expect(tiendaDeLaOrdenEsMia(ORDEN, A_TIENDA, SUR.name, TIENDAS)).toBe(true);
    expect(tiendaDeLaOrdenEsMia(ORDEN, A_TIENDA, NORTE.name, TIENDAS)).toBe(true);
  });

  it("la forma vieja de D-302 también, porque se miran las tres columnas", () => {
    // Las cinco que quedaban se corrigieron en la base, pero la función no depende de eso.
    const comoD302 = { store: NORTE.name, pickup_name: SUR.name, delivery_name: NORTE.name };
    expect(tiendasDeLaOrden(comoD302, A_TIENDA)).toEqual([NORTE.name, SUR.name]);
  });
});

describe("la cuenta de una Intertienda", () => {
  const ctx = (miTienda: string | null): ContextoDelUsuario =>
    ({ rol: "manager", miTienda, tipos: ["Customer", "Intertienda"], tiendas: TIENDAS, reglas: REGLAS });

  it("se rellena sola con la tienda que recibe", () => {
    expect(aplicaTipo({}, "Intertienda", ctx(NORTE.name)).account).toBe(NORTE.name);
  });

  it("y quien no tiene tienda la deja vacía hasta que elija el destino", () => {
    expect(aplicaTipo({}, "Intertienda", ctx(null)).account || "").toBe("");
  });

  it("al volver a un tipo de cliente se suelta: una tienda no es un cliente", () => {
    const inter = aplicaTipo({}, "Intertienda", ctx(NORTE.name));
    expect(aplicaTipo(inter, "Customer", ctx(NORTE.name)).account || "").toBe("");
  });

  it("pero una cuenta tecleada a mano en una orden de cliente no se toca", () => {
    const cliente = { order_type: "Customer", account: "Un cliente de verdad" };
    expect(aplicaTipo(cliente, "Customer", ctx(NORTE.name)).account).toBe("Un cliente de verdad");
  });
});

describe("la bandera de Ajustes no cambia", () => {
  it("Intertienda sigue siendo un tipo «que recibe», porque eso sigue siendo verdad", () => {
    // La tienda del usuario **recibe**: lo que cambió es dónde vive el origen, no quién es el destino.
    // Ponerla en false haría lo contrario de lo que pidió Damaris — congelar el origen en su tienda —
    // así que el arreglo es de código y no toca `settings.order_type_rules`.
    for (const r of ["src/lib/data-provider.tsx", "src/lib/demo-data.ts"]) {
      const src = readFileSync(r, "utf8").split("\r\n").join("\n");
      expect(src, r).toContain("Intertienda: { storeToStore: true,  docRef: \"any\", homeIsDestination: true }");
    }
  });
});
