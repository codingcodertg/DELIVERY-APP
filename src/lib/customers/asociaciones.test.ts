import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { asociadasDe, asociadoDeLaBase, asociadosDesdeLaLista, candidatosParaAsociar, claveDePar, parNormalizado, paresSinRepetir, puedeAsociar } from "./asociaciones";
import { almacenDemoNuevo } from "./demo";
import { cambiosDelHistorial, CLASE_DE_HISTORIAL, textoDeCambios } from "./edicion-como-solicitud";
import type { Cliente } from "./reglas";

// D-NEXT (249): «En asociación con».
const fila = (id: number, company_id: string, account: string, extra: Partial<Cliente> = {}): Cliente =>
  ({ id, company_id, account, store: "MCA", archived_at: null, phone: null, contacts: [], ...extra }) as unknown as Cliente;

describe("asociaciones: simetría", () => {
  it("A·B y B·A son el mismo par", () => {
    expect(parNormalizado("b", "a")).toEqual({ company_a: "a", company_b: "b" });
    expect(claveDePar("a", "b")).toBe(claveDePar("b", "a"));
  });
  it("si A está con B, B está con A", () => {
    const pares = [{ id: 1, company_a: "a", company_b: "b" }];
    expect(asociadasDe("a", pares)).toEqual(["b"]);
    expect(asociadasDe("b", pares)).toEqual(["a"]);
    expect(asociadasDe("c", pares)).toEqual([]);
  });
  it("en la demo, asociar desde A lo enseña en B y apunta el historial en las filas de las dos", async () => {
    const al = almacenDemoNuevo();
    const lista = (await al.leer()) as { ok: true; valor: Cliente[] };
    const [x, y] = [...new Set(lista.valor.map((c) => c.company_id!))];
    expect((await al.asociar!(x, y)).ok).toBe(true);
    const deY = await al.asociados!(y);
    expect(deY.ok && deY.valor.map((a) => a.company_id)).toEqual([x]);
    const filaDeY = lista.valor.find((c) => c.company_id === y)!;
    const h = await al.historial(filaDeY.id);
    expect(h.ok && h.valor[0].kind).toBe("associate");
    const filaDeX = lista.valor.find((c) => c.company_id === x)!;
    const hx = await al.historial(filaDeX.id);
    expect(hx.ok && hx.valor[0].kind).toBe("associate");
    // Quitar desde B la borra para los dos.
    expect((await al.desasociar!((deY as { ok: true; valor: { id: number }[] }).valor[0].id)).ok).toBe(true);
    const deX = await al.asociados!(x);
    expect(deX.ok && deX.valor).toEqual([]);
  });
});

describe("asociaciones: nunca consigo misma", () => {
  it("el mismo company_id no forma par", () => {
    expect(parNormalizado("a", "a")).toBeNull();
    expect(parNormalizado("A", " a ")).toBeNull();
    expect(parNormalizado("a", "")).toBeNull();
    expect(puedeAsociar("a", "a", [])).toBe(false);
  });
  it("el buscador no ofrece la propia empresa (ninguna de sus tiendas)", () => {
    const lista = [fila(1, "a", "ACME BUILDERS"), fila(2, "a", "ACME BUILDERS", { store: "PHR" }), fila(3, "b", "ACME CONTRACTORS")];
    expect(candidatosParaAsociar(lista, "a", [], "acme").map((c) => c.company_id)).toEqual(["b"]);
  });
  it("la demo rechaza asociar consigo misma", async () => {
    const al = almacenDemoNuevo();
    expect((await al.asociar!("demo-empresa-1", "demo-empresa-1")).ok).toBe(false);
  });
});

