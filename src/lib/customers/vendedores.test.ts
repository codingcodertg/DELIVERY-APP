import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { FichaEnVentana } from "@/app/customers/FichaDeCliente";
import { almacenDeLaBase, COLUMNAS, COLUMNAS_DE_LA_198, COLUMNAS_SIN_198, leeConRespaldo } from "./almacen";
import { almacenDemo, CLIENTES_DEMO, VENDEDORES_DEMO } from "./demo";
import { filasDeLaEmpresa } from "./empresas";
import { CAMPOS, celda, clienteDeLaBase, COLUMNAS as COLUMNAS_DE_LA_LISTA, COLUMNAS_INICIALES, puedeEditar, textoDeCampo, valorDeColumna, type Cliente } from "./reglas";
import { conVendedores, nombresDeVendedores, vendedoresEnOrden } from "./vendedores";

/* D-NEXT (198). El dueño, 2026-10-25: «the customer app has a sales rep assigned to each customer. Right now, they just
 * have initials […] they will only be able to see their own source customers and the customer assigned to them, and the
 * free ones […] in edit, and when they're creating, you assign a sales rep, and also for the ones empty». */
const t = (_en: string, es: string) => es;
const leer = (p: string) => readFileSync(p, "utf8");

describe("el vendedor en el modelo", () => {
  const nombres = nombresDeVendedores(VENDEDORES_DEMO);
  it("`rep_id` es columna de la lista, campo de la tarjeta «Cuenta» (desplegable), y entra en las columnas de entrada", () => {
    expect(COLUMNAS_DE_LA_LISTA.find((c) => c.key === "rep_id")).toEqual({ key: "rep_id", en: "Sales rep", es: "Vendedor" });
    expect(CAMPOS.find((c) => c.key === "rep_id")).toMatchObject({ tipo: "vendedor", grupo: "cuenta" });
    expect(COLUMNAS_INICIALES.indexOf("rep_id")).toBeGreaterThan(-1);
    expect(COLUMNAS_INICIALES.indexOf("rep_id")).toBeLessThan(COLUMNAS_INICIALES.indexOf("rep_store"));
  });
  it("la fila de la base: `rep_id` llega (null sin la 198) y `rep_name` lo pone `conVendedores`; sin perfil conocido, el id", () => {
    expect(clienteDeLaBase({ id: 1, store: "MCA", account: "A", rep_id: "demo-ana" }).rep_id).toBe("demo-ana");
    expect(clienteDeLaBase({ id: 1, store: "MCA", account: "A" }).rep_id).toBeNull();
    const [a, b, c] = conVendedores([{ rep_id: "demo-ana" }, { rep_id: null }, { rep_id: "quien" }], nombres);
    expect([a.rep_name, b.rep_name, c.rep_name]).toEqual(["Ana Demo", null, "quien"]);
  });
  it("en la lista y en la ficha sale el NOMBRE, no el id; sin vendedor, «—»; y se ordena/busca por el nombre", () => {
    const c = { ...CLIENTES_DEMO[0], rep_id: "demo-ana", rep_name: "Ana Demo" };
    expect(celda(c, "rep_id", t)).toBe("Ana Demo");
    expect(valorDeColumna(c, "rep_id")).toBe("Ana Demo");
    expect(textoDeCampo(c, CAMPOS.find((x) => x.key === "rep_id")!, t)).toBe("Ana Demo");
    expect(celda({ ...c, rep_id: null, rep_name: null }, "rep_id", t)).toBe("—");
    expect(vendedoresEnOrden([{ id: "b", full_name: "beto" }, { id: "a", full_name: "Ana" }]).map((v) => v.id)).toEqual(["a", "b"]);
  });
  it("el vendedor del hub también edita (espejo de la customers_can_write de la 198)", () => {
    expect(puedeEditar("sales")).toBe(true);
    expect(puedeEditar("admin")).toBe(true);
    for (const r of ["warehouse", "driver", "logistics", "accounting"] as const) expect(puedeEditar(r), r).toBe(false);
  });
});

describe("la migración 198", () => {
  const sql = leer("supabase/migrations/198_clientes_vendedor.sql");
  const [cuerpo] = sql.split("-- @ledger-below");
  it("es la ÚLTIMA que define customers_can_write, y deja escribir al vendedor con la casilla", () => {
    const definen = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => leer(`supabase/migrations/${f}`).includes("create or replace function erp.customers_can_write()"));
    expect(definen[definen.length - 1]).toBe("198_clientes_vendedor.sql");
    expect(cuerpo).toContain("select (role = 'admin' or (role in ('manager', 'sales') and 'customers' = any(coalesce(module_access, '{}'))))");
  });
  it("la columna, y una política RESTRICTIVA que suma a la puerta del módulo: el que no es vendedor ve todo; el vendedor, las libres, las suyas y las que creó", () => {
    expect(cuerpo).toContain("alter table erp.customers add column if not exists rep_id uuid references public.profiles(id) on delete set null;");
    expect(cuerpo).toContain("select coalesce((select role <> 'sales' from public.profiles where id = auth.uid()), false)\n      or p_rep is null\n      or p_rep = auth.uid()\n      or p_creador = auth.uid();");
    expect(cuerpo).toContain('create policy "customers solo los suyos (vendedor)" on erp.customers as restrictive for all to authenticated\n  using ((select erp.customers_ve_la_fila(rep_id, created_by))) with check (true);');
    expect(cuerpo).not.toMatch(/\bbegin;|\bcommit;/);
  });
  it("el código llega antes que la migración: sin `rep_id`, se vuelve a leer sin ella", async () => {
    for (const col of COLUMNAS_DE_LA_198) { expect(COLUMNAS).toContain(col); expect(COLUMNAS_SIN_198).not.toContain(col); }
    expect(COLUMNAS_SIN_198).toContain("socials");
    const pedidas: string[] = [];
    const r = await leeConRespaldo(async (cols) => { pedidas.push(cols); return pedidas.length === 1 ? { data: null, error: { code: "42703", message: "column customers.rep_id does not exist" } } : { data: [{ id: 6 }], error: null }; });
    expect(pedidas).toEqual([COLUMNAS, COLUMNAS_SIN_198]);
    expect(r.data).toEqual([{ id: 6 }]);
  });
  it("ya no es «solo admins» (D-570): entra quien tiene la casilla, y la casilla se ofrece a todos", async () => {
    const { CLIENTES_SOLO_ADMINS, puedeEntrarAClientes, seOfreceClientes } = await import("./reglas");
    expect(CLIENTES_SOLO_ADMINS).toBe(false);
    expect(puedeEntrarAClientes({ role: "sales", module_access: ["customers"] })).toBe(true);
    expect(puedeEntrarAClientes({ role: "sales", module_access: ["leads"] })).toBe(false);
    expect(puedeEntrarAClientes({ role: "admin", module_access: [] })).toBe(true);
    expect(seOfreceClientes("sales")).toBe(true);
  });
});

