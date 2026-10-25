import { describe, expect, it } from "vitest";
import { almacenDeLaBase, esSinPermiso, faltaLaTabla, PAGINA } from "./almacen";

/**
 * El almacén contra un cliente FALSO que responde lo que se le diga: lo que se mide es cómo se leen las respuestas de
 * PostgREST (páginas, cero filas, códigos), no la base. La base se mide con el ensayo del plan.
 */
type Respuesta = { data: unknown; error: { code?: string; message: string } | null };

function clienteFalso(paginas: Respuesta[], escritura: Respuesta) {
  const llamadas: { tipo: string; args: unknown[] }[] = [];
  let pagina = 0;
  const cadena: Record<string, unknown> = {};
  const metodo = (tipo: string) => (...args: unknown[]) => { llamadas.push({ tipo, args }); return cadena; };
  Object.assign(cadena, {
    select: metodo("select"), order: metodo("order"), eq: metodo("eq"), update: metodo("update"), insert: metodo("insert"),
    range: (...args: unknown[]) => { llamadas.push({ tipo: "range", args }); return Promise.resolve(paginas[pagina++] ?? { data: [], error: null }); },
    maybeSingle: () => { llamadas.push({ tipo: "maybeSingle", args: [] }); return Promise.resolve(escritura); },
  });
  const sb = { from: (tabla: string) => { llamadas.push({ tipo: "from", args: [tabla] }); return cadena; } } as any;
  return { sb, llamadas };
}

const fila = (id: number) => ({ id, store: "MCA", account: `C${id}` });

describe("leer", () => {
  it("pagina de 1.000 en 1.000 hasta que una página viene corta, y suma todas", async () => {
    const primera = Array.from({ length: PAGINA }, (_, i) => fila(i + 1));
    const segunda = [fila(1001), fila(1002), fila(1003), fila(1004), fila(1005)];
    const { sb, llamadas } = clienteFalso([{ data: primera, error: null }, { data: segunda, error: null }], { data: null, error: null });
    const r = await almacenDeLaBase(sb).leer();
    expect(r.ok && r.valor.length).toBe(1005);
    expect(r.ok && r.valor[1004].account).toBe("C1005");
    expect(llamadas.filter((l) => l.tipo === "range").map((l) => l.args)).toEqual([[0, 999], [1000, 1999]]);
    expect(llamadas.filter((l) => l.tipo === "from").every((l) => l.args[0] === "customers")).toBe(true);
  });
  it("una página corta de entrada es la única", async () => {
    const { sb, llamadas } = clienteFalso([{ data: [fila(1)], error: null }], { data: null, error: null });
    const r = await almacenDeLaBase(sb).leer();
    expect(r.ok && r.valor.length).toBe(1);
    expect(llamadas.filter((l) => l.tipo === "range")).toHaveLength(1);
  });
  it("sin la 180: sinTabla; otro error: su mensaje", async () => {
    const sin = await almacenDeLaBase(clienteFalso([{ data: null, error: { code: "PGRST205", message: "no table" } }], { data: null, error: null }).sb).leer();
    expect(sin).toMatchObject({ ok: false, sinTabla: true });
    const otro = await almacenDeLaBase(clienteFalso([{ data: null, error: { code: "57014", message: "canceled" } }], { data: null, error: null }).sb).leer();
    expect(otro).toMatchObject({ ok: false, sinTabla: false, error: "canceled" });
  });
});

describe("guardar y crear", () => {
  it("devuelven la fila como quedó en la base, tipada", async () => {
    const { sb, llamadas } = clienteFalso([], { data: { id: "7", store: "BRO", account: "X", credit_limit: "10" }, error: null });
    const r = await almacenDeLaBase(sb).guardar(7, { notes: "hola" });
    expect(r.ok && r.valor).toMatchObject({ id: 7, credit_limit: 10 });
    expect(llamadas.find((l) => l.tipo === "update")?.args).toEqual([{ notes: "hola" }]);
    expect(llamadas.find((l) => l.tipo === "eq")?.args).toEqual(["id", 7]);
    expect(llamadas.some((l) => l.tipo === "select")).toBe(true);
  });
  it("cero filas de vuelta NO es «guardado»: la política no dejó pasar el UPDATE", async () => {
    const r = await almacenDeLaBase(clienteFalso([], { data: null, error: null }).sb).guardar(7, { notes: "x" });
    expect(r).toMatchObject({ ok: false, sinPermiso: true, duplicado: false });
    const c = await almacenDeLaBase(clienteFalso([], { data: null, error: null }).sb).crear({ store: "BRO", account: "N" });
    expect(c).toMatchObject({ ok: false, sinPermiso: true });
  });
  it("un duplicado (23505) y un rechazo de RLS (42501) se distinguen", async () => {
    const d = await almacenDeLaBase(clienteFalso([], { data: null, error: { code: "23505", message: "dup" } }).sb).crear({ store: "BRO", account: "N" });
    expect(d).toMatchObject({ ok: false, duplicado: true, sinPermiso: false });
    const p = await almacenDeLaBase(clienteFalso([], { data: null, error: { code: "42501", message: "new row violates row-level security" } }).sb).crear({ store: "BRO", account: "N" });
    expect(p).toMatchObject({ ok: false, duplicado: false, sinPermiso: true });
  });
  it("faltaLaTabla y esSinPermiso solo con sus códigos", () => {
    expect(faltaLaTabla({ code: "42P01" })).toBe(true);
    expect(faltaLaTabla({ code: "42501" })).toBe(false);
    expect(esSinPermiso({ code: "42501" })).toBe(true);
    expect(esSinPermiso({ code: null, message: "permission denied for table customers" })).toBe(true);
    expect(esSinPermiso({ code: "23505", message: "dup" })).toBe(false);
  });
});

