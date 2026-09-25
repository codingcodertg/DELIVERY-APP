import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAMPOS_DEL_CLIENTE, contactoAlElegirCuenta, esCampoDelCliente, vaciarParaMostrador } from "./cuenta-elegida";
import { CUENTA_DE_MOSTRADOR } from "./customer-type";
import { missingKeys } from "./required";

/**
 * D-NEXT: «Venta al mostrador» vacía contacto, teléfono, destino y dirección — lo precargado, no lo tecleado —, y el campo
 * de cuenta solo sugiere al escribir. Datos inventados.
 */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const formulario = leer("src/components/OrderModal.tsx");

const DE_LA_CUENTA_ANTERIOR = {
  contact: "Persona Anterior", delivery_phone: "9560000009",
  delivery_name: "Obra Anterior", delivery_address: "1 Calle Inventada, Pharr TX",
};

describe("D-NEXT · al pasar a mostrador, lo precargado se va", () => {
  it("una orden que tenía cuenta: los cuatro campos del cliente quedan vacíos, y el punto y la ruta de esa dirección también", () => {
    expect(vaciarParaMostrador(DE_LA_CUENTA_ANTERIOR, {})).toEqual({
      contact: "", delivery_phone: "", delivery_name: "", delivery_address: "",
      delivery_lat: null, delivery_lng: null, delivery_pin_source: null,
      route_miles: null, route_duration: null, route_provider: null, route_traffic: null,
    });
  });
  it("lo tecleado a mano en el formulario se queda; lo demás se va, y el punto sigue con su dirección", () => {
    const r = vaciarParaMostrador(
      { ...DE_LA_CUENTA_ANTERIOR, contact: "Cliente De Paso", delivery_address: "2 Calle Tecleada" },
      { contact: "Cliente De Paso", delivery_address: "2 Calle Tecleada" },
    );
    expect(r).toEqual({ delivery_phone: "", delivery_name: "" });
  });
  it("tecleado y luego pisado por un autorrelleno ya no es de la persona: se va", () => {
    const r = vaciarParaMostrador(DE_LA_CUENTA_ANTERIOR, { contact: "Lo Que Tecleó", delivery_address: "Otra Calle" });
    expect([r.contact, r.delivery_address]).toEqual(["", ""]);
  });
  it("tecleado y luego borrado a mano: vacío también es de la persona, y no hay punto que quitar", () => {
    const r = vaciarParaMostrador({ ...DE_LA_CUENTA_ANTERIOR, delivery_address: "" }, { delivery_address: "" });
    expect("delivery_address" in r).toBe(false);
    expect("delivery_lat" in r).toBe(false);
  });
  it("sin dirección que quitar, el pin no se toca (un pin soltado a mano sin dirección sigue siendo suyo)", () => {
    const r = vaciarParaMostrador({ contact: "X", delivery_address: "  " }, {});
    expect(r.delivery_address).toBe("");
    expect(["delivery_lat", "delivery_lng", "delivery_pin_source", "route_miles"].some((k) => k in r)).toBe(false);
  });
  it("contactoAlElegirCuenta la usa con mostrador —con lo tecleado— y con cualquier otra cuenta NO toca destino ni dirección", () => {
    const tecleado = { delivery_address: DE_LA_CUENTA_ANTERIOR.delivery_address };
    expect(contactoAlElegirCuenta({ cuenta: CUENTA_DE_MOSTRADOR, guardada: undefined, ultimaOrden: undefined, actual: DE_LA_CUENTA_ANTERIOR, tecleado }))
      .toEqual({ contact: "", delivery_phone: "", delivery_name: "" });
    const otra = contactoAlElegirCuenta({ cuenta: "Constructora Uno", guardada: { contact: "A", phone: "1" }, ultimaOrden: undefined, actual: DE_LA_CUENTA_ANTERIOR });
    expect(Object.keys(otra).sort()).toEqual(["contact", "delivery_phone"]);
  });
  it("los campos del cliente son esos cuatro, y la cuenta no es uno de ellos", () => {
    expect([...CAMPOS_DEL_CLIENTE]).toEqual(["contact", "delivery_phone", "delivery_name", "delivery_address"]);
    expect(["contact", "delivery_phone", "delivery_name", "delivery_address", "account", "delivery_notes"].map(esCampoDelCliente))
      .toEqual([true, true, true, true, false, false]);
  });
  it("vacíos de partida, no opcionales: para enviar siguen faltando contacto, teléfono y dirección (el nombre del destino nunca fue obligatorio)", () => {
    const faltan = missingKeys({ order_type: "Customer", account: CUENTA_DE_MOSTRADOR, ...vaciarParaMostrador(DE_LA_CUENTA_ANTERIOR, {}) });
    expect([faltan.has("contact"), faltan.has("delivery_phone"), faltan.has("delivery_address"), faltan.has("delivery_name")])
      .toEqual([true, true, true, false]);
  });
});

describe("D-NEXT · la pantalla usa la regla", () => {
  it("todo `set` de un campo del cliente queda apuntado como tecleado; el autorrelleno de la cuenta va por `setD` y no", () => {
    expect(formulario).toContain("if (esCampoDelCliente(k)) tecleado.current[k] = String(v ?? \"\");");
    expect(formulario).toContain("...contactoAlElegirCuenta({ cuenta: v, guardada: rec, ultimaOrden: past, actual: p, tecleado: tecleado.current }),");
    for (const k of CAMPOS_DEL_CLIENTE) expect(formulario).toMatch(new RegExp("set\\(\"" + k + "\", v\\)"));
  });
  it("ningún campo del cliente se escribe a mano por fuera de `set`: no quedaría apuntado y mostrador lo borraría", () => {
    for (const k of CAMPOS_DEL_CLIENTE) expect(formulario).not.toMatch(new RegExp("\\.\\.\\.p, " + k + ":"));
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
