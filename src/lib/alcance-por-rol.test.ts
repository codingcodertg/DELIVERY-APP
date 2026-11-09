import { describe, expect, it } from "vitest";
import {
  ROLES_SOLO_LO_SUYO,
  alcanzaRegistro,
  filtrarPorAlcance,
  hechosClientes,
  hechosDe,
  hechosLeads,
  registroVisible,
  soloVeLoSuyo,
  veTodasLasTiendas,
  CAMPOS_ENTREGAS,
} from "./alcance-por-rol";

const sales = { id: "v1", role: "sales", store: "Pharr" };
const manager = { id: "m1", role: "manager", store: "Pharr" };
const office = { id: "o1", role: "accounting", store: "Pharr" };
const admin = { id: "a1", role: "admin", store: null };
const driver = { id: "d1", role: "driver", store: "Pharr" };
const salesMulti = { id: "v2", role: "sales", store: "Pharr", visible_stores: ["Pharr", "McAllen"] };

describe("quién se acota a lo suyo", () => {
  it("solo los roles de la lista (hoy sales)", () => {
    expect(ROLES_SOLO_LO_SUYO).toEqual(["sales"]);
    expect(soloVeLoSuyo(sales)).toBe(true);
    expect(soloVeLoSuyo(manager)).toBe(false);
    expect(soloVeLoSuyo(office)).toBe(false);
    expect(soloVeLoSuyo(admin)).toBe(false);
    expect(soloVeLoSuyo(null)).toBe(false);
  });

  it("quién ve todas las tiendas (espejo de tiendasQueVe === null)", () => {
    expect(veTodasLasTiendas(admin)).toBe(true);
    expect(veTodasLasTiendas(driver)).toBe(true); // chofer/almacén ven todas
    expect(veTodasLasTiendas(sales)).toBe(false);
    expect(veTodasLasTiendas(manager)).toBe(false);
  });
});

describe("registroVisible: la regla de las dos capas", () => {
  it("quien ve todas las tiendas, lo ve todo", () => {
    expect(registroVisible(admin, { deMiTienda: false, mio: false }, { tieneDueno: true })).toBe(true);
  });
  it("sales con dueño: solo lo suyo, aunque sea de su tienda", () => {
    expect(registroVisible(sales, { deMiTienda: true, mio: false }, { tieneDueno: true })).toBe(false);
    expect(registroVisible(sales, { deMiTienda: true, mio: true }, { tieneDueno: true })).toBe(true);
    expect(registroVisible(sales, { deMiTienda: false, mio: true }, { tieneDueno: true })).toBe(true); // suyo de otra tienda
  });
  it("manager/office: toda su tienda, con o sin dueño", () => {
    expect(registroVisible(manager, { deMiTienda: true, mio: false }, { tieneDueno: true })).toBe(true);
    expect(registroVisible(office, { deMiTienda: true, mio: false }, { tieneDueno: true })).toBe(true);
    expect(registroVisible(manager, { deMiTienda: false, mio: false }, { tieneDueno: true })).toBe(false);
  });
  it("sin campo de dueño: NO se fuerza, sales se cae al alcance por tienda", () => {
    expect(registroVisible(sales, { deMiTienda: true, mio: false }, { tieneDueno: false })).toBe(true);
    expect(registroVisible(sales, { deMiTienda: false, mio: false }, { tieneDueno: false })).toBe(false);
  });
});