describe("asociaciones: sin repetidos", () => {
  it("pares repetidos (en cualquier orden) cuentan una vez", () => {
    const pares = [{ id: 1, company_a: "a", company_b: "b" }, { id: 2, company_a: "b", company_b: "a" }, { id: 3, company_a: "c", company_b: "c" }];
    expect(paresSinRepetir(pares).map((p) => p.id)).toEqual([1]);
    expect(asociadasDe("a", pares)).toEqual(["b"]);
  });
  it("no se asocia dos veces y el buscador no ofrece las ya asociadas", () => {
    expect(puedeAsociar("a", "b", ["b"])).toBe(false);
    expect(puedeAsociar("a", "b", ["c"])).toBe(true);
    const lista = [fila(1, "b", "ACME"), fila(2, "c", "ACME TWO")];
    expect(candidatosParaAsociar(lista, "a", ["b"], "acme").map((c) => c.company_id)).toEqual(["c"]);
  });
  it("una empresa con varias tiendas sale una vez, con sus tiendas y su tipo", () => {
    const lista = [fila(1, "b", "ACME", { store: "PHR" }), fila(2, "b", "ACME", { store: "BRO", crm_type_store: "CONTRACTOR" } as Partial<Cliente>)];
    const [c] = candidatosParaAsociar(lista, "a", [], "acme");
    expect(c.stores.sort()).toEqual(["BRO", "PHR"]);
    expect(c.crm_type).toBe("CONTRACTOR");
  });
  it("la demo no deja el mismo par dos veces, en ningún orden", async () => {
    const al = almacenDemoNuevo();
    expect((await al.asociar!("demo-empresa-1", "demo-empresa-2")).ok).toBe(true);
    expect((await al.asociar!("demo-empresa-2", "demo-empresa-1")).ok).toBe(false);
  });
});

describe("asociaciones: buscador y lectura", () => {
  it("busca por teléfono y no ofrece archivadas; con una letra, nada", () => {
    const lista = [fila(1, "b", "ZETA", { phone: "956-555-0101" }), fila(2, "c", "ZETA OLD", { archived_at: "2026-01-01" } as Partial<Cliente>)];
    expect(candidatosParaAsociar(lista, "a", [], "5550101").map((c) => c.company_id)).toEqual(["b"]);
    expect(candidatosParaAsociar(lista, "a", [], "zeta").map((c) => c.company_id)).toEqual(["b"]);
    expect(candidatosParaAsociar(lista, "a", [], "z")).toEqual([]);
  });
  it("lee la fila de erp.asociados_de_la_empresa", () => {
    expect(asociadoDeLaBase({ id: 7, company_id: "b", account: "ACME", stores: ["MCA", null], crm_type: " ", all_archived: true }))
      .toEqual({ id: 7, company_id: "b", account: "ACME", stores: ["MCA"], crm_type: null, archivado: true });
  });
  it("desde la lista en memoria, la otra empresa de cada par", () => {
    const lista = [fila(1, "a", "A"), fila(2, "b", "B")];
    expect(asociadosDesdeLaLista("b", [{ id: 1, company_a: "a", company_b: "b" }], lista).map((x) => x.account)).toEqual(["A"]);
  });
  it("el historial dice «En asociación con» y el nombre, sin antes → después", () => {
    const h = { kind: "associate" as const, before: null, after: { associated_customer: "ACME", associated_company: "x" } };
    expect(CLASE_DE_HISTORIAL.associate.es).toBe("Asociación añadida");
    expect(cambiosDelHistorial(h).map((c) => c.key)).toEqual(["associated_customer"]);
    expect(textoDeCambios(h, "es")).toEqual(["En asociación con: ACME"]);
  });
});

describe("asociaciones: la migración", () => {
  const sql = readFileSync(join(__dirname, "../../../supabase/migrations/249_clientes_asociaciones.sql"), "utf8");
  it("par único sin orden, nunca consigo misma, y escribe solo quien edita directo", () => {
    expect(sql).toMatch(/least\(company_a, company_b\), greatest\(company_a, company_b\)/);
    expect(sql).toMatch(/check \(company_a <> company_b\)/);
    expect(sql).toMatch(/for insert to authenticated\s+with check \(\(select erp\.es_admin_de_clientes\(\)\)\)/);
    expect(sql).toMatch(/for delete to authenticated\s+using \(\(select erp\.es_admin_de_clientes\(\)\)\)/);
  });
  it("el historial admite las clases nuevas sin perder las de la 245", () => {
    for (const k of Object.keys(CLASE_DE_HISTORIAL)) expect(sql).toContain(`'${k}'`);
  });
  it("no toca associated_with", () => {
    expect(sql).not.toMatch(/(alter|update)[^;]*associated_with/i);
  });
});
