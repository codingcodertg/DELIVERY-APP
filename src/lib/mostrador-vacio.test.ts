import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contactoAlElegirCuenta } from "./cuenta-elegida";
import { CUENTA_DE_MOSTRADOR, CUENTA_DE_MOSTRADOR_EN } from "./customer-type";
import { missingKeys } from "./required";

/**
 * D-NEXT: «Venta al mostrador» deja SIEMPRE vacíos contacto, teléfono, Nombre de destino y dirección —con su pin y su
 * ruta—, y el campo de cuenta solo sugiere al escribir. Datos inventados.
 */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const formulario = leer("src/components/OrderModal.tsx");

const ORDEN_CON_CLIENTE = {
  contact: "Persona Anterior", delivery_phone: "9560000009",
  delivery_name: "Obra Anterior", delivery_address: "1 Calle Inventada, Pharr TX",
};
const TODO_VACIO = {
  contact: "", delivery_phone: "", delivery_name: "", delivery_address: "",
  delivery_lat: null, delivery_lng: null, delivery_pin_source: null,
  route_miles: null, route_duration: null, route_provider: null, route_traffic: null,
};

describe("D-NEXT · al elegir mostrador, los cuatro campos del cliente quedan vacíos, siempre", () => {
  it("una orden que tenía cliente: contacto, teléfono, destino y dirección vacíos, y el pin y la ruta también", () => {
    for (const cuenta of [CUENTA_DE_MOSTRADOR, ` ${CUENTA_DE_MOSTRADOR_EN.toUpperCase()} `]) {
      expect(contactoAlElegirCuenta({ cuenta, guardada: { contact: "A", phone: "1" }, ultimaOrden: undefined, actual: ORDEN_CON_CLIENTE }))
        .toEqual(TODO_VACIO);
    }
  });
  it("aunque no hubiera nada que quitar, el resultado es el mismo: no depende de lo que había", () => {
    expect(contactoAlElegirCuenta({ cuenta: CUENTA_DE_MOSTRADOR, guardada: undefined, ultimaOrden: undefined, actual: {} })).toEqual(TODO_VACIO);
  });
  it("cualquier otra cuenta NO toca destino, dirección, pin ni ruta", () => {
    const otra = contactoAlElegirCuenta({ cuenta: "Constructora Uno", guardada: { contact: "A", phone: "1" }, ultimaOrden: undefined, actual: ORDEN_CON_CLIENTE });
    expect(Object.keys(otra).sort()).toEqual(["contact", "delivery_phone"]);
  });
  it("vacíos de partida, no opcionales: para enviar siguen faltando contacto, teléfono y dirección (el nombre del destino nunca fue obligatorio)", () => {
    const faltan = missingKeys({ order_type: "Customer", account: CUENTA_DE_MOSTRADOR, ...TODO_VACIO });
    expect([faltan.has("contact"), faltan.has("delivery_phone"), faltan.has("delivery_address"), faltan.has("delivery_name")])
      .toEqual([true, true, true, false]);
  });
});

describe("D-NEXT · la pantalla usa la regla", () => {
  it("el autorrelleno de la cuenta pasa por contactoAlElegirCuenta", () => {
    expect(formulario).toContain("...contactoAlElegirCuenta({ cuenta: v, guardada: rec, ultimaOrden: past, actual: p }),");
  });
  it("mostrador no trae el tipo de orden de «la última orden de mostrador»", () => {
    expect(formulario).toContain("const wantType = !v.trim() || esCuentaDeMostrador(v) ? null");
  });
  it("el campo de cuenta no deja que el navegador pinte su propia lista", () => {
    const a = formulario.indexOf("function AccountCombo(");
    expect(a).toBeGreaterThanOrEqual(0);
    const c = formulario.slice(a, formulario.indexOf("\n}\n", a));
    expect(c).toContain('autoComplete="off"');
  });
});
