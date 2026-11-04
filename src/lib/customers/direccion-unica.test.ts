import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FichaEnVentana } from "@/app/customers/FichaDeCliente";
import { almacenDemo, CLIENTES_DEMO } from "./demo";
import { contactoVacio, enEdicion, parcheDeContactos } from "./contactos";
import { conDireccionDeLaCuenta, direccionDeLaCuentaAlGuardar, direccionesAparte, lineasDeDireccion, mismaDireccion } from "./direccion-unica";
import type { Contacto } from "./formato";
import type { Cliente } from "./reglas";

/**
 * Solicitud de ayuda 3914768b (Roberto Rodriguez Jr, admin, 2026-11-04, captura de «New customer» con la segunda casilla
 * «Address» marcada): «address box should not repeat». La dirección del primer contacto es también la de la cuenta.
 */
const uno = (c: Partial<Contacto>): Contacto => ({ name: null, title: null, phones: [], emails: [], note: null, ...c });

describe("direccion-unica: las reglas", () => {
  it("lineasDeDireccion y mismaDireccion: espacios, líneas vacías y mayúsculas no hacen otra dirección", () => {
    expect(lineasDeDireccion("  12  Main St \r\n\r\n Laredo,  TX ")).toBe("12 Main St\nLaredo, TX");
    expect(mismaDireccion("123 TEST DR RGV", " 123 test  dr rgv ")).toBe(true);
    expect(mismaDireccion("", null)).toBe(true);
    expect(mismaDireccion("1 Main", "2 Main")).toBe(false);
  });
  it("direccionesAparte: solo con dos direcciones escritas y distintas", () => {
    expect(direccionesAparte("1 Main", [uno({ address: "2 Elm" })])).toBe(true);
    expect(direccionesAparte("1 Main", [uno({ address: "1  MAIN" })])).toBe(false);
    expect(direccionesAparte("1 Main", [uno({ name: "ANA" })])).toBe(false);
    expect(direccionesAparte(null, [uno({ address: "2 Elm" })])).toBe(false);
    expect(direccionesAparte("1 Main", [])).toBe(false);
  });
  it("conDireccionDeLaCuenta: el primer contacto sin dirección abre con la de la cuenta; el resto no se toca", () => {
    const dos = [uno({ name: "ANA" }), uno({ name: "LEO", address: "5 Elm" })];
    expect(conDireccionDeLaCuenta(dos, " 1 Main \n Laredo ")).toEqual([uno({ name: "ANA", address: "1 Main\nLaredo" }), dos[1]]);
    expect(conDireccionDeLaCuenta([uno({ name: "ANA", address: "9 Oak" })], "1 Main")).toEqual([uno({ name: "ANA", address: "9 Oak" })]);
    expect(conDireccionDeLaCuenta(dos, "  ")).toEqual(dos);
    expect(conDireccionDeLaCuenta([], "1 Main")).toEqual([uno({ address: "1 Main" })]);
  });
  it("abrir y cerrar sin tocar nada no es un cambio (ni de contactos ni de la dirección de la cuenta)", () => {
    const antes = conDireccionDeLaCuenta([uno({ name: "ANA" })], "1 Main");
    const editados = enEdicion(antes);
    expect(parcheDeContactos(antes, editados, null)).toEqual({});
    expect(direccionDeLaCuentaAlGuardar("1 Main", antes, editados)).toBe("1 Main");
  });
  it("la dirección de la cuenta sigue a la del primer contacto cuando esa casilla cambia", () => {
    const antes = conDireccionDeLaCuenta([uno({ name: "ANA" })], "1 Main");
    const editados = enEdicion(antes);
    editados[0] = { ...editados[0], address: " 7  Pine Rd " };
    expect(direccionDeLaCuentaAlGuardar("1 Main", antes, editados)).toBe("7 Pine Rd");
    editados[0] = { ...editados[0], address: "" };
    expect(direccionDeLaCuentaAlGuardar("1 Main", antes, editados)).toBe("");
    // Un alta: sin nada antes, lo escrito en el primer contacto es la dirección de la cuenta.
    expect(direccionDeLaCuentaAlGuardar("", [], [{ ...contactoVacio(), address: "123 TEST DR RGV" }])).toBe("123 TEST DR RGV");
  });
});