describe("el almacén", () => {
  it("`vendedores()`: los perfiles con rol de vendedor, por nombre; y la lista llega con `rep_name`", async () => {
    const llamadas: { tipo: string; args: unknown[] }[] = [];
    const cadena: Record<string, unknown> = {};
    const metodo = (tipo: string) => (...args: unknown[]) => { llamadas.push({ tipo, args }); return cadena; };
    Object.assign(cadena, {
      from: metodo("from"), select: metodo("select"), eq: metodo("eq"), order: metodo("order"),
      range: () => Promise.resolve({ data: [{ id: 1, store: "MCA", account: "A", rep_id: "u-ana" }], error: null }),
      then: (ok: (v: unknown) => void) => ok({ data: [{ id: "u-ana", full_name: "Ana" }], error: null }),
    });
    const sb = { from: metodo("from"), schema: metodo("schema") } as any;
    const v = await almacenDeLaBase(sb).vendedores();
    expect(v.ok && v.valor).toEqual([{ id: "u-ana", full_name: "Ana" }]);
    expect(llamadas.find((l) => l.tipo === "schema")?.args).toEqual(["public"]);
    expect(llamadas.find((l) => l.tipo === "from")?.args).toEqual(["profiles"]);
    expect(llamadas.find((l) => l.tipo === "eq")?.args).toEqual(["role", "sales"]);
    const lista = await almacenDeLaBase(sb).leer();
    expect(lista.ok && lista.valor[0]).toMatchObject({ rep_id: "u-ana", rep_name: "Ana" });
  });
  it("el demo tiene vendedores y su lista lleva los nombres", async () => {
    const v = await almacenDemo().vendedores();
    expect(v.ok && v.valor.map((x) => x.full_name)).toEqual(VENDEDORES_DEMO.map((x) => x.full_name));
    const l = await almacenDemo().leer();
    expect(l.ok && l.valor.some((c) => c.rep_name)).toBe(true);
  });
});

describe("la ficha", () => {
  const pinta = (c: Cliente | null, editarAlAbrir = false) => renderToStaticMarkup(createElement(FichaEnVentana, {
    cliente: c, hermanas: c ? filasDeLaEmpresa(CLIENTES_DEMO, c) : [], lista: CLIENTES_DEMO,
    onCambia: () => {}, onClose: () => {}, onGuardado: () => {}, puedeEditar: true, almacen: almacenDemo(), editarAlAbrir, t,
  }));
  const tarjeta = (html: string, g: string) => { const i = html.indexOf(`data-grupo="${g}"`); const j = html.indexOf("data-grupo=", i + 1); return html.slice(i, j < 0 ? undefined : j); };
  const conVendedor = { ...CLIENTES_DEMO[0], rep_id: "demo-ana", rep_name: "Ana Demo" };
  it("leyendo, el nombre del vendedor en «Cuenta»; sin vendedor, «—»", () => {
    expect(tarjeta(pinta(conVendedor), "cuenta")).toMatch(/data-campo="rep_id"><span[^>]*>Vendedor<\/span><span[^>]*>Ana Demo<\/span>/);
    expect(tarjeta(pinta({ ...conVendedor, rep_id: null, rep_name: null }), "cuenta")).toMatch(/data-campo="rep_id"><span[^>]*>Vendedor<\/span><span[^>]*>—<\/span>/);
  });
  it("editando y en un alta, un desplegable con los vendedores (los carga del almacén) y «—» para dejarlo libre", () => {
    const cuenta = tarjeta(pinta(conVendedor, true), "cuenta");
    expect(cuenta).toMatch(/<select[^>]*data-vendedor="true"[^>]*>/);
    expect(cuenta).toContain('<option value="">—</option>');
    const alta = tarjeta(pinta(null), "cuenta");
    expect(alta).toMatch(/<select[^>]*data-vendedor="true"[^>]*>/);
    // Los vendedores llegan en un efecto (useEffect): el HTML estático trae el desplegable vacío; la puerta fija la carga.
    const ficha = leer("src/app/customers/FichaDeCliente.tsx");
    expect(ficha).toContain("almacen.vendedores().then((r) => { if (!cancelado && r.ok) setVendedores(vendedoresEnOrden(r.valor)); });");
    expect(ficha).toContain('{vendedores.map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}');
  });
});
