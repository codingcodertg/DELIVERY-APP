import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENTES_DEMO, clienteParaCotizar, codigoDeMiTienda, coincidencias, elegibles, relleno, rotulo, seBusca } from "./clientes-para-cotizar";

/** El Quote Builder elige un cliente ya existente del vendedor (D-784). */

describe("quién puede elegir qué", () => {
  it("el vendedor, solo los suyos (por vendedor o por quien lo creó) y sin archivados; el admin, todos los vivos", () => {
    const mios = elegibles(CLIENTES_DEMO, { id: "u-sales", admin: false }).map((c) => c.id);
    expect(mios).toEqual([1, 2]);
    const creado = elegibles([{ ...CLIENTES_DEMO[2], rep_id: null, created_by: "u-sales" }], { id: "u-sales", admin: false });
    expect(creado).toHaveLength(1);
    expect(elegibles(CLIENTES_DEMO, { id: "u-admin", admin: true }).map((c) => c.id)).toEqual([1, 2, 3]);
  });
  it("quien no es admin ve además los de SU tienda, por el nombre del perfil (D-789, la regla de Clientes, 217)", () => {
    // De McAllen: el 3 (MCA) aunque sea de otro vendedor; de Brownsville: 1 y 2, que ya eran suyos.
    expect(elegibles(CLIENTES_DEMO, { id: "u-otro", admin: false, store: "RDZ McAllen" }).map((c) => c.id)).toEqual([3]);
    expect(elegibles(CLIENTES_DEMO, { id: "u-otro", admin: false, store: "RDZ Brownsville" }).map((c) => c.id)).toEqual([1, 2]);
    expect(elegibles(CLIENTES_DEMO, { id: "u-otro", admin: false, store: null }).map((c) => c.id)).toEqual([]);
    expect(elegibles(CLIENTES_DEMO, { id: "u-sales", admin: false, store: "RDZ McAllen" }).map((c) => c.id)).toEqual([1, 2, 3]);
    expect(codigoDeMiTienda("RDZ Pharr")).toBe("PHR");
    expect(codigoDeMiTienda(" mca ")).toBe("MCA");
    expect(codigoDeMiTienda("")).toBe("");
  });
});

describe("buscar", () => {
  it("con menos de dos letras no se pregunta ni se ofrece nada", () => {
    expect(seBusca("r")).toBe(false);
    expect(seBusca(" ri")).toBe(true);
    expect(coincidencias(CLIENTES_DEMO, "r")).toEqual([]);
  });
  it("casa por cuenta o por contacto, sin mayúsculas, ordenado por cuenta, y corta en el máximo", () => {
    expect(coincidencias(CLIENTES_DEMO, "ri").map((c) => c.account)).toEqual(["Rio Homes LLC", "Risse Builders", "Valley Flooring"]);
    expect(coincidencias(CLIENTES_DEMO, "SERNA").map((c) => c.id)).toEqual([1]);
    expect(coincidencias(CLIENTES_DEMO, "ll", 2)).toHaveLength(2);
  });
  it("el rótulo lleva cuenta, contacto y tienda; sin contacto, solo cuenta y tienda", () => {
    expect(rotulo(CLIENTES_DEMO[0])).toBe("Risse Builders · Carlos Serna · BRO");
    expect(rotulo(CLIENTES_DEMO[2])).toBe("Valley Flooring · MCA");
  });
});

describe("lo que rellena", () => {
  it("contacto como nombre, cuenta como empresa, teléfono con guiones; el de la ficha de contactos manda", () => {
    expect(relleno(CLIENTES_DEMO[0])).toEqual({ full_name: "Carlos Serna", company: "Risse Builders", phone: "956-703-3694" });
    expect(relleno(CLIENTES_DEMO[1])).toEqual({ full_name: "Ana Pérez", company: "Rio Homes LLC", phone: "956-555-0101" });
  });
  it("sin contacto, el nombre queda vacío (no se inventa) y sin teléfono, vacío", () => {
    expect(relleno({ ...CLIENTES_DEMO[2], phone: null })).toEqual({ full_name: "", company: "Valley Flooring", phone: "" });
  });
  it("de la fila cruda: el primer teléfono con texto de los contactos (193)", () => {
    const c = clienteParaCotizar({ id: "7", store: "BRO", account: "X", contact_name: " ", phone: "1", contacts: [{ phones: ["", " "] }, { phones: ["9565550199"] }], rep_id: null, created_by: null, archived_at: null });
    expect(c).toMatchObject({ id: 7, contact_name: null, phone: "1", telefono_de_contacto: "9565550199", rep_id: null });
  });
});

describe("la pantalla", () => {
  const est = readFileSync(join(process.cwd(), "src/app/estimator/Estimador.tsx"), "utf8").split("\r\n").join("\n");
  it("pregunta a la base con las columnas de aquí, filtra con elegibles y rellena con relleno", () => {
    expect(est).toContain('.from("customers").select(COLUMNAS_PARA_COTIZAR)');
    expect(est).toContain("elegibles(");
    expect(est).toContain("setCliente(relleno(c))");
    expect(est).toContain("data-busca-cliente");
    expect(est).toContain("data-cliente-opcion");
  });
});