const t = (_en: string, es: string) => es;
const pinta = (cliente: Cliente | null, editar = true) =>
  renderToStaticMarkup(createElement(FichaEnVentana, {
    cliente, hermanas: cliente ? [cliente] : [], lista: CLIENTES_DEMO,
    onCambia: () => {}, onClose: () => {}, onGuardado: () => {},
    puedeEditar: true, almacen: almacenDemo(), editarAlAbrir: editar, t,
  }));
const tarjeta = (html: string, g: string) => {
  const i = html.indexOf(`data-grupo="${g}"`);
  expect(i, g).toBeGreaterThan(-1);
  const j = html.indexOf("data-grupo=", i + 1);
  return html.slice(i, j < 0 ? undefined : j);
};
const casillasDeDireccion = (html: string) => (html.match(/<textarea[^>]*data-direccion-de-contacto=/g) ?? []).length
  + (html.match(/data-campo="address"[^>]*>\s*<span[^>]*>Dirección<\/span>\s*<textarea/g) ?? []).length;

describe("direccion-unica: la ficha", () => {
  const base = CLIENTES_DEMO[0];
  it("el alta tiene UNA casilla de dirección (la del contacto), con la nota de que es la de la cuenta", () => {
    const html = tarjeta(pinta(null), "contacto");
    expect(html).not.toContain('data-campo="address"');
    expect(casillasDeDireccion(html)).toBe(1);
    expect(html).toContain("data-direccion-es-la-de-la-cuenta");
  });
  it("editar una ficha con dirección de cuenta y contacto sin ella: una casilla, que abre con la de la cuenta", () => {
    const c: Cliente = { ...base, address: "4301 W Business 83", contacts: [{ name: "ANA", title: null, phones: [], emails: [], note: null }] };
    const html = tarjeta(pinta(c), "contacto");
    expect(html).not.toContain('data-campo="address"');
    expect(html).toMatch(/<textarea[^>]*data-direccion-de-contacto="0"[^>]*>4301 W Business 83</);
  });
  it("una fila con dos direcciones distintas sigue enseñando las dos (no se esconde ni se pisa ninguna)", () => {
    const c: Cliente = { ...base, address: "1 Main", contacts: [{ name: "ANA", title: null, phones: [], emails: [], note: null, address: "2 Elm" }] };
    const html = tarjeta(pinta(c), "contacto");
    expect(html).toContain('data-campo="address"');
    expect(html).not.toContain("data-direccion-es-la-de-la-cuenta");
  });
  it("al ver, la dirección del contacto igual a la de la cuenta no sale dos veces", () => {
    const igual: Cliente = { ...base, address: "1 Main", contacts: [{ name: "ANA", title: null, phones: [], emails: [], note: null, address: "1 MAIN" }] };
    expect(tarjeta(pinta(igual, false), "contacto")).not.toContain("data-direccion-de-contacto");
    const otra: Cliente = { ...igual, contacts: [{ name: "ANA", title: null, phones: [], emails: [], note: null, address: "2 Elm" }] };
    expect(tarjeta(pinta(otra, false), "contacto")).toContain("data-direccion-de-contacto");
  });
  it("la ventana guarda la dirección de la cuenta desde la del primer contacto", () => {
    const ficha = readFileSync(join(process.cwd(), "src/app/customers/FichaDeCliente.tsx"), "utf8");
    expect(ficha).toContain("direccionDeLaCuentaAlGuardar(form.address ?? \"\", contactosOriginales, contactos)");
    expect(ficha).toContain("direccionUnica={!direccionAparte}");
  });
});