describe("la 189 · empresas y la cola", () => {
  /** Un cliente falso con `rpc`: devuelve lo que se le diga y apunta con qué se le llamó. */
  function conRpc(respuesta: Respuesta) {
    const f = clienteFalso([{ data: [{ id: "4", a_id: "10", b_id: "12", reason: "telefono", score: "0.9", status: "pending" }], error: null }], { data: null, error: null });
    const rpcs: unknown[][] = [];
    f.sb.rpc = (...args: unknown[]) => { rpcs.push(args); return Promise.resolve(respuesta); };
    return { ...f, rpcs };
  }
  it("las sugerencias se leen de customer_merge_suggestions, solo las pendientes, tipadas", async () => {
    const { sb, llamadas } = conRpc({ data: null, error: null });
    const r = await almacenDeLaBase(sb).sugerencias();
    expect(r.ok && r.valor).toEqual([{ id: 4, a_id: 10, b_id: 12, reason: "telefono", score: 0.9, status: "pending", created_at: null }]);
    expect(llamadas.find((l) => l.tipo === "from")?.args).toEqual(["customer_merge_suggestions"]);
    expect(llamadas.find((l) => l.tipo === "eq")?.args).toEqual(["status", "pending"]);
  });
  it("juntar es UNA llamada a erp.junta_clientes con los dos ids; rechazar, a rechaza_sugerencia_de_clientes", async () => {
    const j = conRpc({ data: "uuid-1", error: null });
    expect(await almacenDeLaBase(j.sb).juntar(10, 12)).toEqual({ ok: true, valor: "uuid-1" });
    expect(j.rpcs).toEqual([["junta_clientes", { p_a: 10, p_b: 12 }]]);
    const r = conRpc({ data: null, error: null });
    expect(await almacenDeLaBase(r.sb).rechazar(4)).toEqual({ ok: true, valor: null });
    expect(r.rpcs).toEqual([["rechaza_sugerencia_de_clientes", { p_id: 4 }]]);
  });
  it("un no de la base se dice: sin permiso (42501); y sin la 189 la cola es «sin tabla» (PGRST205)", async () => {
    const p = await almacenDeLaBase(conRpc({ data: null, error: { code: "42501", message: "Not allowed" } }).sb).juntar(1, 2);
    expect(p).toMatchObject({ ok: false, sinPermiso: true });
    const sinTabla = await almacenDeLaBase(clienteFalso([{ data: null, error: { code: "PGRST205", message: "no table" } }], { data: null, error: null }).sb).sugerencias();
    expect(sinTabla).toMatchObject({ ok: false, sinTabla: true });
  });
  it("guardar sin la 189 (ni la 193) aplicada: se repite sin contacts y luego sin company_id en lo que pide de vuelta", async () => {
    const llamadas: string[] = [];
    let n = 0;
    const cadena: Record<string, unknown> = {};
    Object.assign(cadena, {
      update: () => cadena, eq: () => cadena,
      select: (cols: string) => { llamadas.push(cols); return cadena; },
      maybeSingle: () => Promise.resolve(n++ < 5 ? { data: null, error: { code: "42703", message: "column customers.company_id does not exist" } } : { data: { id: 7, store: "BRO", account: "X" }, error: null }),
    });
    const r = await almacenDeLaBase({ from: () => cadena } as any).guardar(7, { notes: "x" });
    expect(r.ok).toBe(true);
    // D-683: primero sin rep_id (198); D-682: sin socials (197); D-672: sin las de la 195, luego sin contacts, y luego sin company_id.
    expect(llamadas).toHaveLength(6);
    expect(llamadas[0]).toContain("rep_id");
    expect(llamadas[1]).not.toContain("rep_id");
    expect(llamadas[1]).toContain("socials");
    expect(llamadas[2]).not.toContain("socials");
    expect(llamadas[2]).toContain("tax_terms");
    expect(llamadas[3]).not.toContain("tax_terms");
    expect(llamadas[3]).toContain("contacts");
    expect(llamadas[4]).toContain("company_id");
    expect(llamadas[4]).not.toContain("contacts");
    expect(llamadas[5]).not.toContain("company_id");
  });
});
