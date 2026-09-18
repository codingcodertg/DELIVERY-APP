import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { conflictosDeSitio, orderTypeRule } from "./required";
import {
  eligeDestino, eligeRecogidaDeTienda, opcionesDeDestino, opcionesDeRecogida, origenDeLaOrden, origenEsDestino,
} from "./order-endpoints";
import { aplicaTipo, borradorInicial, escrituraQueNoVaANingunSitio, type ContextoDelUsuario } from "./order-sites";
import type { Delivery, NamedLocation, OrderTypeRule } from "./types";

/**
 * Intertienda: la tienda del usuario vende y recibe, y lo que se elige es quién manda (D-NEXT).
 *
 * El dueño, con captura: «el store sold from debería quedar freeze, y solo en ese caso quitar el store
 * address, no se necesita; el store destination es el mismo store sold from, y el pickup es el dropdown
 * que se elige qué tienda es». Y después: «como es intertienda, la dirección de entrega debe ser una de
 * las tiendas… like a dropdown menu».
 *
 * Lo que rompía: `aplicaTipo` vaciaba «Vendido desde» para que se eligiera **ahí** el origen, así que
 * una Intertienda acababa con el destino en la tienda de al lado y saltaba «pickup and delivery address
 * are the same». Y si se pusieran las dos puntas en la misma tienda —que es lo que el dueño quiere—, la
 * regla de D-276 la habría declarado una orden que no va a ningún sitio.
 *
 * **Transfer no cambia**: es el otro tipo tienda-a-tienda y su origen sigue siendo «Vendido desde». Cada
 * prueba de aquí abajo que toca la regla lo comprueba en los dos tipos.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const modal = leer("src/components/OrderModal.tsx");

const REGLAS: Record<string, OrderTypeRule> = {
  Intertienda: { docRef: "po", storeToStore: true, homeIsDestination: true },
  Transfer: { docRef: "estimate", storeToStore: true },
  Customer: { docRef: "invoice", storeToStore: false },
};
const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave, Ciudad TX" },
  { name: "Tienda Sur", address: "200 Sur Blvd, Ciudad TX" },
  { name: "Tienda Este", address: "300 Este Rd, Ciudad TX" },
];
const [NORTE, SUR, ESTE] = TIENDAS;
const quien = (rol: string, miTienda: string | null): ContextoDelUsuario =>
  ({ rol, miTienda, tipos: ["Customer", "Intertienda", "Transfer"], tiendas: TIENDAS, reglas: REGLAS });
const GERENTE = quien("manager", NORTE.name);
const ADMIN_SIN_TIENDA = quien("admin", null);
const choques = (d: Partial<Delivery>) => conflictosDeSitio(d, REGLAS, TIENDAS).map((m) => m.key).sort();

describe("el origen de una orden no siempre es «Vendido desde»", () => {
  const d: Partial<Delivery> = {
    store: NORTE.name, pickup_name: SUR.name, pickup_address: SUR.address,
    delivery_name: NORTE.name, delivery_address: NORTE.address,
  };

  it("en un tipo que recibe es la recogida; en los demás, la tienda que vende", () => {
    expect(origenDeLaOrden(d, REGLAS.Intertienda, TIENDAS)).toEqual({ nombre: SUR.name, direccion: SUR.address });
    expect(origenDeLaOrden(d, REGLAS.Transfer, TIENDAS)).toEqual({ nombre: NORTE.name, direccion: NORTE.address });
    expect(origenDeLaOrden(d, REGLAS.Customer, TIENDAS)).toEqual({ nombre: NORTE.name, direccion: NORTE.address });
  });

  it("y por eso esta orden es legal en Intertienda e ilegal en Transfer", () => {
    // La misma fila de la base, leída con dos reglas: vende Norte, recibe Norte, la manda Sur.
    expect(origenEsDestino(d, REGLAS.Intertienda, TIENDAS)).toBe(false);
    expect(origenEsDestino(d, REGLAS.Transfer, TIENDAS)).toBe(true);
  });

  it("una recogida sin nombre pero con la dirección del destino también choca", () => {
    const sinNombre = { ...d, pickup_name: "", pickup_address: NORTE.address };
    expect(origenEsDestino(sinNombre, REGLAS.Intertienda, TIENDAS)).toBe(true);
  });

  it("sin recogida ninguna no hay nada que comparar", () => {
    const vacia = { ...d, pickup_name: "", pickup_address: "" };
    expect(origenEsDestino(vacia, REGLAS.Intertienda, TIENDAS)).toBe(false);
  });

  it("el choque señala el campo que se puede corregir: la recogida, no la tienda congelada", () => {
    const mala: Partial<Delivery> = {
      order_type: "Intertienda", store: NORTE.name, pickup_name: NORTE.name, pickup_address: NORTE.address,
      delivery_name: NORTE.name, delivery_address: NORTE.address,
    };
    expect(choques(mala)).toEqual(["delivery_address", "pickup_name"]);
    expect(choques({ ...mala, order_type: "Transfer" })).toEqual(["delivery_address", "store"]);
  });
});

describe("lo que abre una Intertienda nueva", () => {
  it("la tienda del gerente vende y recibe, y la recogida está por elegir", () => {
    const d = borradorInicial({}, GERENTE);
    expect(d.order_type).toBe("Intertienda");
    expect([d.store, d.delivery_name]).toEqual([NORTE.name, NORTE.name]);
    expect(d.delivery_address).toBe(NORTE.address);
    expect(d.pickup_name || "").toBe("");
    expect(choques(d)).toEqual([]);
  });

  it("quien no tiene tienda se queda como antes: nada congelado", () => {
    // Acordado con el dueño: un admin, u office sin tienda, elige las dos puntas.
    const d = aplicaTipo({}, "Intertienda", ADMIN_SIN_TIENDA);
    expect(d.store || "").toBe("");
    expect(d.delivery_name || "").toBe("");
  });

  it("si la recogida traía puesta la tienda que recibe, se vacía", () => {
    const traida = { store: NORTE.name, pickup_name: NORTE.name, pickup_address: NORTE.address };
    const d = aplicaTipo(traida, "Intertienda", GERENTE);
    expect(d.pickup_name || "").toBe("");
    expect(d.store).toBe(NORTE.name);
  });
});

describe("los dos desplegables de una Intertienda", () => {
  const abierta = borradorInicial({}, GERENTE);

  it("la recogida ofrece las demás tiendas, nunca la que recibe", () => {
    expect(opcionesDeRecogida(abierta, TIENDAS, REGLAS.Intertienda)).toEqual([SUR.name, ESTE.name]);
  });

  it("y conserva la que tenga puesta, aunque sea la que recibe (D-267)", () => {
    const rara = { ...abierta, pickup_name: NORTE.name, pickup_address: NORTE.address };
    expect(opcionesDeRecogida(rara, TIENDAS, REGLAS.Intertienda)).toContain(NORTE.name);
  });

  it("el destino ofrece la tienda que vende —es la que recibe— y no la que manda", () => {
    const conRecogida = eligeRecogidaDeTienda(abierta, SUR.name, TIENDAS);
    expect(opcionesDeDestino(conRecogida, TIENDAS, REGLAS.Intertienda)).toEqual([NORTE.name, ESTE.name]);
  });

  it("elegir la recogida no toca «Vendido desde»", () => {
    const tras = eligeRecogidaDeTienda(abierta, SUR.name, TIENDAS);
    expect(tras.store).toBe(NORTE.name);
    expect([tras.pickup_name, tras.pickup_address]).toEqual([SUR.name, SUR.address]);
  });

  it("y cambiar la tienda que recibe sigue siendo posible, con su dirección detrás", () => {
    // Consecuencia del desplegable de entrega que pidió el dueño: la que recibe puede no ser la suya.
    const tras = eligeDestino(eligeRecogidaDeTienda(abierta, SUR.name, TIENDAS), ESTE.name, TIENDAS);
    expect([tras.delivery_name, tras.delivery_address]).toEqual([ESTE.name, ESTE.address]);
    expect(choques({ ...tras, order_type: "Intertienda" })).toEqual([]);
  });
});

describe("ninguna Intertienda que no va a ningún sitio entra en la base", () => {
  const guarda = (antes: Delivery | undefined, cambio: Partial<Delivery>) =>
    escrituraQueNoVaANingunSitio(antes, cambio, REGLAS, TIENDAS).map((m) => m.key).sort();
  const mala = {
    id: "x", order_type: "Intertienda", store: NORTE.name, pickup_name: NORTE.name, pickup_address: NORTE.address,
    delivery_name: NORTE.name, delivery_address: NORTE.address,
  } as Delivery;

  it("ni creándola enviada ni aprobándola", () => {
    expect(guarda(undefined, { ...mala, stage: "pending" })).toEqual(["delivery_address", "pickup_name"]);
    expect(guarda({ ...mala, stage: "pending" }, { stage: "approved" })).toEqual(["delivery_address", "pickup_name"]);
  });

  it("y la buena pasa", () => {
    const buena = { ...mala, pickup_name: SUR.name, pickup_address: SUR.address };
    expect(guarda(undefined, { ...buena, stage: "pending" })).toEqual([]);
  });
});

describe("una Intertienda vieja se abre y se guarda tal como está", () => {
  it("con una dirección de entrega que no es de ninguna tienda, el destino la conserva", () => {
    // Criterio de D-267: el desplegable no puede esconder lo que la orden ya tiene.
    const vieja: Partial<Delivery> = {
      order_type: "Intertienda", store: NORTE.name, pickup_name: SUR.name, pickup_address: SUR.address,
      delivery_name: "Bodega vieja", delivery_address: "9 Bodega Ln, Ciudad TX",
    };
    expect(choques(vieja)).toEqual([]);
    // El desplegable de destino ofrece tiendas; la suya no está, y eso no la borra ni la bloquea.
    expect(opcionesDeDestino(vieja, TIENDAS, REGLAS.Intertienda)).toEqual([NORTE.name, ESTE.name]);
    expect(vieja.delivery_address).toBe("9 Bodega Ln, Ciudad TX");
  });
});

describe("el formulario", () => {
  it("«Vendido desde» queda congelado en un tipo que recibe, y solo si el usuario tiene tienda", () => {
    expect(modal).toContain("const tiendaCongelada = homeIsDestination && !!me.store;");
    expect(modal).toContain("disabled={!salesFields || origenFijo || tiendaCongelada}");
  });

  it("la fila de «Dirección de tienda» desaparece solo en ese tipo", () => {
    expect(modal).toContain("{!homeIsDestination && (");
    const tramo = modal.slice(modal.indexOf("{!homeIsDestination && ("), modal.indexOf("{/* ---- Pickup ---- */}"));
    expect(tramo).toContain('{t("Store address", "Dirección de tienda")}');
  });

  it("la recogida es un desplegable de tiendas, y su dirección no se teclea", () => {
    expect(modal).toContain("opts={opcionesDeRecogida(d, settings.stores, reglaDelTipo)}");
    expect(modal).toContain("on={(v) => setD((p) => eligeRecogidaDeTienda(p, v, settings.stores))}");
    const tramo = modal.slice(modal.indexOf("{homeIsDestination ? ("), modal.indexOf("{/* ---- Delivery ---- */}"));
    expect(tramo).toContain('<input value={d.pickup_address ?? ""} disabled');
  });

  it("la dirección de entrega sale de la tienda elegida y no se escribe", () => {
    expect(modal).toContain('on={(v) => set("delivery_address", v)} disabled={!salesFields || homeIsDestination}');
  });

  it("y el primer paso ya no enseña su buscador de direcciones en un tipo tienda-a-tienda", () => {
    // Era la causa de lo que vio el dueño: el paso se saltaba solo si alguien CAMBIABA el tipo ahí,
    // y una Intertienda que nace de ese tipo —gerente y office— no pasaba por ese cambio.
    expect(modal).toContain("{editing && isNew && !showFullForm && !storeToStore && (");
  });
});
