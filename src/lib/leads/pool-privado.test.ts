import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coincideConCliente, esPrivado, filtrar, type Lead } from "./reglas";
import { leadDeLaBase } from "./almacen";
import { leadsDelBanco } from "./alcance";
// El importador, como módulo: lo que mapea y lo que cruza, sin base.
import { cruza, indiceDeClientes, leadDeFila, nombreClave, poolDeCiudad } from "../../../scripts/leads/importa-leads-privado.mjs";

/** El «Pool privado» (solo admin) y el cruce con Clientes (D-760, migración 218). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const lead = (over: Partial<Lead>): Lead => ({
  id: "x", tabs_project: "T", pool: "RDZ Pharr", distance_miles: null, category: "Sirve – usa piso", project_type: null, reason: null, county: null,
  registered_date: null, project_name: null, facility_name: null, type_of_work: null, scope_of_work: null, square_footage: null, estimated_cost: null,
  est_start_date: null, est_completion_date: null, permit_status: null, site_address: null, site_city: null, site_zip: null, owner_name: null,
  owner_phone: null, owner_contact: null, tenant_name: null, tenant_phone: null, design_firm_name: null, design_firm_phone: null, tdlr_link: null,
  status: "free", holder: null, holder_name: null, taken_at: null, touched_at: null, follow_up_note: null, follow_up_at: null, last_outcome: null,
  last_note: null, last_by: null, last_by_name: null, last_at: null, ...over,
});

describe("el modelo", () => {
  it("source y el cruce se leen de la base; sin columna (base vieja) es tdlr y sin cliente", () => {
    expect(leadDeLaBase({ id: "1", tabs_project: "PRIV 26-00053", pool: "RDZ Pharr", status: "free", source: "privado", customer_match_id: 42, customer_match_note: "Teléfono 956-555-0100 = ACME (PHR)" }))
      .toMatchObject({ source: "privado", customer_match_id: 42, customer_match_note: "Teléfono 956-555-0100 = ACME (PHR)" });
    expect(leadDeLaBase({ id: "1", tabs_project: "T", pool: "P", status: "free" })).toMatchObject({ source: "tdlr", customer_match_id: null, customer_match_note: null });
    expect(esPrivado({ source: "privado" })).toBe(true);
    expect(esPrivado({})).toBe(false);
    expect(coincideConCliente({ customer_match_id: 7 })).toBe(true);
    expect(coincideConCliente({ customer_match_id: null })).toBe(false);
  });
  it("lo privado no entra en el Pool General de nadie, ni del admin", () => {
    const a = lead({ id: "a" }), p = lead({ id: "p", source: "privado" });
    expect(leadsDelBanco([a, p], { todas: true, tienda: null }).map((l) => l.id)).toEqual(["a"]);
    expect(leadsDelBanco([a, p], { todas: false, tienda: "RDZ Pharr" }).map((l) => l.id)).toEqual(["a"]);
  });
  it("el filtro «Coinciden con clientes» deja solo los cruzados; apagado, no cambia nada", () => {
    const si = lead({ id: "si", customer_match_id: 5, customer_match_note: "Nombre «acme» = ACME (PHR)" }), no = lead({ id: "no" });
    const f = { pool: null, vista: "todas" as const, categoria: "todas", tipo: "", ciudad: "", busca: "" };
    expect(filtrar([si, no], { ...f, coinciden: true }).map((l) => l.id)).toEqual(["si"]);
    expect(filtrar([si, no], f).map((l) => l.id)).toEqual(["si", "no"]);
    expect(filtrar([si, no], { ...f, busca: "acme" }).map((l) => l.id)).toEqual(["si"]);
  });
});

describe("el importador", () => {
  const fila = {
    "Contractor Company Name": "Red Moon Buikders Llc", "Issued Date": "2026-08-12", "Permit #": "26-00061", "Type": "RNew", "Structure": "Single Family Dwelling",
    "Total Sq Ft": 3459, "Value": 330000, "Jobsite Address": "907 Bette St.", "City or County": "Pharr", "Subdivision": "Arnold Grove", "Lot": "58&59", "Block": "unk",
    "Contractor Address": "509 West Garrison Dr.", "Contractor City": "Pharr", "St": "TX", "Zip": 78577, "Contractor Phone": 9568219906, "Contractor Phone II": "",
    "Owner Name": "unk", "Owner Address": "unk", "Owner City": "unk", "Owner State": "unk", "Owner Zip": "unk", "Owner Phone": "unk", "Owner Phone II ": "",
  };
  it("un permiso → un lead privado: PRIV + permiso, pool por ciudad, contratista en owner_*, teléfono con guiones, «unk» = nada", () => {
    const l = leadDeFila(fila, 0);
    expect(l).toMatchObject({
      tabs_project: "PRIV 26-00061", pool: "RDZ Pharr", source: "privado", category: "Sirve – usa piso", project_type: "Residential · new",
      project_name: "Single Family Dwelling", facility_name: "Arnold Grove · Lot 58&59", square_footage: 3459, estimated_cost: 330000,
      registered_date: "2026-08-12", site_address: "907 Bette St.", site_city: "Pharr", owner_name: "Red Moon Buikders Llc", owner_phone: "956-821-9906",
      owner_city_state_zip: "Pharr, TX, 78577", tenant_name: null, tenant_phone: null, reason: "Permit 26-00061",
    });
    expect(leadDeFila(fila, 2).tabs_project).toBe("PRIV 26-00061-2");
    expect(leadDeFila({ ...fila, Type: "RNon" }, 0).category).toBe("Might be useful");
  });
  it("la tienda por ciudad: las del Valle; lo desconocido, «No store»", () => {
    expect(poolDeCiudad("Mission")).toBe("RDZ Mission");
    expect(poolDeCiudad("Mercedes")).toBe("RDZ Weslaco");
    expect(poolDeCiudad("Los Fresnos")).toBe("RDZ Brownsville");
    expect(poolDeCiudad("Alamo")).toBe("RDZ Pharr");
    expect(poolDeCiudad("Laredo")).toBe("No store");
  });
  it("el cruce: por teléfono (también los de los contactos) antes que por nombre; «Apellido, Nombre» = «Nombre Apellido»; LLC/Inc no cuentan", () => {
    expect(nombreClave("Red Moon Builders, LLC.")).toBe("red moon builders");
    const idx = indiceDeClientes([
      { id: 1, store: "PHR", account: "RED MOON BUILDERS", unified_account: null, phone: null, contact_name: null, contacts: [{ name: "Ana", phones: ["(956) 821-9906"] }], archived_at: null },
      { id: 2, store: "MCA", account: "LAURA GARZA", unified_account: null, phone: null, contact_name: null, contacts: [], archived_at: null },
      { id: 3, store: "BRO", account: "ARCHIVADO LLC", unified_account: null, phone: "956-000-0000", contact_name: null, contacts: [], archived_at: "2026-01-01" },
    ]);
    expect(cruza(leadDeFila(fila, 0), idx)).toEqual({ id: 1, nota: "Teléfono 956-821-9906 = RED MOON BUILDERS (PHR)" });
    expect(cruza(leadDeFila({ ...fila, "Contractor Company Name": "Garza, Laura", "Contractor Phone": "unk" }, 0), idx)).toEqual({ id: 2, nota: "Nombre «laura garza» = LAURA GARZA (MCA)" });
    expect(cruza(leadDeFila({ ...fila, "Contractor Company Name": "Archivado Llc", "Contractor Phone": "956-000-0000" }, 0), idx)).toBeNull();
    expect(cruza(leadDeFila({ ...fila, "Contractor Company Name": "Nadie", "Contractor Phone": "unk" }, 0), idx)).toBeNull();
  });
});

describe("la base y la pantalla", () => {
  it("la 218: columna source con lista cerrada, el cruce con llave a erp.customers, y lo privado solo para el admin", () => {
    const sql = leer("supabase/migrations/218_leads_pool_privado.sql");
    expect(sql).toContain("check (source in ('tdlr', 'privado'))");
    expect(sql).toContain("customer_match_id bigint references erp.customers(id) on delete set null");
    expect(sql).toContain("case when source = 'privado' then (select public.is_admin())");
    expect(sql).toContain("case when l.source = 'privado' then (select public.is_admin())");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
  });
  it("la pestaña «Pool privado» solo para el admin, con los mismos filtros; el filtro «Coinciden con clientes»; Contratista y Propietario en la tarjeta", () => {
    const p = sinComentarios(leer("src/app/leads/Leads.tsx"));
    expect(p).toContain('type Pestana = "banco" | "mio" | "admin" | "privado";');
    expect(p).toContain('data-pestana="privado"');
    expect(p).toContain('{(pestana === "banco" || (pestana === "privado" && yo.admin)) && (');
    expect(p).toContain('const delBanco = useMemo(() => (pestana === "privado" ? privados : leadsDelBanco(leads, alcance)), [leads, alcance, pestana, privados]);');
    expect(p).toContain("data-coinciden");
    expect(p).toContain('data-cliente={l.customer_match_id ?? ""}');
    expect(p).toContain('t("Contractor", "Contratista")');
    expect(p).toContain('t("Owner", "Propietario")');
    expect(leer("src/lib/leads/almacen.ts")).toContain("source, customer_match_id, customer_match_note");
  });
});