describe("camino genérico (Entregas: tienda por nombre)", () => {
  const orden = (store: string, created_by: string | null, rep: string | null = null) =>
    ({ store, created_by, assigned_sales_rep: rep });

  it("sales ve solo las órdenes suyas de su tienda", () => {
    expect(alcanzaRegistro(orden("Pharr", "v1"), sales, CAMPOS_ENTREGAS)).toBe(true);
    expect(alcanzaRegistro(orden("Pharr", "otro"), sales, CAMPOS_ENTREGAS)).toBe(false);
    // acreditada al vendedor (assigned_sales_rep) aunque la creara otro
    expect(alcanzaRegistro(orden("Pharr", "otro", "v1"), sales, CAMPOS_ENTREGAS)).toBe(true);
  });
  it("manager ve toda su tienda; nada de otra", () => {
    expect(alcanzaRegistro(orden("Pharr", "otro"), manager, CAMPOS_ENTREGAS)).toBe(true);
    expect(alcanzaRegistro(orden("McAllen", "otro"), manager, CAMPOS_ENTREGAS)).toBe(false);
  });
  it("admin ve todo; el nombre de tienda se compara sin may/min ni espacios", () => {
    expect(alcanzaRegistro(orden("McAllen", "otro"), admin, CAMPOS_ENTREGAS)).toBe(true);
    expect(alcanzaRegistro(orden(" pharr ", "v1"), sales, CAMPOS_ENTREGAS)).toBe(true);
  });
  it("sales con varias tiendas visibles: lo suyo en cualquiera de ellas", () => {
    expect(alcanzaRegistro(orden("McAllen", "v2"), salesMulti, CAMPOS_ENTREGAS)).toBe(true);
    expect(alcanzaRegistro(orden("McAllen", "otro"), salesMulti, CAMPOS_ENTREGAS)).toBe(false);
  });
  it("filtrarPorAlcance deja pasar solo lo que corresponde", () => {
    const filas = [orden("Pharr", "v1"), orden("Pharr", "otro"), orden("McAllen", "v1")];
    // sales ve lo suyo, esté en la tienda que esté (Pharr/v1 y McAllen/v1), no lo de otro
    expect(filtrarPorAlcance(filas, sales, CAMPOS_ENTREGAS)).toEqual([filas[0], filas[2]]);
    expect(filtrarPorAlcance(filas, manager, CAMPOS_ENTREGAS)).toEqual([filas[0], filas[1]]);
    expect(filtrarPorAlcance(filas, admin, CAMPOS_ENTREGAS)).toEqual(filas);
  });
});

describe("hechosDe: sin dueño el módulo no acota", () => {
  it("un módulo sin accesor de dueño nunca marca mío", () => {
    const h = hechosDe({ store: "Pharr" }, sales, { tienda: (r) => r.store });
    expect(h).toEqual({ deMiTienda: true, mio: false });
  });
});

describe("adaptador Clientes (tienda por código)", () => {
  it("compara el código de la fila contra el código de mi tienda", () => {
    // manager de Pharr (código PHR) ve los de PHR, no los de MCA
    expect(hechosClientes({ store: "PHR", rep_id: null, created_by: null }, manager, "PHR")).toEqual({ deMiTienda: true, mio: false });
    expect(hechosClientes({ store: "MCA", rep_id: null, created_by: null }, manager, "PHR")).toEqual({ deMiTienda: false, mio: false });
  });
  it("sales: lo suyo por rep_id o created_by", () => {
    expect(registroVisible(sales, hechosClientes({ store: "PHR", rep_id: "v1", created_by: null }, sales, "PHR"), { tieneDueno: true })).toBe(true);
    expect(registroVisible(sales, hechosClientes({ store: "PHR", rep_id: "otro", created_by: null }, sales, "PHR"), { tieneDueno: true })).toBe(false);
    expect(registroVisible(sales, hechosClientes({ store: "MCA", rep_id: null, created_by: "v1" }, sales, "PHR"), { tieneDueno: true })).toBe(true);
  });
  it("admin: todo", () => {
    expect(hechosClientes({ store: "MCA", rep_id: null, created_by: null }, admin, "").deMiTienda).toBe(true);
  });
});

describe("adaptador Leads (banco por pool + holder)", () => {
  it("de mi banco por pool; mío por holder", () => {
    expect(hechosLeads({ pool: "RDZ Pharr", holder: null }, manager, "RDZ Pharr")).toEqual({ deMiTienda: true, mio: false });
    expect(hechosLeads({ pool: "RDZ McAllen", holder: "m1" }, manager, "RDZ Pharr")).toEqual({ deMiTienda: false, mio: true });
  });
  it("como banco (tieneDueno:false) un sales ve TODO su banco, para poder tomar libres", () => {
    const h = hechosLeads({ pool: "RDZ Pharr", holder: "otro" }, sales, "RDZ Pharr");
    expect(registroVisible(sales, h, { tieneDueno: false })).toBe(true);
  });
});
