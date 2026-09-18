import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { eligeDestino } from "./order-endpoints";
import * as sitios from "./order-sites";
import type { NamedLocation } from "./types";

/**
 * D-282 revertida (D-288). El dueño: «lets undo the change we made to intertienda».
 *
 * Este fichero fijaba lo contrario —el contacto era la tienda que envía, y la fila de «Vendido desde»
 * desaparecía en Intertienda—. Ahora fija la vuelta atrás, y sobre todo **que no queden restos**: media
 * reversión es peor que ninguna, porque deja dos sitios decidiendo lo mismo.
 *
 * Lo que NO se revierte tiene su prueba aquí también, en corto: D-267 y D-276 —que una orden no vaya de
 * un sitio a ese mismo sitio, y la guarda de los proveedores— siguen enteras, y sus suites propias
 * (`order-endpoints.test.ts`, `order-sites.test.ts`) no se tocaron.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const modal = leer("src/components/OrderModal.tsx");
const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave, Ciudad TX" },
  { name: "Tienda Sur", address: "200 Sur Blvd, Ciudad TX" },
];

describe("el contacto vuelve a ser lo que era", () => {
  it("elegir la tienda de destino ya NO escribe el contacto (D-NEXT)", () => {
    // D-288 la devolvió a escribirlo —el contacto de una Intertienda era la tienda que recibe— y el
    // 2026-09-18 el dueño quitó cuenta, contacto y teléfono de los movimientos tienda-a-tienda
    // («los tres»). Escribirlo ahora rellenaría un campo que ya no se enseña, y encima lo volvería a
    // poner justo después de que el cambio de tipo lo vaciara.
    const d = eligeDestino({ order_type: "Intertienda", store: "Tienda Norte" }, "Tienda Sur", TIENDAS);
    expect(d.delivery_name).toBe("Tienda Sur");
    expect(d.delivery_address).toBe("200 Sur Blvd, Ciudad TX");
    expect(d.contact ?? "").toBe("");
  });

  it("y el formulario vuelve a tener el contacto como texto libre", () => {
    expect(modal).toContain('<Txt label={t("Contact name", "Nombre de Contacto")} val={d.contact} on={(v) => set("contact", v)}');
  });

  it("la fila de «Vendido desde» y la dirección de tienda vuelven, sin condición", () => {
    // «Sin condición» hay que exigirlo de verdad: esconder la fila tras un `{false && (` dejaba los
    // textos en el fichero y la prueba en verde (lo cazó un mutante). Se exige que el comentario y la
    // fila sean líneas seguidas, sin nada en medio.
    const SALTO = String.fromCharCode(10);
    expect(modal).toContain('{/* ---- Store (Sold From) + its address ---- */}' + SALTO + '            <div className="grid g2">');
    const fila = modal.slice(modal.indexOf('{/* ---- Store (Sold From) + its address ---- */}'), modal.indexOf("{/* ---- Pickup ---- */}"));
    expect(fila).toContain('label={t("Store (Sold From)", "Tienda (Vendido Desde)")}');
    expect(fila).toContain('<label>{t("Store address", "Dirección de tienda")}</label>');
    expect(fila).not.toContain("contactoEsOrigen");
  });
});

describe("no quedan restos de D-282", () => {
  it("las tres funciones que creó ya no existen", () => {
    for (const nombre of ["contactoEsLaTiendaDeOrigen", "conContactoDeOrigen", "escrituraConContactoDeOrigen"]) {
      expect(Object.keys(sitios), nombre).not.toContain(nombre);
    }
    expect(leer("src/lib/order-sites.ts")).not.toContain("ContactoDeOrigen");
  });

  it("ni en el formulario ni en los dos proveedores", () => {
    for (const f of ["src/components/OrderModal.tsx", "src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      expect(leer(f), f).not.toContain("ContactoDeOrigen");
      expect(leer(f), f).not.toContain("contactoEsOrigen");
    }
  });
});

describe("lo que NO se revierte sigue en pie", () => {
  it("la regla de D-267 y D-276 y su guarda de escritura siguen exportadas", () => {
    expect(typeof sitios.escrituraQueNoVaANingunSitio).toBe("function");
    expect(typeof sitios.aplicaTipo).toBe("function");
    expect(typeof sitios.borradorInicial).toBe("function");
  });

  it("los dos proveedores siguen llamando a la guarda antes de escribir", () => {
    for (const f of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      expect(leer(f), f).toContain("escrituraQueNoVaANingunSitio(");
    }
  });

  it("y `aplicaTipo` vacía la punta que choca Y los tres del cliente (D-NEXT)", () => {
    const REGLAS = {
      Intertienda: { docRef: "po" as const, storeToStore: true, homeIsDestination: true },
      Customer: { docRef: "invoice" as const, storeToStore: false },
    };
    const ctx = { rol: "manager", miTienda: "Tienda Norte", tipos: ["Customer", "Intertienda"], tiendas: TIENDAS, reglas: REGLAS };
    const cliente = {
      order_type: "Customer", store: "Tienda Norte", account: "Un cliente", contact: "Quien recibe",
      delivery_phone: "5550001111", delivery_name: "Tienda Norte", delivery_address: TIENDAS[0].address,
    };
    const d = sitios.aplicaTipo(cliente, "Intertienda", ctx);
    // Desde D-302 la punta que el tipo deja elegir es la RECOGIDA: su tienda vende y recibe.
    expect(d.pickup_name || "").toBe("");
    expect(d.store).toBe("Tienda Norte");
    // Y desde D-NEXT se van los tres del cliente: un movimiento entre tiendas no tiene ninguno. Esta
    // prueba exigía justo lo contrario —«el contacto ya no lo toca nadie»— y se reescribe, porque lo
    // que cambió es la decisión, no el código que la vigila.
    expect(d.account ?? "").toBe("");
    expect(d.contact ?? "").toBe("");
    expect(d.delivery_phone ?? "").toBe("");
  });

  it("pero volver a un tipo de cliente no los vacía: solo se limpian al entrar en tienda-a-tienda", () => {
    const REGLAS = {
      Intertienda: { docRef: "po" as const, storeToStore: true, homeIsDestination: true },
      Customer: { docRef: "invoice" as const, storeToStore: false },
    };
    const ctx = { rol: "manager", miTienda: "Tienda Norte", tipos: ["Customer", "Intertienda"], tiendas: TIENDAS, reglas: REGLAS };
    const conCliente = { order_type: "Customer", store: "Tienda Norte", account: "Un cliente", contact: "Quien recibe", delivery_phone: "5550001111" };
    const d = sitios.aplicaTipo(conCliente, "Customer", ctx);
    expect(d.account).toBe("Un cliente");
    expect(d.contact).toBe("Quien recibe");
    expect(d.delivery_phone).toBe("5550001111");
  });
});
