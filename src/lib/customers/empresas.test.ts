import { describe, expect, it } from "vitest";
import { entradaActiva } from "@/lib/erp/nav";
import { almacenDemoNuevo, CLIENTES_DEMO, SUGERENCIAS_DEMO } from "./demo";
import {
  agrupaEnEmpresas, empresasPorTienda, filasDeLaEmpresa, ordenarEmpresas, paresParaDecidir, principalDe, rotuloDeDecidir,
  sugerenciaDeLaBase, vistaPreviaDeJuntar, type Sugerencia,
} from "./empresas";
import { FILTRO_INICIAL, type Cliente } from "./reglas";

/** La lista por EMPRESA (189): una fila por compañía, la ficha por tienda, la cola. Datos inventados. */
const t = (en: string, _es: string) => en;
const base = (n: number, c: Partial<Cliente>): Cliente => ({
  id: n, store: "MCA", account: `Cuenta ${n}`, unified_account: null, house_no: null, added_batch: null, qb_status: null, activity_status: null,
  status_store: null, status_group: null, history_store: null, history_group: null, crm_type_store: null, crm_type_group: null, associated_with: null,
  rep_history: null, rep_qb: null, rep_store: null, contact_name: null, contact_title: null, address: null, phone: null, email: null,
  credit_limit: null, euler_limit: null, terms: null, account_no: null, notes: null, updated_at: null, updated_by: null, archived_at: null,
  archived_reason: null, company_id: `e${n}`, ...c,
});

// Acme: tres tiendas (la de Pharr, la más completa). Zeta: una. Beta: dos, y una archivada aparte.
const LISTA: Cliente[] = [
  base(1, { account: "Acme Homes", store: "BRO", company_id: "ACME", status_store: "LOST", rep_store: "CRR" }),
  base(2, { account: "Acme Homes LLC", store: "PHR", company_id: "ACME", status_store: "ACTIVE INC", rep_store: "IM", phone: "956-555-0101", email: "a@acme.test" }),
  base(3, { account: "ACME HOMES", store: "MCA", company_id: "ACME", status_store: "NEW" }),
  base(4, { account: "Zeta Tile", store: "PHR", company_id: "ZETA", status_store: "LOST" }),
  base(5, { account: "Beta Builders", store: "EDG", company_id: "BETA", status_store: "NONE SALE", phone: "956-555-0199" }),
  base(6, { account: "Beta Builders", store: "WES", company_id: "BETA" }),
  base(7, { account: "Beta Builders", store: "MCA", company_id: "BETA", archived_at: "2026-10-21T00:00:00Z", archived_reason: "duplicado: unido a #5" }),
];

describe("una fila por empresa", () => {
  it("agrupa por empresa, y la fila que se enseña es la más completa", () => {
    const e = agrupaEnEmpresas(LISTA, FILTRO_INICIAL);
    expect(e.map((x) => x.clave).sort()).toEqual(["ACME", "BETA", "ZETA"]);
    const acme = e.find((x) => x.clave === "ACME")!;
    expect(acme.principal.id).toBe(2);
    // Las pestañas, en el orden de las tiendas (BRO, EDG, MCA, PHR, WES).
    expect(acme.filas.map((c) => c.store)).toEqual(["BRO", "MCA", "PHR"]);
    // La archivada (181/189) no es una tienda de la empresa en la vista de vivos.
    expect(e.find((x) => x.clave === "BETA")!.filas.map((c) => c.id)).toEqual([5, 6]);
  });
  it("con una tienda elegida sale toda empresa con fila allí, y se enseña la fila de ESA tienda", () => {
    const e = agrupaEnEmpresas(LISTA, { ...FILTRO_INICIAL, tienda: "BRO" });
    expect(e.map((x) => x.clave)).toEqual(["ACME"]);
    expect(e[0].principal.id).toBe(1);
    expect(e[0].filas).toHaveLength(3);
  });
  it("estado y búsqueda miran todas las filas: el vendedor de otra tienda encuentra la empresa", () => {
    expect(agrupaEnEmpresas(LISTA, { ...FILTRO_INICIAL, estado: "LOST" }).map((x) => x.clave).sort()).toEqual(["ACME", "ZETA"]);
    const crr = agrupaEnEmpresas(LISTA, { ...FILTRO_INICIAL, busca: "crr" });
    expect(crr.map((x) => x.clave)).toEqual(["ACME"]);
    expect(crr[0].principal.id).toBe(1);
    expect(agrupaEnEmpresas(LISTA, { ...FILTRO_INICIAL, estado: "none" }).map((x) => x.clave)).toEqual(["BETA"]);
  });
  it("archivados con el chip, nunca mezclados", () => {
    const e = agrupaEnEmpresas(LISTA, { ...FILTRO_INICIAL, archivados: true });
    expect(e.map((x) => x.principal.id)).toEqual([7]);
  });
  it("principal: más campos llenos; a igualdad, la más vieja", () => {
    expect(principalDe([base(9, { phone: "1" }), base(8, {})]).id).toBe(9);
    expect(principalDe([base(9, {}), base(8, {})]).id).toBe(8);
  });
  it("ordena por la fila que se enseña", () => {
    const e = ordenarEmpresas(agrupaEnEmpresas(LISTA, FILTRO_INICIAL), { por: "account", desc: true });
    expect(e.map((x) => x.clave)).toEqual(["ZETA", "BETA", "ACME"]);
  });
  it("los chips cuentan EMPRESAS por tienda", () => {
    const conDosEnPharr = [...LISTA, base(8, { account: "Acme Homes Inc", store: "PHR", company_id: "ACME" })];
    const e = agrupaEnEmpresas(conDosEnPharr, FILTRO_INICIAL);
    const t2 = empresasPorTienda(e);
    expect(t2.get("PHR")).toBe(2);
    expect(t2.get("MCA")).toBe(1);
    expect(t2.get("WES")).toBe(1);
  });
  it("las pestañas de la ficha: la misma empresa y el mismo estado de archivo", () => {
    expect(filasDeLaEmpresa(LISTA, LISTA[2]).map((c) => c.id)).toEqual([1, 3, 2]);
    expect(filasDeLaEmpresa(LISTA, LISTA[6]).map((c) => c.id)).toEqual([7]);
    expect(filasDeLaEmpresa(LISTA, LISTA[3]).map((c) => c.id)).toEqual([4]);
  });
});

