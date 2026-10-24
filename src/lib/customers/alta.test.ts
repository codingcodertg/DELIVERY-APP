import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { avisoDeNoCreadas, creaUnaPorUna, filaQueSeEnsena, filasDelAlta, tiendasDelAlta, TODAS, type ResultadoDelAlta } from "./alta";
import { almacenDeLaBase, type Res } from "./almacen";
import { almacenDemoNuevo, CLIENTES_DEMO } from "./demo";
import { agrupaEnEmpresas } from "./empresas";
import { clienteDeLaBase, nombreDeTienda, TIENDAS, type Cliente, type Parche } from "./reglas";

/**
 * D-NEXT (2026-10-23). El dueño, con el desplegable «Store *» del alta abierto: «here add selection box so it can select
 * multiple stores or all». Una fila por tienda marcada, mismos datos, MISMA empresa nueva; la que choca no se crea y se
 * dice cuál. Las tiendas, por referencia a `TIENDAS` (no escritas a mano).
 */
const t = (_en: string, es: string) => es;
const codigos = TIENDAS.map((x) => x.code);
// Marcadas en DESORDEN y con una repetida y en minúsculas: el orden lo da `TIENDAS`, no el clic.
const [primera, segunda, tercera] = codigos;
const marcadas = [tercera.toLowerCase(), primera, tercera];
const datos: Parche = { account: "ALTA DEMO", phone: "(555) 010-9", credit_limit: 500, notes: "x" };

describe("filasDelAlta: una fila por tienda marcada", () => {
  it("una por tienda, en el orden de TIENDAS, sin repetir; cada una con TODOS los datos, su tienda y el mismo company_id", () => {
    const filas = filasDelAlta(datos, marcadas, "emp-1");
    expect(filas.map((f) => f.store)).toEqual([primera, tercera]);
    for (const f of filas) expect(f).toEqual({ ...datos, store: f.store, company_id: "emp-1" });
  });
  it("«Todas» son todas las de TIENDAS", () => {
    expect(filasDelAlta(datos, TODAS, "e").map((f) => f.store)).toEqual(codigos);
    expect(tiendasDelAlta(TODAS)).toEqual(codigos);
  });
  it("la tienda del parche no gana a la marcada, ni el company_id que trajera", () => {
    const filas = filasDelAlta({ ...datos, store: segunda, company_id: "viejo" } as Parche, [primera], "nuevo");
    expect(filas).toEqual([{ ...datos, store: primera, company_id: "nuevo" }]);
  });
  it("sin ninguna marcada no hay filas; un código desconocido va al final, tal cual", () => {
    expect(filasDelAlta(datos, [], "e")).toEqual([]);
    expect(tiendasDelAlta(["zzz", segunda, " "])).toEqual([segunda, "ZZZ"]);
  });
});

const cliente = (id: number, store: string): Cliente => clienteDeLaBase({ id, store, account: "ALTA DEMO" });
const dup: Res<never> = { ok: false, sinTabla: false, sinPermiso: false, duplicado: true, error: "dup" };

