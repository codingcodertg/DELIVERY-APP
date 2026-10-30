import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { almacenDemo, PERSONAS_DEMO } from "./demo";

/** En el lead cruzado: enlace a la ficha del cliente y el vendedor que lo lleva (D-762). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("el almacén", () => {
  it("lee los clientes cruzados de erp.customers y el nombre del vendedor de profiles; sin ids, nada", () => {
    const a = sinComentarios(leer("src/lib/leads/almacen.ts"));
    expect(a).toContain("clientesCruzados(ids: readonly number[]): Promise<Res<Map<number, ClienteCruzado>>>;");
    expect(a).toContain('supabase.schema("erp").from("customers").select("id, account, store, rep_id").in("id", unicos)');
    expect(a).toContain('supabase.from("profiles").select("id, full_name").in("id", reps)');
    expect(a).toContain("if (!unicos.length) return { ok: true, valor: mapa };");
  });
  it("el demo contesta vacío", async () => {
    const r = await almacenDemo(() => PERSONAS_DEMO[0]).clientesCruzados([1, 2]);
    expect(r.ok && r.valor.size).toBe(0);
  });
});

describe("la pantalla", () => {
  const p = sinComentarios(leer("src/app/leads/Leads.tsx"));
  it("lee los clientes de los cruzados una vez por tanda de ids y se los pasa a la tarjeta", () => {
    expect(p).toContain("void almacen.clientesCruzados(idsCruzados.split(\",\").map(Number))");
    expect(p).toContain("cliente={l.customer_match_id != null ? clientes.get(l.customer_match_id) : undefined}");
  });
  it("la tarjeta enlaza a la ficha del cliente (/customers/<id>) y dice su vendedor, o «Sin asignar»", () => {
    expect(p).toContain('<Link href={`/customers/${l.customer_match_id}`} data-ficha-cliente>');
    expect(p).toContain('<b data-vendedor-cliente>{cliente.rep_name ?? t("Unassigned", "Sin asignar")}</b>');
  });
});
