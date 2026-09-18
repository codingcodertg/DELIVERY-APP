import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { conflictosDeSitio, orderTypeRule } from "./required";
import { eligeDestino, eligeOrigen, opcionesDeDestino, opcionesDeOrigen, origenDeLaOrden, origenEsDestino } from "./order-endpoints";
import { aplicaTipo, borradorInicial, escrituraQueNoVaANingunSitio, type ContextoDelUsuario } from "./order-sites";
import type { Delivery, NamedLocation, OrderTypeRule } from "./types";

/**
 * Intertienda: **vende la tienda que manda el material**, y la del usuario solo recibe (D-NEXT).
 *
 * **Este fichero fijaba lo contrario.** Era la suite de D-302, donde la tienda del usuario vendía y
 * recibía y lo que se elegía era la recogida. Damaris, de office: *«INV 170059 dice sold from Edinburg
 * y debe de ser Pharr; app tiene que automáticamente poder sold from de la tienda de la cual estoy
 * solicitando el material y no debe permitir que la tienda se venda a sí mismo»*. Tenía razón: en aquel
 * modelo «Vendido desde» decía la tienda que **pedía** el material.
 *
 * Así que ahora se elige **a qué tienda se le pide**, y esa elección escribe «Vendido desde» y la
 * recogida a la vez; el destino queda congelado en la tienda del usuario. Cada caso de abajo que
 * cambió se reescribe **al revés**, no se afloja: lo que cambió es la decisión, no el código que la
 * vigila.
 *
 * **Transfer no cambia**: es el otro tipo tienda-a-tienda y su origen siempre fue «Vendido desde».
 * Ahora Intertienda se comporta igual en eso, y varias pruebas lo comprueban en los dos.
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

describe("el origen de una orden es siempre «Vendido desde»", () => {
  // La forma NUEVA: vende y manda Sur, recibe Norte.
  const d: Partial<Delivery> = {
    store: SUR.name, pickup_name: SUR.name, pickup_address: SUR.address,
    delivery_name: NORTE.name, delivery_address: NORTE.address,
  };

  it("en todos los tipos, sin caso especial", () => {
    // D-302 leía el origen en la recogida cuando el tipo «recibía». Ya no: una sola lectura para todos.
    for (const regla of ["Intertienda", "Transfer", "Customer"] as const) {
      expect(origenDeLaOrden(d, TIENDAS), regla).toEqual({ nombre: SUR.name, direccion: SUR.address });
    }
  });

  it("y esta orden es legal en los dos tipos tienda-a-tienda", () => {
    expect(origenEsDestino(d, REGLAS.Intertienda, TIENDAS)).toBe(false);
    expect(origenEsDestino(d, REGLAS.Transfer, TIENDAS)).toBe(false);
  });

  it("**la forma de D-302 ahora choca**, que es justo lo que se quería arreglar", () => {
    // Vende Norte, recibe Norte, manda Sur: es lo que decía la #252 y lo que Damaris reportó.
    const comoD302: Partial<Delivery> = {
      store: NORTE.name, pickup_name: SUR.name, pickup_address: SUR.address,
      delivery_name: NORTE.name, delivery_address: NORTE.address,
    };
    expect(origenEsDestino(comoD302, REGLAS.Intertienda, TIENDAS)).toBe(true);
  });

  it("la dirección guardada de la tienda que vende, igual a la de entrega, también choca", () => {
    // Sin nombre de destino, pero entregando en la dirección de la tienda que vende.
    const porDireccion = { ...d, delivery_name: "", delivery_address: SUR.address };
    expect(origenEsDestino(porDireccion, REGLAS.Intertienda, TIENDAS)).toBe(true);
  });

  it("sin tienda que venda no hay nada que comparar", () => {
    const vacia = { ...d, store: "" };
    expect(origenEsDestino(vacia, REGLAS.Intertienda, TIENDAS)).toBe(false);
  });

  it("el choque señala el campo que se puede corregir, y ahora es `store` en los dos tipos", () => {
    // Hasta D-302 en un tipo que recibe se señalaba la recogida, porque «Vendido desde» estaba
    // congelado. Ya no lo está: es lo único que se elige.
    const mala: Partial<Delivery> = {
      order_type: "Intertienda", store: NORTE.name, pickup_name: NORTE.name, pickup_address: NORTE.address,
      delivery_name: NORTE.name, delivery_address: NORTE.address,
    };
    expect(choques(mala)).toEqual(["delivery_address", "store"]);
    expect(choques({ ...mala, order_type: "Transfer" })).toEqual(["delivery_address", "store"]);
  });
});

describe("lo que abre una Intertienda nueva", () => {
  it("la tienda del gerente RECIBE, y la que vende está por elegir", () => {
    const d = borradorInicial({}, GERENTE);
    expect(d.order_type).toBe("Intertienda");
    expect([d.delivery_name, d.delivery_address]).toEqual([NORTE.name, NORTE.address]);
    // Lo que cambió: su tienda ya NO queda como «Vendido desde».
    expect(d.store || "").toBe("");
    expect(d.pickup_name || "").toBe("");
    expect(choques(d)).toEqual([]);
  });

  it("y la cuenta se rellena sola con la tienda que recibe", () => {
    expect(borradorInicial({}, GERENTE).account).toBe(NORTE.name);
  });

  it("quien no tiene tienda se queda como antes: nada congelado", () => {
    // Acordado con el dueño en D-302 y sin cambio: un admin, u office sin tienda, elige las dos puntas.
    const d = aplicaTipo({}, "Intertienda", ADMIN_SIN_TIENDA);
    expect(d.store || "").toBe("");
    expect(d.delivery_name || "").toBe("");
    expect(d.account || "").toBe("");
  });

  it("si «Vendido desde» traía puesta su propia tienda, se vacía: nadie se vende a sí mismo", () => {
    const traida = { store: NORTE.name, pickup_name: NORTE.name, pickup_address: NORTE.address };
    const d = aplicaTipo(traida, "Intertienda", GERENTE);
    expect(d.store || "").toBe("");
    expect(d.delivery_name).toBe(NORTE.name);
  });

  it("y si traía OTRA tienda, también: la elección escribe las dos puntas y no se heredan a medias", () => {
    // Este caso lo tapa todo lo demás. Con su propia tienda puesta, el colapso de D-276 la vaciaría
    // igual; con otra distinta no hay choque, así que si `aplicaTipo` no la limpiara se quedaría
    // «Vendido desde: Sur» con la recogida de antes — dos puntas que nadie eligió juntas, que es la
    // forma de la que salió el error de la #252.
    const traida = { store: SUR.name, pickup_name: "Un patio", pickup_address: "9 Patio Ln" };
    const d = aplicaTipo(traida, "Intertienda", GERENTE);
    expect(d.store || "").toBe("");
    expect(d.pickup_name || "").toBe("");
    expect(d.pickup_address || "").toBe("");
  });

  it("y al pasar a un tipo de cliente la cuenta se suelta, para no dejar dentro el nombre de una tienda", () => {
    const intertienda = aplicaTipo({}, "Intertienda", GERENTE);
    expect(intertienda.account).toBe(NORTE.name);
    expect(aplicaTipo(intertienda, "Customer", GERENTE).account || "").toBe("");
  });
});

describe("el desplegable de una Intertienda, que ahora es uno solo", () => {
  const abierta = borradorInicial({}, GERENTE);

  it("ofrece las demás tiendas, nunca la que recibe", () => {
    expect(opcionesDeOrigen(abierta, TIENDAS, REGLAS.Intertienda)).toEqual([SUR.name, ESTE.name]);
  });

  it("y conserva la que tenga puesta, aunque choque (D-267)", () => {
    const rara = { ...abierta, store: NORTE.name };
    expect(opcionesDeOrigen(rara, TIENDAS, REGLAS.Intertienda)).toContain(NORTE.name);
  });

  it("elegirla escribe «Vendido desde» y la recogida a la vez", () => {
    // Es la pieza que hace que «sold from» diga la tienda que manda: una sola elección, dos campos.
    const tras = eligeOrigen(abierta, SUR.name, TIENDAS);
    expect([tras.store, tras.pickup_name, tras.pickup_address]).toEqual([SUR.name, SUR.name, SUR.address]);
    expect(tras.delivery_name).toBe(NORTE.name);
    expect(choques({ ...tras, order_type: "Intertienda" })).toEqual([]);
  });

  it("el destino ofrece las demás, nunca la que vende", () => {
    const conOrigen = eligeOrigen(abierta, SUR.name, TIENDAS);
    expect(opcionesDeDestino(conOrigen, TIENDAS, REGLAS.Intertienda)).toEqual([NORTE.name, ESTE.name]);
  });

  it("y quien puede cambiar el destino se lleva la cuenta con él", () => {
    const tras = eligeDestino(eligeOrigen(abierta, SUR.name, TIENDAS), ESTE.name, TIENDAS);
    expect([tras.delivery_name, tras.delivery_address]).toEqual([ESTE.name, ESTE.address]);
    expect(tras.account).toBe(ESTE.name);
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
    expect(guarda(undefined, { ...mala, stage: "pending" })).toEqual(["delivery_address", "store"]);
    expect(guarda({ ...mala, stage: "pending" }, { stage: "approved" })).toEqual(["delivery_address", "store"]);
  });

  it("y la buena pasa: vende y manda la otra tienda", () => {
    const buena = { ...mala, store: SUR.name, pickup_name: SUR.name, pickup_address: SUR.address };
    expect(guarda(undefined, { ...buena, stage: "pending" })).toEqual([]);
  });
});

describe("una Intertienda vieja se abre y se guarda tal como está", () => {
  it("con una dirección de entrega que no es de ninguna tienda, el destino la conserva", () => {
    // Criterio de D-267: el desplegable no puede esconder lo que la orden ya tiene.
    const vieja: Partial<Delivery> = {
      order_type: "Intertienda", store: SUR.name, pickup_name: SUR.name, pickup_address: SUR.address,
      delivery_name: "Bodega vieja", delivery_address: "9 Bodega Ln, Ciudad TX",
    };
    expect(choques(vieja)).toEqual([]);
    expect(opcionesDeDestino(vieja, TIENDAS, REGLAS.Intertienda)).toEqual([NORTE.name, ESTE.name]);
    expect(vieja.delivery_address).toBe("9 Bodega Ln, Ciudad TX");
  });

  it("pero una con la forma de D-302 sí se queja, y ese es el aviso que hay que ver", () => {
    // Las cinco que quedaban vivas las corrigió el orquestador en la base ANTES de publicar esto
    // (`store` ← `pickup_name`, con nota en `order_events`). Si apareciera otra, esto es lo que haría:
    // marcar «Vendido desde», que es el campo que ahora se puede corregir.
    const comoD302: Partial<Delivery> = {
      order_type: "Intertienda", store: NORTE.name, pickup_name: SUR.name, pickup_address: SUR.address,
      delivery_name: NORTE.name, delivery_address: NORTE.address,
    };
    expect(choques(comoD302)).toEqual(["store"]);
  });
});

describe("el formulario", () => {
  it("lo congelado ahora es el DESTINO, y solo si el usuario tiene tienda", () => {
    // Al revés que en D-302, donde se congelaba «Vendido desde».
    expect(modal).toContain("const destinoCongelado = homeIsDestination && !!me.store;");
    expect(modal).not.toContain("tiendaCongelada");
    expect(modal).toContain("{destinoCongelado ? (");
  });

  it("«Vendido desde» se puede elegir, y su etiqueta dice lo que se está eligiendo", () => {
    expect(modal).toContain('t("Which store do you ask it from? (Sold From)", "¿A qué tienda se lo pides? (Vendido Desde)")');
    expect(modal).toContain("disabled={!salesFields || origenFijo}");
  });

  it("la fila de «Dirección de tienda» sigue ahí, de solo lectura (D-309)", () => {
    expect(modal).not.toContain("{!homeIsDestination && (");
    const tramo = modal.slice(modal.indexOf("{/* ---- Store (Sold From) + its address ---- */}"), modal.indexOf("{/* ---- Pickup ---- */}"));
    expect(tramo).toContain('{t("Store address", "Dirección de tienda")}');
    expect(tramo).toContain('<input value={settings.stores.find((s) => s.name === d.store)?.address ?? ""} disabled');
  });

  it("la recogida ya no se elige: la enseña, porque la escribe el desplegable de arriba", () => {
    expect(modal).not.toContain("opcionesDeRecogida");
    expect(modal).not.toContain("eligeRecogidaDeTienda");
    const tramo = modal.slice(modal.indexOf("{homeIsDestination ? ("), modal.indexOf("{/* ---- Delivery ---- */}"));
    expect(tramo).toContain('<input value={d.pickup_name ?? ""} disabled');
    expect(tramo).toContain('<input value={d.pickup_address ?? ""} disabled');
  });

  it("la cuenta se enseña y no se teclea en un movimiento entre tiendas", () => {
    expect(modal).toContain('<input value={d.account ?? ""} disabled placeholder={t("the destination store", "la tienda destino")} />');
  });

  it("la dirección de entrega sale de la tienda elegida y no se escribe", () => {
    expect(modal).toContain('on={(v) => set("delivery_address", v)} disabled={!salesFields || homeIsDestination}');
  });

  it("y el primer paso ya no enseña su buscador de direcciones en un tipo tienda-a-tienda", () => {
    expect(modal).toContain("const paso = pasoFormulario(isNew, showFullForm, storeToStore);");
    expect(modal).toContain('{editing && paso === "inicial" && (');
    expect(modal).not.toContain("!showFullForm && !storeToStore");
  });
});