describe("creaUnaPorUna: la que choca no tumba a las demás", () => {
  it("crea las que puede y dice cuál chocó", async () => {
    let id = 0;
    const r = await creaUnaPorUna(filasDelAlta(datos, [primera, segunda, tercera], "e"), async (f) => (f.store === segunda ? dup : { ok: true, valor: cliente(++id, String(f.store)) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.creados.map((c) => c.store)).toEqual([primera, tercera]);
    expect(r.valor.noCreadas).toEqual([{ store: segunda, duplicado: true, error: "dup" }]);
    expect(avisoDeNoCreadas(r.valor, t)).toBe(`Ya existía en ${nombreDeTienda(segunda)}: no se creó ahí.`);
  });
  it("si chocan todas, el fallo de siempre (duplicado)", async () => {
    const r = await creaUnaPorUna(filasDelAlta(datos, [primera, segunda], "e"), async () => dup);
    expect(r).toMatchObject({ ok: false, duplicado: true });
  });
  it("todas creadas: sin aviso", () => {
    expect(avisoDeNoCreadas({ creados: [cliente(1, primera)], noCreadas: [] }, t)).toBe("");
  });
});

describe("filaQueSeEnsena: la de la primera tienda marcada que se creó", () => {
  const r: ResultadoDelAlta = { creados: [cliente(8, tercera), cliente(9, segunda)], noCreadas: [{ store: primera, duplicado: true, error: "dup" }] };
  it("en el orden de las marcadas, no en el de la respuesta; si la primera chocó, la siguiente", () => {
    expect(filaQueSeEnsena(r, [segunda, tercera])?.id).toBe(9);
    expect(filaQueSeEnsena(r, [primera, tercera, segunda])?.id).toBe(8);
  });
});

/** Un cliente de Supabase falso para el insert de varias filas: cola de respuestas, una por llamada. */
function clienteFalso(respuestas: { data: unknown; error: { code?: string; message: string } | null }[]) {
  const inserts: unknown[] = [];
  let i = 0;
  const siguiente = () => Promise.resolve(respuestas[i++] ?? { data: null, error: { message: "no more" } });
  const sb = {
    from: () => ({
      insert: (v: unknown) => {
        inserts.push(v);
        const sel = { maybeSingle: siguiente, then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => siguiente().then(ok, ko) };
        return { select: () => sel };
      },
    }),
  } as any;
  return { sb, inserts };
}

describe("crearVarias en la base", () => {
  const filas = filasDelAlta(datos, [primera, segunda, tercera], "emp");
  it("UNA llamada con todas las filas; devuelve lo creado", async () => {
    const { sb, inserts } = clienteFalso([{ data: filas.map((f, n) => ({ id: n + 1, ...f })), error: null }]);
    const r = await almacenDeLaBase(sb).crearVarias(filas);
    expect(inserts).toEqual([filas]);
    expect(r.ok && r.valor.creados.map((c) => [c.store, c.company_id])).toEqual(filas.map((f) => [f.store, "emp"]));
    expect(r.ok && r.valor.noCreadas).toEqual([]);
  });
  it("si choca (23505), no se escribió nada: se repite una por una, y la que choca se dice", async () => {
    const { sb, inserts } = clienteFalso([
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { id: 1, ...filas[0] }, error: null },
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { id: 3, ...filas[2] }, error: null },
    ]);
    const r = await almacenDeLaBase(sb).crearVarias(filas);
    expect(inserts).toEqual([filas, filas[0], filas[1], filas[2]]);
    expect(r.ok && r.valor.creados.map((c) => c.store)).toEqual([primera, tercera]);
    expect(r.ok && r.valor.noCreadas).toEqual([{ store: segunda, duplicado: true, error: "duplicate key" }]);
  });
  it("otro error (RLS) no se reintenta: el fallo de siempre", async () => {
    const { sb, inserts } = clienteFalso([{ data: null, error: { code: "42501", message: "row-level security" } }]);
    expect(await almacenDeLaBase(sb).crearVarias(filas)).toMatchObject({ ok: false, sinPermiso: true });
    expect(inserts).toHaveLength(1);
  });
  it("cero filas de vuelta no es «creado»", async () => {
    const { sb } = clienteFalso([{ data: [], error: null }]);
    expect(await almacenDeLaBase(sb).crearVarias(filas)).toMatchObject({ ok: false, sinPermiso: true });
  });
});

describe("crearVarias en el demo", () => {
  it("crea una empresa con sus tiendas: la lista la agrupa en UNA, con todas sus pastillas", async () => {
    const a = almacenDemoNuevo();
    const r = await a.crearVarias(filasDelAlta(datos, TODAS, "demo-nueva"));
    expect(r.ok && r.valor.creados.length).toBe(TIENDAS.length);
    const l = await a.leer();
    const empresas = l.ok ? agrupaEnEmpresas(l.valor, { busca: "", tienda: "", estado: "", qb: "", archivados: false }).filter((e) => e.filas.some((f) => f.account === "ALTA DEMO")) : [];
    expect(empresas).toHaveLength(1);
    expect(empresas[0].filas.map((f) => f.store).sort()).toEqual([...codigos].sort());
  });
  it("la cuenta que ya existe en una tienda (sin mayúsculas ni espacios) choca ahí y las demás se crean", async () => {
    const a = almacenDemoNuevo();
    const existente = CLIENTES_DEMO.find((c) => !c.archived_at)!;
    const otra = codigos.find((c) => c !== existente.store)!;
    const r = await a.crearVarias(filasDelAlta({ account: ` ${existente.account.toLowerCase()} ` }, [existente.store, otra], "x"));
    expect(r.ok && r.valor.creados.map((c) => c.store)).toEqual([otra]);
    expect(r.ok && r.valor.noCreadas.map((c) => [c.store, c.duplicado])).toEqual([[existente.store, true]]);
  });
});

describe("la ventana: el alta va por crearVarias", () => {
  // El clic se midió en el navegador (demo, 390 y 1440 px); aquí se fija el cable, que un render estático no pulsa.
  const ventana = readFileSync("src/app/customers/FichaDeCliente.tsx", "utf8");
  const lista = readFileSync("src/app/customers/Clientes.tsx", "utf8");
  it("con las tiendas marcadas y una empresa NUEVA; ya no por crear(); y la lista recibe TODAS las creadas", () => {
    expect(ventana).toContain("almacen.crearVarias(filasDelAlta(parche, tiendasAlta, crypto.randomUUID()))");
    expect(ventana).not.toContain("almacen.crear(");
    expect(ventana).toContain("onGuardado(ver, r.valor.creados)");
    expect(lista).toContain("const nuevas = [c, ...creados.filter((x) => x.id !== c.id)];");
  });
});
