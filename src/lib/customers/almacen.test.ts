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
