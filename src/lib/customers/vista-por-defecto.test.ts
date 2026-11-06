import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { esOrdenInicial, ORDENES_INICIALES } from "./cabeceras";
import { agrupaEnEmpresas } from "./empresas";
import { empresasQueSeVen } from "./lo-que-se-ve";
import { FILTRO_INICIAL, type Cliente } from "./reglas";
import { columnasDelVendedor } from "./vendedor-por-tienda";
import { filtraPorVendedor, filtrosDeEntrada, TAMANO_INICIAL_DE_CLIENTES } from "./vista-por-defecto";

/** «For users the default should be that they see THEIR customers, sorted ascending, and the default view will be 10». Datos inventados. */
const base = (n: number, c: Partial<Cliente>): Cliente => ({
  id: n, store: "MCA", account: `Cuenta ${n}`, unified_account: null, house_no: null, added_batch: null, qb_status: null, activity_status: null,
  status_store: null, status_group: null, history_store: null, history_group: null, crm_type_store: null, crm_type_group: null, associated_with: null,
  rep_history: null, rep_qb: null, rep_store: null, contact_name: null, contact_title: null, address: null, phone: null, email: null,
  credit_limit: null, euler_limit: null, terms: null, account_no: null, notes: null, updated_at: null, updated_by: null, archived_at: null,
  archived_reason: null, company_id: `e${n}`, ...c,
});
const LISTA: Cliente[] = [
  base(1, { account: "Zeta Pisos", rep_id: "ana", rep_name: "Ana" }),
  base(2, { account: "Bravo Tile", rep_id: "beto", rep_name: "Beto" }),
  base(3, { account: "Alfa Obras", rep_id: "ana", rep_name: "Ana" }),
  base(4, { account: "Delta Sin Vendedor" }),
  base(5, { account: "Carta Archivada", rep_id: "caro", rep_name: "Caro", archived_at: "2026-11-01T00:00:00Z" }),
];
const claves = columnasDelVendedor().map((c) => c.key);
const cuentas = (yo: string, esAdmin: boolean) =>
  empresasQueSeVen(agrupaEnEmpresas(LISTA, FILTRO_INICIAL), filtrosDeEntrada(LISTA, yo, esAdmin), ORDENES_INICIALES, claves).map((e) => e.principal.account);

describe("la vista de entrada de Clientes", () => {
  it("quien no es admin entra viendo SUS clientes, por cuenta de la A a la Z", () => {
    expect(cuentas("ana", false)).toEqual(["Alfa Obras", "Zeta Pisos"]);
    expect(cuentas("beto", false)).toEqual(["Bravo Tile"]);
  });
  it("es el filtro de la columna del vendedor, que se ve y se quita", () => {
    const f = filtrosDeEntrada(LISTA, "ana", false);
    expect(Object.keys(f)).toEqual(["rep_id"]);
    expect([...f.rep_id]).toEqual(["Ana"]);
    expect(filtraPorVendedor(f)).toBe(true);
    expect(claves).toContain("rep_id");
  });
  it("el admin entra viendo todos", () => {
    expect(filtrosDeEntrada(LISTA, "ana", true)).toEqual({});
    expect(cuentas("ana", true)).toEqual(["Alfa Obras", "Bravo Tile", "Delta Sin Vendedor", "Zeta Pisos"]);
  });
  it("sin clientes asignados (o solo archivados) se entra viendo todos, no una tabla vacía", () => {
    expect(filtrosDeEntrada(LISTA, "nadie", false)).toEqual({});
    expect(filtrosDeEntrada(LISTA, "caro", false)).toEqual({});
    expect(filtrosDeEntrada([], "ana", false)).toEqual({});
    expect(filtraPorVendedor({})).toBe(false);
  });
  it("el orden de entrada es Cuenta ascendente y la tabla abre en 10", () => {
    expect(ORDENES_INICIALES).toEqual([{ por: "account", desc: false }]);
    expect(esOrdenInicial(ORDENES_INICIALES)).toBe(true);
    expect(TAMANO_INICIAL_DE_CLIENTES).toBe(10);
  });
  it("la pantalla lo usa: tamaño de entrada, filtro puesto una sola vez y «Ver todos» en la tabla vacía", () => {
    const pantalla = readFileSync("src/app/customers/Clientes.tsx", "utf8");
    expect(pantalla).toContain('useTamanoDeTabla("clientes", TAMANO_INICIAL_DE_CLIENTES)');
    expect(pantalla).toContain("filtrosDeEntrada(lista, userId, esAdmin)");
    expect(pantalla).toContain("entradaPuesta.current = true");
    expect(pantalla).toContain("data-ver-todos");
    // Solo se guarda lo que la persona ELIGE: un 100 guardado es una elección, no el valor de entrada de ayer.
    const selector = readFileSync("src/components/MostrarN.tsx", "utf8");
    expect(selector.match(/localStorage\.setItem/g)).toHaveLength(1);
    expect(selector).toContain("const elegir = (x: TamanoDeTabla) => {");
  });
});
