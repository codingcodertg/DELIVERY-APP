import { describe, expect, it } from "vitest";
import { clienteDeLaCuenta, contactoDeLaCuenta, opcionesDeCuenta, type ClienteParaOrden } from "./clientes-para-ordenes";
import { sugerenciasPara } from "./account-combobox";

const cli = (account: string, o: Partial<ClienteParaOrden> = {}): ClienteParaOrden =>
  ({ account, store: "MCA", contact: null, phone: null, address: null, ...o });

describe("opcionesDeCuenta", () => {
  it("Clientes primero; guardadas y pasadas que faltan quedan marcadas fuera o internas", () => {
    const r = opcionesDeCuenta({
      clientes: [cli("Zeta Homes"), cli("ACME Build")],
      guardadas: [{ name: "acme build" }, { name: "Tienda PHR", intertienda: true }, { name: "Solo Ajustes" }],
      pasadas: ["Vieja Orden", "zeta homes", "Otra Tienda", null, "  "],
      intertiendaPasadas: new Set(["otra tienda"]),
    });
    expect(r).toEqual([
      { nombre: "ACME Build", origen: "clientes" },
      { nombre: "Otra Tienda", origen: "interna" },
      { nombre: "Solo Ajustes", origen: "fuera" },
      { nombre: "Tienda PHR", origen: "interna" },
      { nombre: "Vieja Orden", origen: "fuera" },
      { nombre: "Zeta Homes", origen: "clientes" },
    ]);
  });
  it("sin Clientes (203 sin aplicar) da lo de antes", () => {
    const r = opcionesDeCuenta({ clientes: [], guardadas: [{ name: "B" }], pasadas: ["A"] });
    expect(r.map((o) => o.nombre)).toEqual(["A", "B"]);
  });
  it("las sugerencias siguen pidiendo dos letras (D-337)", () => {
    const nombres = opcionesDeCuenta({ clientes: [cli("ACME Build")], guardadas: [], pasadas: [] }).map((o) => o.nombre);
    expect(sugerenciasPara(nombres, "a")).toEqual([]);
    expect(sugerenciasPara(nombres, "ac")).toEqual(["ACME Build"]);
  });
});

describe("clienteDeLaCuenta / contactoDeLaCuenta", () => {
  const lista = [cli("ACME", { store: "EDG" }), cli("acme", { store: "MCA", contact: "Ana", phone: "(956) 555-0101", address: "1 Main" })];
  it("elige la tienda que trae contacto, sin importar mayúsculas", () => {
    expect(clienteDeLaCuenta(lista, " Acme ")?.store).toBe("MCA");
    expect(clienteDeLaCuenta(lista, "Nadie")).toBeUndefined();
    expect(clienteDeLaCuenta([cli("X", { store: "B" }), cli("X", { store: "A" })], "x")?.store).toBe("B");
  });
  it("Clientes manda; lo que falte lo pone la guardada", () => {
    expect(contactoDeLaCuenta(clienteDeLaCuenta(lista, "acme"), { contact: "Viejo", phone: "1", address: "2" }))
      .toEqual({ contact: "Ana", phone: "(956) 555-0101", address: "1 Main" });
    expect(contactoDeLaCuenta(cli("Y", { contact: "Luz" }), { contact: "Viejo", phone: "9", address: "" }))
      .toEqual({ contact: "Luz", phone: "9", address: null });
    expect(contactoDeLaCuenta(undefined, undefined)).toBeUndefined();
  });
});