describe("la cola «Decidir si se juntan»", () => {
  const sug = (id: number, a: number, b: number, reason: string, score: number | null, status: Sugerencia["status"] = "pending"): Sugerencia =>
    ({ id, a_id: a, b_id: b, reason, score, status, created_at: null });
  it("solo las pendientes con dos filas vivas de empresas distintas; primero las de más motivos", () => {
    const p = paresParaDecidir([
      sug(1, 4, 5, "nombre_parecido", 0.9),
      sug(2, 2, 5, "telefono,correo", 0.2),
      sug(3, 1, 2, "telefono", 1),
      sug(4, 4, 7, "correo", null),
      sug(5, 3, 4, "telefono", 0.1, "rejected"),
      sug(6, 3, 99, "telefono", 0.1),
    ], LISTA);
    expect(p.map((x) => x.sugerencia.id)).toEqual([2, 1]);
    expect(p[0].motivos).toEqual(["telefono", "correo"]);
  });
  it("lee la fila de la base", () => {
    expect(sugerenciaDeLaBase({ id: "3", a_id: "10", b_id: "12", reason: "telefono", score: "0.917", status: "pending", created_at: "x" }))
      .toEqual({ id: 3, a_id: 10, b_id: 12, reason: "telefono", score: 0.917, status: "pending", created_at: "x" });
    expect(sugerenciaDeLaBase({ id: 1, a_id: 1, b_id: 2, reason: "", score: null, status: "otra" }).status).toBe("pending");
  });
  it("la vista previa dice en qué tiendas queda y qué filas de una tienda se unen", () => {
    const v = vistaPreviaDeJuntar(LISTA, 4, 2);
    expect(v.tiendas).toEqual(["BRO", "MCA", "PHR"]);
    expect(v.pasos.map((x) => [x.sobrevive, x.archivada])).toEqual([[2, 4]]);
  });
  it("el rótulo de la pestaña lleva las pendientes si hay", () => {
    expect(rotuloDeDecidir(12, t)).toBe("Decide to merge (12)");
    expect(rotuloDeDecidir(0, t)).toBe("Decide to merge");
    expect(rotuloDeDecidir(null, t)).toBe("Decide to merge");
  });
  it("en la barra, /customers/juntar enciende «Decidir», no «Clientes»", () => {
    const items = [{ href: "/customers", label: "C" }, { href: "/customers/juntar", label: "D" }];
    expect(entradaActiva(items, "/customers/juntar")).toBe("/customers/juntar");
    expect(entradaActiva(items, "/customers")).toBe("/customers");
    expect(entradaActiva(items, "/customers/12")).toBe("/customers");
  });
});

describe("el demo", () => {
  it("1 y 2 son la misma empresa; la cola trae los dos sospechosos inventados, y nada más", () => {
    expect(CLIENTES_DEMO.find((c) => c.id === 1)!.company_id).toBe(CLIENTES_DEMO.find((c) => c.id === 2)!.company_id);
    expect(SUGERENCIAS_DEMO.map((s) => [s.a_id, s.b_id]).sort()).toEqual([[3, 9], [6, 10]]);
  });
  it("juntar en el demo: misma tienda → una fila (la otra archivada); tiendas distintas → una empresa; rechazar no vuelve", async () => {
    const a = almacenDemoNuevo();
    const s = await a.sugerencias();
    const de = (x: number, y: number) => (s.ok ? s.valor.find((v) => v.a_id === x && v.b_id === y)! : null)!;
    expect((await a.juntar(6, 10)).ok).toBe(true);
    let l = await a.leer();
    expect(l.ok && l.valor.find((c) => c.id === 10)!.archived_reason).toBe("duplicado: unido a #6");
    expect((await a.rechazar(de(3, 9).id)).ok).toBe(true);
    expect((await a.rechazar(de(3, 9).id)).ok).toBe(false);
    const quedan = await a.sugerencias();
    expect(quedan.ok && quedan.valor).toEqual([]);
    expect((await a.juntar(3, 9)).ok).toBe(true);
    l = await a.leer();
    const c3 = l.ok ? l.valor.find((c) => c.id === 3)! : null, c9 = l.ok ? l.valor.find((c) => c.id === 9)! : null;
    expect(c3!.company_id).toBe(c9!.company_id);
    expect(c9!.archived_at).toBeNull();
  });
});
