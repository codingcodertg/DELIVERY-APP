import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mensajeDePeticion, paginaDeLaPeticion, puedePedirVendedor, SIN_ASIGNAR } from "./pedir-vendedor";
import { celda, puedeAsignarVendedores, textoDeCampo, CAMPOS, type Cliente } from "./reglas";
import { clienteDeBusqueda } from "./vendedor-por-tienda";

/** El gerente pide el vendedor al admin; «Sin asignar» cuando no hay; sin pastillas de tiendas para quien ve solo la suya (D-NEXT). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const t = (en: string, es: string) => es;
const tEn = (en: string) => en;

describe("quién asigna y quién pide", () => {
  it("asigna solo el admin (antes también el gerente, D-728); pide el gerente", () => {
    expect(puedeAsignarVendedores("admin")).toBe(true);
    expect(puedeAsignarVendedores("manager")).toBe(false);
    expect(puedeAsignarVendedores("sales")).toBe(false);
    expect(puedePedirVendedor("manager")).toBe(true);
    expect(puedePedirVendedor("admin")).toBe(false);
    expect(puedePedirVendedor("sales")).toBe(false);
  });
});

describe("la solicitud", () => {
  const cliente = { id: 42, account: "Acme Tile", store: "PHR" };
  it("lleva una primera línea reconocible, el cliente, el vendedor de hoy, el pedido y la nota si la hay", () => {
    const m = mensajeDePeticion({ cliente, vendedor: { id: "v1", full_name: "Ana López" }, actual: null, nota: " urge " }, "es");
    expect(m.split("\n")).toEqual([
      "Solicitud de asignación de vendedor (Clientes)",
      "Cliente: Acme Tile (PHR, #42)",
      "Vendedor hoy: Sin asignar",
      "Vendedor pedido: Ana López",
      "Nota: urge",
    ]);
    const en = mensajeDePeticion({ cliente, vendedor: null, actual: "Juan", nota: "" }, "en");
    expect(en).toBe("Sales rep assignment request (Customers)\nCustomer: Acme Tile (PHR, #42)\nRep today: Juan\nRequested rep: no rep (free)");
  });
  it("la página de la solicitud abre la ficha de ese cliente ya editando (D-648)", () => {
    expect(paginaDeLaPeticion(42)).toBe("/customers?editar=42");
  });
});

describe("«Sin asignar»", () => {
  const sin: Cliente = clienteDeBusqueda({ id: 1, store: "PHR", account: "A" });
  const con: Cliente = { ...sin, rep_id: "v1", rep_name: "Ana López" };
  const campo = CAMPOS.find((c) => c.key === "rep_id")!;
  it("en la celda de la lista y en la ficha, cuando no hay vendedor; con vendedor, su nombre", () => {
    expect(SIN_ASIGNAR).toEqual({ en: "Unassigned", es: "Sin asignar" });
    expect(celda(sin, "rep_id", t)).toBe("Sin asignar");
    expect(celda(sin, "rep_id", tEn)).toBe("Unassigned");
    expect(celda(con, "rep_id", t)).toBe("Ana López");
    expect(textoDeCampo(sin, campo, t)).toBe("Sin asignar");
    expect(textoDeCampo(con, campo, t)).toBe("Ana López");
  });
  it("control: otra columna vacía sigue en «—»", () => {
    expect(celda(sin, "phone", t)).toBe("—");
  });
});

describe("las pantallas", () => {
  const lista = sinComentarios(leer("src/app/customers/Clientes.tsx"));
  const ficha = sinComentarios(leer("src/app/customers/FichaDeCliente.tsx"));
  const pagina = sinComentarios(leer("src/app/customers/page.tsx"));
  it("la página dice quién pide y quién ve solo su tienda; la lista lo pasa a la ficha", () => {
    expect(pagina).toContain("puedePedirVendedor={puedePedirVendedor(role)}");
    expect(lista).toContain("puedePedirVendedor={puedePedirVendedor}");
  });
  it("sin pastillas de tiendas para quien ve solo la suya (vendedor y gerente)", () => {
    expect(lista).toContain("const soloSuTienda = esVendedor || puedePedirVendedor;");
    expect(lista).toContain("{!soloSuTienda && (");
    expect(lista).toContain("data-pastillas-de-tiendas");
  });
  it("en la ficha, el gerente ve «Vendedor» bloqueado y un botón «Pedir al admin» que abre la ventana", () => {
    expect(ficha).toContain("bloqueado={esVendedor || puedePedirVendedor}");
    expect(ficha).toContain("data-pedir-vendedor-al-admin");
    expect(ficha).toContain("onClick={onPedirVendedor} data-pedir-vendedor-al-admin");
    expect(lista).toContain("{pidiendo && <PedirVendedor cliente={pidiendo} vendedores={vendedores} onClose={() => setPidiendo(null)} t={t} />}");
    expect(lista).toContain("onPedirVendedor={ficha.tipo === \"ver\" ? () => setPidiendo(ficha.cliente) : undefined}");
    expect(ficha).toContain('<option value="">{t("Unassigned", "Sin asignar")}</option>');
  });
  it("la ventana manda una solicitud de ayuda, sin ficheros, con la página de la ficha", () => {
    const v = sinComentarios(leer("src/app/customers/PedirVendedor.tsx"));
    expect(v).toContain("enviaSolicitudDeAyuda({");
    expect(v).toContain("ficheros: [],");
    expect(v).toContain("page: paginaDeLaPeticion(cliente.id),");
    expect(v).toContain("appVersion: APP_VERSIONS.customers,");
  });
});
