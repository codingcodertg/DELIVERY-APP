import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clienteDeBusqueda, columnasDelVendedor, COLUMNAS_DEL_VENDEDOR, conLosEncontrados, puedeAbrirCliente, seBuscaEnTodaLaEmpresa,
} from "./vendedor-por-tienda";
import { COLUMNAS, CAMPOS, clienteDeLaBase, type Cliente } from "./reglas";
import { COLUMNAS as COLUMNAS_DE_LA_BASE } from "./almacen";

/** El vendedor en Clientes: cuatro columnas, abre solo los suyos, busca en toda la empresa, y al crear es él (D-740, 215). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("las columnas del vendedor", () => {
  it("cuenta, N.º tiendas, estado (tienda) y vendedor, en el orden canónico, y nada más", () => {
    expect(columnasDelVendedor().map((c) => c.key)).toEqual(["account", "store_count", "status_store", "rep_id", "rep_store"]); // D-797: + Vendedor (QB)
    expect(COLUMNAS_DEL_VENDEDOR.every((k) => COLUMNAS.some((c) => c.key === k))).toBe(true);
  });
  it("D-786: rep_store es «Sales rep (QB)» y rep_id «Commission rep» en la tabla y en la ficha (D-740 lo llamaba «Commission rep (QB)»)", () => {
    expect(COLUMNAS.find((c) => c.key === "rep_store")).toMatchObject({ en: "Sales rep (QB)", es: "Vendedor (QB)" });
    expect(CAMPOS.find((c) => c.key === "rep_store")).toMatchObject({ en: "Sales rep (QB)", es: "Vendedor (QB)" });
    expect(CAMPOS.find((c) => c.key === "rep_id")).toMatchObject({ en: "Commission rep", es: "Vendedor de comisión", grupo: "cuenta" });
    expect(CAMPOS.filter((c) => c.grupo === "cuenta").map((c) => c.key)).toEqual(["unified_account", "rep_id", "rep_store", "rep_qb", "rep_history"]); // D-791: los de grupo vuelven
    expect(CAMPOS.find((c) => c.key === "rep_qb")).toMatchObject({ grupo: "cuenta" }); // D-791: de vuelta en «Cuenta»
    expect(CAMPOS.find((c) => c.key === "rep_history")).toMatchObject({ grupo: "cuenta" });
    expect(CAMPOS.find((c) => c.key === "address")).toMatchObject({ grupo: "contacto" });
  });
});

describe("quién abre qué", () => {
  const mio = { rep_id: "yo", created_by: "otro" };
  const creado = { rep_id: "otro", created_by: "yo" };
  const ajeno = { rep_id: "otro", created_by: "otro" };
  const libre = { rep_id: null, created_by: null };
  it("el vendedor: los suyos (asignado o creado por él); los demás no, ni los libres", () => {
    const yo = { esVendedor: true, userId: "yo" };
    expect(puedeAbrirCliente(mio, yo)).toBe(true);
    expect(puedeAbrirCliente(creado, yo)).toBe(true);
    expect(puedeAbrirCliente(ajeno, yo)).toBe(false);
    expect(puedeAbrirCliente(libre, yo)).toBe(false);
  });
  it("quien no es vendedor abre todo", () => {
    for (const c of [mio, creado, ajeno, libre]) expect(puedeAbrirCliente(c, { esVendedor: false, userId: "yo" })).toBe(true);
  });
  it("`created_by` viene de la base: está en las columnas que se leen y en la fila", () => {
    expect(COLUMNAS_DE_LA_BASE.split(",").map((s) => s.trim())).toContain("created_by");
    expect(clienteDeLaBase({ id: 1, store: "PHR", account: "A", created_by: "yo" }).created_by).toBe("yo");
    expect(clienteDeLaBase({ id: 1, store: "PHR", account: "A" }).created_by).toBeNull();
  });
});

describe("la búsqueda en toda la empresa", () => {
  it("solo el vendedor, y con dos letras o más", () => {
    expect(seBuscaEnTodaLaEmpresa("ab", true)).toBe(true);
    expect(seBuscaEnTodaLaEmpresa(" a ", true)).toBe(false);
    expect(seBuscaEnTodaLaEmpresa("abc", false)).toBe(false);
  });
  it("una fila de la búsqueda es un Cliente con lo demás vacío", () => {
    const c = clienteDeBusqueda({ id: 7, store: "BRO", account: "Acme", unified_account: "ACME", status_store: "NEW", rep_id: "v1", company_id: "e1", archived_at: null });
    expect(c).toMatchObject({ id: 7, store: "BRO", account: "Acme", status_store: "NEW", rep_id: "v1", company_id: "e1", phone: null, email: null, address: null, created_by: null });
  });
  it("lo encontrado se suma a la lista sin repetir lo que ya estaba", () => {
    const a = clienteDeBusqueda({ id: 1, store: "PHR", account: "A" });
    const b = clienteDeBusqueda({ id: 2, store: "BRO", account: "B" });
    expect(conLosEncontrados([a], [a, b]).map((c) => c.id)).toEqual([1, 2]);
    expect(conLosEncontrados([a], [])).toEqual([a]);
  });
  it("la 215: el vendedor lee su tienda además de los suyos, y la búsqueda es security definer con pocas columnas", () => {
    const sql = leer("supabase/migrations/215_clientes_vendedor_su_tienda_y_busqueda.sql");
    expect(sql).toContain("when p.role = 'sales' then (");
    expect(sql).toContain("or upper(btrim(coalesce(p_store, ''))) = erp.customers_codigo_de_tienda(p.store)");
    expect(sql).toContain("create or replace function erp.busca_clientes_en_toda_la_empresa(p_q text)");
    expect(sql).toContain("returns table (id bigint, store text, account text, unified_account text, status_store text, rep_id uuid, company_id uuid, archived_at timestamptz)");
    expect(sql).not.toMatch(/returns table \([^)]*(phone|email|address)/);
    expect(sql).toContain("length(btrim(coalesce(p_q, ''))) >= 2");
    expect(sql).toContain("grant execute on function erp.busca_clientes_en_toda_la_empresa(text) to authenticated;");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
  });
});

describe("la pantalla", () => {
  const lista = sinComentarios(leer("src/app/customers/Clientes.tsx"));
  const ficha = sinComentarios(leer("src/app/customers/FichaDeCliente.tsx"));
  it("sin selector de columnas ni arrastre para el vendedor; sus cuatro columnas", () => {
    // D-748: la vista acotada es la de todos menos el admin.
    expect(lista).toContain("const vistaAcotada = !esAdmin;");
    expect(lista).toContain("{!vistaAcotada && (\n          <SelectorDeColumnas");
    expect(lista).toContain("draggable={!vistaAcotada}");
    expect(lista).toContain("const colsVisibles = vistaAcotada ? columnasDelVendedor() : columnasAPintar(prefCols);");
  });
  it("la fila que no es suya no abre la ficha, y lo dice", () => {
    expect(lista).toContain("const abrible = puedeAbrirCliente(c, { esVendedor, userId });");
    expect(lista).toContain("onClick={() => { if (abrible) setFicha({ tipo: \"ver\", cliente: c }); }}");
    expect(lista).toContain('data-no-se-abre={abrible ? undefined : "1"}');
  });
  it("la búsqueda pregunta a toda la empresa con retardo y suma lo encontrado", () => {
    expect(lista).toContain("seBuscaEnTodaLaEmpresa(filtro.busca, vistaAcotada)");
    expect(lista).toContain("almacen.buscarEnTodaLaEmpresa(");
    expect(lista).toContain("conLosEncontrados(lista, encontrados)");
    expect(lista).toContain("RETARDO_DE_BUSQUEDA_MS");
  });
  it("en el alta, el vendedor es él, puesto de antemano y bloqueado", () => {
    expect(ficha).toContain("const preajuste = useMemo<Record<string, string>>(() => ({ ...(nuevo && esVendedor && yo ? { rep_id: yo } : {}), ...(tiendaPre ? { store: tiendaPre } : {}) }), [nuevo, esVendedor, yo, tiendaPre]);");
    expect(ficha).toContain("useEffect(() => { setForm({ ...original, ...preajuste }); }, [original, preajuste]);");
    expect(ficha).toContain("bloqueado={esVendedor || puedePedirVendedor}");
    expect(ficha).toContain("<select className={cn(selCls, \"w-full\")} value={valor} onChange={(e) => onCambia(e.target.value)} data-vendedor disabled={bloqueado}>");
    expect(lista).toContain("yo={userId}");
  });
  it("el almacén de la base llama a la función de la 215 y el demo busca en su lista", () => {
    const almacen = sinComentarios(leer("src/lib/customers/almacen.ts"));
    expect(almacen).toContain('sb.rpc("busca_clientes_en_toda_la_empresa", { p_q: q })');
    expect(sinComentarios(leer("src/lib/customers/demo.ts"))).toContain("async buscarEnTodaLaEmpresa(q)");
  });
});

// Un `Cliente` completo de mentira, por si alguien quiere sumar casos arriba sin construirlo a mano.
export const CLIENTE_DE_PRUEBA: Cliente = clienteDeBusqueda({ id: 1, store: "PHR", account: "A" });
