import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { almacenDemo, PERSONAS_DEMO } from "./demo";
import { filtrar, type Filtros, type Lead } from "./reglas";

/** En el lead cruzado: enlace a la ficha del cliente y el vendedor que lo lleva (D-762); la ficha se abre en una tarjeta dentro de Leads (D-763). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("el almacén", () => {
  it("lee los clientes cruzados de erp.customers y el nombre del vendedor de profiles; sin ids, nada", () => {
    const a = sinComentarios(leer("src/lib/leads/almacen.ts"));
    expect(a).toContain("clientesCruzados(ids: readonly number[]): Promise<Res<Map<number, ClienteCruzado>>>;");
    expect(a).toContain('supabase.schema("erp").from("customers").select(COLUMNAS_CRUZADO).in("id", unicos)');
    for (const col of ["contact_name", "phone", "email", "address", "terms", "credit_limit", "notes"]) expect(a).toMatch(new RegExp(`COLUMNAS_CRUZADO = "[^"]*\\b${col}\\b`));
    expect(a).toContain('supabase.from("profiles").select("id, full_name").in("id", reps)');
    expect(a).toContain("if (!unicos.length) return { ok: true, valor: mapa };");
  });
  it("el demo contesta vacío", async () => {
    const r = await almacenDemo(() => PERSONAS_DEMO[0]).clientesCruzados([1, 2]);
    expect(r.ok && r.valor.size).toBe(0);
  });
});

describe("la tarjeta del cliente", () => {
  const p = sinComentarios(leer("src/app/leads/Leads.tsx"));
  it("enseña tienda, vendedor, contacto, teléfono, correo, dirección, términos, crédito, estado, notas y por qué coincide; y un enlace secundario a Clientes", () => {
    for (const k of ["Tienda", "Vendedor", "Contacto", "Teléfono", "Correo", "Dirección", "N.º de cuenta", "Términos", "Límite de crédito", "Estado", "Notas", "Por qué coincide"]) {
      expect(p).toContain(`"${k}")`);
    }
    expect(p).toContain("dialogo.lead.customer_match_note ?? null]");
    expect(p).toContain('<Link className="btn btn-ghost" href={`/customers/${c.id}`} data-abrir-en-clientes>');
  });
});

describe("la búsqueda del pool", () => {
  const base: Filtros = { pool: null, vista: "todas", categoria: "todas", tipo: "", ciudad: "", busca: "" };
  const lead = (id: string, extra: Partial<Lead>): Lead => ({
    id, tabs_project: "T-" + id, pool: "p", distance_miles: 1, category: null, project_type: null, reason: null, county: null, registered_date: null,
    project_name: null, facility_name: null, type_of_work: null, scope_of_work: null, square_footage: null, estimated_cost: null, est_start_date: null,
    est_completion_date: null, permit_status: null, site_address: null, site_city: null, site_zip: null, owner_name: null, owner_phone: null, owner_contact: null,
    tenant_name: null, tenant_phone: null, design_firm_name: null, design_firm_phone: null, tdlr_link: null, status: "free", holder: null, holder_name: null,
    taken_at: null, touched_at: null, follow_up_note: null, follow_up_at: null, last_outcome: null, last_note: null, last_by: null, last_by_name: null, last_at: null,
    ...extra,
  } as Lead);
  const ids = (ls: Lead[], busca: string, textoExtra?: Filtros["textoExtra"]) => filtrar(ls, { ...base, busca, textoExtra }).map((l) => l.id);
  it("encuentra por quien tiene el lead, por el teléfono del dueño, por la firma de diseño y por el condado (campos que antes no se buscaban)", () => {
    const ls = [lead("a", { holder_name: "Ana López", status: "taken" }), lead("b", { owner_phone: "956-555-0123" }), lead("c", { design_firm_name: "Zagar Arquitectos" }), lead("d", { county: "Cameron" })];
    expect(ids(ls, "lopez")).toEqual(["a"]);
    expect(ids(ls, "555-0123")).toEqual(["b"]);
    expect(ids(ls, "zagar")).toEqual(["c"]);
    expect(ids(ls, "cameron")).toEqual(["d"]);
  });
  it("encuentra por el vendedor y la cuenta del cliente cruzado, que llegan de fuera del lead", () => {
    const ls = [lead("a", { customer_match_id: 7 } as Partial<Lead>), lead("b", {})];
    const extra = (l: Lead) => (l.customer_match_id === 7 ? "ZAGAR BUILDERS · Beto Demo" : "");
    expect(ids(ls, "beto", extra)).toEqual(["a"]);
    expect(ids(ls, "zagar builders", extra)).toEqual(["a"]);
    expect(ids(ls, "beto")).toEqual([]);
  });
  it("no busca en ids ni fechas en bruto", () => {
    const ls = [lead("abc123", { tabs_project: "TABS", holder: "uuid-9", taken_at: "2026-10-30T10:00:00Z" })];
    expect(ids(ls, "abc123")).toEqual([]);
    expect(ids(ls, "uuid-9")).toEqual([]);
    expect(ids(ls, "2026-10-30")).toEqual([]);
  });
});

describe("la pantalla", () => {
  const p = sinComentarios(leer("src/app/leads/Leads.tsx"));
  it("lee los clientes de los cruzados una vez por tanda de ids y se los pasa a la tarjeta", () => {
    expect(p).toContain("void almacen.clientesCruzados(idsCruzados.split(\",\").map(Number))");
    expect(p).toContain("cliente={l.customer_match_id != null ? clientes.get(l.customer_match_id) : undefined}");
  });
  it("la cuenta abre la tarjeta del cliente aquí mismo (no salta a la app de Clientes) y dice su vendedor, o «Sin asignar»", () => {
    expect(p).toContain('data-ficha-cliente onClick={() => onCliente(cliente)}');
    expect(p).not.toContain("<Link href={`/customers/${l.customer_match_id}`}");
    expect(p).toContain('onCliente={(c) => setDialogo({ tipo: "cliente", lead: l, cliente: c })}');
    expect(p).toContain('{dialogo?.tipo === "cliente" && <FichaCruzada dialogo={dialogo} onCerrar={() => setDialogo(null)} />}');
    expect(p).toContain('{dialogo && dialogo.tipo !== "cliente" && (');
    expect(p).toContain('<b data-vendedor-cliente>{cliente.rep_name ?? t("Unassigned", "Sin asignar")}</b>');
  });
});
