import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TodasLasCotizaciones } from "@/app/estimator/TodasLasCotizaciones";
import { ordenaFilas, type ValorDeCelda } from "@/lib/orden-y-filtro";
import { useOrdenYFiltro } from "@/lib/use-orden-y-filtro";
import { almacenDeLaBase, resumenDeFila } from "./almacen";
import { almacenDeCompetenciaDeLaBase, type AlmacenDeCompetencia } from "./competencia";
import { almacenDeCompetenciaDemo, almacenDemo, DEMO_ESTIMADO_AJENO, DEMO_ESTIMADO_IMPRESO, DEMO_OTRO_VENDEDOR } from "./demo";
import {
  COLUMNAS_DE_LA_TABLA, ORDEN_INICIAL, alcanceDeLista, aplicaAlcance, columnasDeLaLista, enElAlcance, filtroVacio, piesCuadradosPedidos,
  puedeVerLista, subidoPorDelAlcance, tandaEnMemoria, valorDeColumna,
  type AlcanceDeLista, type Consulta, type CotizacionResumen,
} from "./lista-admin";

/**
 * D-NEXT. El dueño, 2026-10-06 (dictado): «quiero que en el Eats app el sort sea por square feet. Y quiero también, esa
 * misma, donde uno se mete para ver todas las órdenes que se han hecho, pero cada user también va a tener acceso a eso,
 * pero ese user solo va a poder ver las órdenes que él ha hecho.»
 *
 * Dos cosas: (1) la lista de cotizaciones de D-476/D-478 la ve todo el que tiene el módulo, pero el no-admin SOLO con las
 * suyas, pedidas así a la base; (2) una columna SF (pies cuadrados pedidos) y la lista nace ordenada por ella, de mayor a
 * menor.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const t = (en: string) => en;
const TODAS: AlcanceDeLista = { todas: true };
const MIAS = (dueno: string): AlcanceDeLista => ({ todas: false, dueno });

function cotizacion(p: Partial<CotizacionResumen> = {}): CotizacionResumen {
  return {
    id: "q1", estimate_num: "104582", owner_id: "u1", owner_name: "Ana Garza", store: "RDZ Pharr", customer_name: "Luis Pena",
    sf: 0, total: 100, print_count: 0, printed_at: null, created_at: "2026-10-05T20:30:00.000Z", updated_at: "2026-10-05T20:30:00.000Z", ...p,
  };
}

describe("quién ve qué en la lista (D-NEXT)", () => {
  it("el admin, todas; cualquier otro con sesión, solo las suyas; sin id, nada (nunca «todas» por olvido)", () => {
    expect(alcanceDeLista({ id: "a1", admin: true })).toEqual({ todas: true });
    expect(alcanceDeLista({ id: "u1", admin: false })).toEqual({ todas: false, dueno: "u1" });
    expect(alcanceDeLista({ id: "  ", admin: false })).toBeNull();
    expect(alcanceDeLista({ id: null, admin: false })).toBeNull();
    expect(alcanceDeLista(null)).toBeNull();
    expect(alcanceDeLista(undefined)).toBeNull();
  });
  it("la pestaña se ofrece al admin y a cualquier vendedor con sesión, ya no solo al admin", () => {
    expect(puedeVerLista({ id: "a1", admin: true })).toBe(true);
    expect(puedeVerLista({ id: "u1", admin: false })).toBe(true);
    expect(puedeVerLista({ id: "", admin: false })).toBe(false);
    expect(puedeVerLista(null)).toBe(false);
  });
  it("enElAlcance: las mías sí, las de otro (aunque sea de mi tienda) no; el admin todas", () => {
    expect(enElAlcance(cotizacion({ owner_id: "u1" }), MIAS("u1"))).toBe(true);
    expect(enElAlcance(cotizacion({ owner_id: "u2" }), MIAS("u1"))).toBe(false);
    expect(enElAlcance(cotizacion({ owner_id: null }), MIAS("u1"))).toBe(false);
    expect(enElAlcance(cotizacion({ owner_id: "u2" }), TODAS)).toBe(true);
  });
  it("en memoria, la tanda del vendedor solo trae las suyas", () => {
    const filas = [cotizacion({ id: "a", owner_id: "u1" }), cotizacion({ id: "b", owner_id: "u2" }), cotizacion({ id: "c", owner_id: "u1" })];
    expect(tandaEnMemoria(filas, filtroVacio(), 0, MIAS("u1")).filas.map((c) => c.id).sort()).toEqual(["a", "c"]);
    expect(tandaEnMemoria(filas, filtroVacio(), 0, TODAS).filas).toHaveLength(3);
  });
  it("a la base: el vendedor pide owner_id = su id; el admin no pone filtro de dueño", () => {
    const llamadas: string[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["eq", "gte", "lt", "or"]) q[m] = (...a: unknown[]) => { llamadas.push(`${m} ${a.join(" ")}`); return q; };
    aplicaAlcance(q as unknown as Consulta, MIAS("u1"));
    expect(llamadas).toEqual(["eq owner_id u1"]);
    llamadas.length = 0;
    aplicaAlcance(q as unknown as Consulta, TODAS);
    expect(llamadas).toEqual([]);
  });
  it("listarTodas de la base lleva el alcance EN LA CONSULTA, antes del orden y la tanda", async () => {
    const llamadas: string[] = [];
    const tabla: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "or", "order"]) tabla[m] = vi.fn((...a: unknown[]) => { llamadas.push(`${m} ${a.map(String).join(" ")}`); return tabla; });
    tabla.range = vi.fn(async () => ({ data: [], error: null }));
    const sb = { from: vi.fn(() => tabla) } as unknown as SupabaseClient;
    await almacenDeLaBase(sb).listarTodas(filtroVacio(), 0, MIAS("u-9"));
    expect(llamadas[1]).toBe("eq owner_id u-9");
    llamadas.length = 0;
    await almacenDeLaBase(sb).listarTodas(filtroVacio(), 0, TODAS);
    expect(llamadas.some((l) => l.startsWith("eq "))).toBe(false);
  });
  it("el demo: un vendedor de la tienda de otro (la 148 le dejaría leerla) NO la ve en «Mis cotizaciones»", async () => {
    const yo = { id: "u-otro", name: "Otro", admin: false, store: "Edinburg" as string | null };
    const a = almacenDemo(() => yo, false);
    const comoLa148 = await a.listarTodas(filtroVacio(), 0, TODAS);
    expect(comoLa148.ok && comoLa148.valor.filas.map((c) => c.estimate_num)).toEqual([DEMO_ESTIMADO_IMPRESO]);
    const mias = await a.listarTodas(filtroVacio(), 0, MIAS(yo.id));
    expect(mias.ok && mias.valor.filas).toEqual([]);
    // Y quien sí es dueño ve la suya.
    const sofia = almacenDemo(() => ({ id: DEMO_OTRO_VENDEDOR.id, name: DEMO_OTRO_VENDEDOR.name, admin: false, store: null }), false);
    const suyas = await sofia.listarTodas(filtroVacio(), 0, MIAS(DEMO_OTRO_VENDEDOR.id));
    expect(suyas.ok && suyas.valor.filas.map((c) => c.estimate_num)).toEqual([DEMO_ESTIMADO_AJENO]);
  });
  it("los estimados de la competencia: el vendedor solo los que él subió (en la consulta); el admin todos", async () => {
    expect(subidoPorDelAlcance(MIAS("u1"))).toBe("u1");
    expect(subidoPorDelAlcance(TODAS)).toBeNull();
    const llamadas: string[] = [];
    const tabla: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) tabla[m] = vi.fn((...a: unknown[]) => { llamadas.push(`${m} ${a.map(String).join(" ")}`); return tabla; });
    tabla.limit = vi.fn(async () => ({ data: [], error: null }));
    const sb = { from: vi.fn(() => tabla), storage: { from: vi.fn() } } as unknown as SupabaseClient;
    await almacenDeCompetenciaDeLaBase(sb).listarTodos("u1");
    expect(llamadas[1]).toBe("eq uploaded_by u1");
    llamadas.length = 0;
    await almacenDeCompetenciaDeLaBase(sb).listarTodos();
    expect(llamadas.some((l) => l.startsWith("eq "))).toBe(false);
  });
  it("el demo de la competencia filtra por quien lo subió igual que la base", async () => {
    let me = { id: "u1", name: "Ana", admin: false };
    const d = almacenDeCompetenciaDemo(() => me, false);
    const pdf = (n: string) => new File([new Uint8Array([37, 80, 68, 70])], n, { type: "application/pdf" });
    expect((await d.subir("q1", pdf("a.pdf"), { competitor: "", competitor_total: null, note: "" })).ok).toBe(true);
    me = { id: "u2", name: "Beto", admin: false };
    expect((await d.subir("q2", pdf("b.pdf"), { competitor: "", competitor_total: null, note: "" })).ok).toBe(true);
    const deU1 = await d.listarTodos("u1");
    expect(deU1.ok && deU1.valor.map((e) => e.file_name)).toEqual(["a.pdf"]);
    const todos = await d.listarTodos();
    expect(todos.ok && todos.valor).toHaveLength(2);
  });
  it("sin columna (ni filtro) de Vendedor para quien solo ve las suyas", () => {
    expect(columnasDeLaLista(MIAS("u1")).map((c) => c.key)).toEqual(["fecha", "estimado", "tienda", "cliente", "sf", "total", "estado"]);
    expect(columnasDeLaLista(TODAS)).toBe(COLUMNAS_DE_LA_TABLA);
  });
});

describe("pies cuadrados (D-NEXT, «el sort sea por square feet»)", () => {
  it("suma requested_sf de las líneas por SF; las de unidad, las vacías y las no positivas no suman", () => {
    expect(piesCuadradosPedidos([
      { kind: "sf", requested_sf: 400 },
      { kind: "sf", requested_sf: 1250.5 },
      { kind: "unit", requested_sf: 999 },
      { kind: "sf", requested_sf: null },
      { kind: "sf", requested_sf: -10 },
      { kind: "sf", requested_sf: Number.NaN },
      { kind: "sf" },
    ])).toBe(1650.5);
    expect(piesCuadradosPedidos([])).toBe(0);
    expect(piesCuadradosPedidos([{ kind: "sf", requested_sf: 0.1 }, { kind: "sf", requested_sf: 0.2 }])).toBe(0.3);
  });
  it("la fila de la base y la del demo traen su SF", async () => {
    const fila = {
      id: "q1", estimate_num: "E-1", customer: {}, created_at: "2026-10-05T09:00:00Z",
      lines: [{ kind: "sf", id: "a", requested_sf: 300 }, { kind: "sf", id: "b", requested_sf: 200 }, { kind: "unit", id: "c", unit_price: 100, quantity: 1 }],
    };
    expect(resumenDeFila(fila).sf).toBe(500);
    const r = await almacenDemo(() => ({ id: "u-admin", name: "Admin", admin: true, store: null }), false).listarTodas(filtroVacio(), 0, TODAS);
    const sf = r.ok ? Object.fromEntries(r.valor.filas.map((c) => [c.estimate_num, c.sf])) : {};
    expect(sf).toEqual({ [DEMO_ESTIMADO_AJENO]: 400, [DEMO_ESTIMADO_IMPRESO]: 1250 });
  });
  it("la columna SF ordena como número", () => {
    expect(valorDeColumna("sf", cotizacion({ sf: 1250 }), t)).toBe(1250);
    expect(COLUMNAS_DE_LA_TABLA.find((c) => c.key === "sf")).toEqual({ key: "sf", en: "SF", es: "Pies²" });
  });
  it("la lista nace ordenada por SF, de mayor a menor", () => {
    expect(ORDEN_INICIAL).toEqual({ clave: "sf", direccion: "desc" });
    const filas = [cotizacion({ id: "chica", sf: 120 }), cotizacion({ id: "grande", sf: 2500 }), cotizacion({ id: "media", sf: 980 })];
    const orden = ordenaFilas(filas, (c) => valorDeColumna(ORDEN_INICIAL.clave, c, t), ORDEN_INICIAL.direccion);
    expect(orden.map((c) => c.id)).toEqual(["grande", "media", "chica"]);
  });
  it("useOrdenYFiltro respeta el orden inicial (y sin él, nace sin orden)", () => {
    const filas = [{ n: 1 }, { n: 3 }, { n: 2 }];
    const valor = (_c: string, f: { n: number }): ValorDeCelda => f.n;
    function Lista({ inicial }: { inicial?: { clave: string; direccion: "asc" | "desc" } }) {
      const o = useOrdenYFiltro(filas, valor, inicial);
      return createElement("p", null, `${o.claveDeOrden ?? "-"}:${o.direccion ?? "-"}:${o.visibles.map((f) => f.n).join(",")}`);
    }
    expect(renderToStaticMarkup(createElement(Lista, { inicial: { clave: "n", direccion: "desc" } }))).toBe("<p>n:desc:3,2,1</p>");
    expect(renderToStaticMarkup(createElement(Lista, {}))).toBe("<p>-:-:1,3,2</p>");
  });
});

describe("la pantalla", () => {
  const almacen = almacenDemo(() => ({ id: "u1", name: "Ana", admin: false }), false);
  const competencia = {} as AlmacenDeCompetencia;
  const pinta = (me: { id: string; name: string; admin: boolean }) =>
    renderToStaticMarkup(createElement(TodasLasCotizaciones, { almacen, competencia, me, t, lang: "en", onAbrir: () => {} }));
  it("el título: «All quotes» al admin, «My quotes» a los demás; sin sesión, nada", () => {
    const admin = pinta({ id: "a1", name: "Admin", admin: true });
    expect(admin).toContain('data-todas-titulo="todas"');
    expect(admin).toContain("All quotes");
    expect(admin).toContain("All competitor estimates");
    const vendedor = pinta({ id: "u1", name: "Ana", admin: false });
    expect(vendedor).toContain('data-todas-titulo="mias"');
    expect(vendedor).toContain("My quotes");
    expect(vendedor).not.toContain("All quotes");
    expect(vendedor).toContain("Competitor estimates you uploaded");
    expect(pinta({ id: "", name: "", admin: false })).toBe("");
  });
  const pestana = leer("src/app/estimator/TodasLasCotizaciones.tsx");
  const pantalla = leer("src/app/estimator/Estimador.tsx");
  it("la pestaña usa el alcance, las columnas del alcance, el orden inicial y pinta SF; Vendedor solo con todas", () => {
    expect(pestana).toContain("const alcance = useMemo(() => alcanceDeLista(me), [me]);");
    expect(pestana).toContain("const r = await almacen.listarTodas(f, n, alcance);");
    expect(pestana).toContain("const e = await competencia.listarTodos(subidoPorDelAlcance(alcance));");
    expect(pestana).toContain("(alcance ? columnasDeLaLista(alcance) : []).map((c) => (");
    expect(pestana).toContain("const orden = useOrdenYFiltro(filas, valorDe, ORDEN_INICIAL);");
    expect(pestana).toContain("{todas && <td data-cotizacion-vendedor>");
    expect(pestana).toContain('<td style={{ textAlign: "right" }} data-cotizacion-sf>{c.sf > 0 ? numero(c.sf, 2) : "—"}</td>');
  });
  it("la pestaña del Estimador se ofrece con puedeVerLista, con su nombre por rol, y se monta de nuevo al cambiar de persona", () => {
    expect(pantalla).toContain("{puedeVerLista(me) && (");
    expect(pantalla).toContain('📚 {puedeVerTodas(me) ? t("All quotes (admin)", "Todas las cotizaciones (admin)") : t("My quotes", "Mis cotizaciones")}');
    expect(pantalla).toContain("<TodasLasCotizaciones key={puedeVerTodas(me) ? \"todas\" : `mias-${me.id}`}");
  });
});
