import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codigoDeTiendaDelPerfil, conCruzadosDeMiTienda, esCruzadoDeMiTienda } from "./alcance";

/** D-799 (225): un lead cruzado con un cliente de MI tienda se ve y se toma aunque su pool sea otra tienda. */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

describe("el gemelo del cruce por tienda", () => {
  const clientes = new Map([[1, { store: "MCA" }], [2, { store: " phr " }], [3, { store: "" }]]);
  it("cruzado con un cliente de mi tienda: por el código de la fila contra el nombre del perfil", () => {
    expect(esCruzadoDeMiTienda({ customer_match_id: 1 }, clientes, codigoDeTiendaDelPerfil("RDZ McAllen"))).toBe(true);
    expect(esCruzadoDeMiTienda({ customer_match_id: 2 }, clientes, codigoDeTiendaDelPerfil("RDZ Pharr"))).toBe(true);
    expect(esCruzadoDeMiTienda({ customer_match_id: 1 }, clientes, codigoDeTiendaDelPerfil("RDZ Pharr"))).toBe(false);
    expect(esCruzadoDeMiTienda({ customer_match_id: 3 }, clientes, "MCA")).toBe(false);
    expect(esCruzadoDeMiTienda({ customer_match_id: null }, clientes, "MCA")).toBe(false);
    expect(esCruzadoDeMiTienda({ customer_match_id: 1 }, clientes, "")).toBe(false);
  });
  it("se suman a los visibles sin repetir y en su orden", () => {
    const a = { id: "a", customer_match_id: 1 }, b = { id: "b", customer_match_id: null }, c = { id: "c", customer_match_id: 1 };
    const es = (l: { customer_match_id: number | null }) => l.customer_match_id === 1;
    expect(conCruzadosDeMiTienda([a], [a, b, c], es).map((l) => l.id)).toEqual(["a", "c"]);
  });
});

describe("la base (225) y la pantalla", () => {
  it("la 225 suma el cruce a las dos ramas de «leads select» y abre LD005 en lead_take", () => {
    const sql = leer("supabase/migrations/225_leads_cruzados_de_mi_tienda.sql");
    expect(sql.match(/or public\.leads_cruce_en_mi_tienda\(customer_match_id\)/g)).toHaveLength(2);
    expect(sql.match(/and not public\.leads_cruce_en_mi_tienda\(v_match\)/g)).toHaveLength(2);
    expect(sql).toContain("erp.customers_codigo_de_tienda(public.leads_my_store())");
  });
  it("la lista incluye los cruzados con mi tienda en el GOV Pool, en el STXP Pool y pasa el filtro de pool", () => {
    const p = leer("src/app/leads/Leads.tsx");
    expect(p).toContain("conCruzadosDeMiTienda(leadsDelBanco(leads, alcance)");
    expect(p).toContain("conCruzadosDeMiTienda(privadosBase");
    expect(p).toContain("l.pool === poolFiltro || cruzadoDeMiTienda(l)");
  });
});
