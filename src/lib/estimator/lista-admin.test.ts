import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TablaDeCotizaciones } from "@/app/estimator/TodasLasCotizaciones";
import { ListaDeEstimados } from "@/app/estimator/EstimadosCompetencia";
import { COLUMNAS_DE_LA_LISTA, almacenDeLaBase, resumenDeFila } from "./almacen";
import { almacenDemo, DEMO_ESTIMADO_AJENO, DEMO_ESTIMADO_IMPRESO, DEMO_OTRO_VENDEDOR } from "./demo";
import {
  TANDA, aplicaFiltro, cortaTanda, cumpleFiltro, estadoDeCotizacion, filtroDeTextoPostgrest, filtroVacio, hayFiltro, limitesDeFechas,
  masRecientePrimero, puedeVerTodas, rangoDeTanda, tandaEnMemoria, textoCoincide, tiendasDelFiltro,
  type Consulta, type CotizacionResumen, type FiltroDeCotizaciones,
} from "./lista-admin";
import { borradorVacio } from "./modelo";

/**
 * D-NEXT: la lista de TODAS las cotizaciones y de todos los estimados de la competencia, solo para el admin. El dueño,
 * 2026-10-06: «en el quote builder solo para admin habilita la lista de todas las quotes ya hechas y las de los
 * comeptirodes tambien».
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const t = (en: string) => en;

function cotizacion(p: Partial<CotizacionResumen> = {}): CotizacionResumen {
  return {
    id: "q1", estimate_num: "104582", owner_id: "u1", owner_name: "Ana Garza", store: "RDZ Pharr", customer_name: "Luis Pena",
    total: 100, print_count: 0, printed_at: null, created_at: "2026-10-05T20:30:00.000Z", updated_at: "2026-10-05T20:30:00.000Z", ...p,
  };
}
const f = (p: Partial<FiltroDeCotizaciones> = {}): FiltroDeCotizaciones => ({ ...filtroVacio(), ...p });

describe("quién ve la lista de todas", () => {
  it("solo el admin; ni un vendedor, ni un gerente con el módulo, ni nadie sin sesión", () => {
    expect(puedeVerTodas({ admin: true })).toBe(true);
    expect(puedeVerTodas({ admin: false })).toBe(false);
    expect(puedeVerTodas(null)).toBe(false);
    expect(puedeVerTodas(undefined)).toBe(false);
  });
});

describe("el filtro", () => {
  it("por vendedor y por tienda; vacío = todos", () => {
    const c = cotizacion();
    expect(cumpleFiltro(c, f())).toBe(true);
    expect(cumpleFiltro(c, f({ vendedor: "u1" }))).toBe(true);
    expect(cumpleFiltro(c, f({ vendedor: "u2" }))).toBe(false);
    expect(cumpleFiltro(c, f({ tienda: "RDZ Pharr" }))).toBe(true);
    expect(cumpleFiltro(c, f({ tienda: "RDZ McAllen" }))).toBe(false);
    expect(cumpleFiltro(cotizacion({ store: null }), f({ tienda: "RDZ Pharr" }))).toBe(false);
  });
  it("las fechas son días de Texas, los dos incluidos: las 9 de la noche del 5 son del 5, no del 6 en UTC", () => {
    // 2026-10-06T02:30Z = 2026-10-05 21:30 en Texas (CDT, UTC-5).
    const noche = cotizacion({ created_at: "2026-10-06T02:30:00.000Z" });
    expect(limitesDeFechas({ desde: "2026-10-05", hasta: "2026-10-05" })).toEqual({ desde: "2026-10-05T05:00:00.000Z", hasta: "2026-10-06T05:00:00.000Z" });
    expect(cumpleFiltro(noche, f({ desde: "2026-10-05", hasta: "2026-10-05" }))).toBe(true);
    expect(cumpleFiltro(noche, f({ desde: "2026-10-06" }))).toBe(false);
    expect(cumpleFiltro(noche, f({ hasta: "2026-10-04" }))).toBe(false);
    expect(cumpleFiltro(noche, f({ desde: "2026-10-05" }))).toBe(true);
    expect(cumpleFiltro(noche, f({ hasta: "2026-10-05" }))).toBe(true);
    // Un extremo mal escrito no limita.
    expect(limitesDeFechas({ desde: "ayer", hasta: "" })).toEqual({ desde: null, hasta: null });
  });
  it("el texto casa con el # de estimado y el cliente, sin mayúsculas ni espacios de más", () => {
    const c = cotizacion();
    expect(textoCoincide(c, "")).toBe(true);
    expect(textoCoincide(c, " 1045 ")).toBe(true);
    expect(textoCoincide(c, "luis PENA")).toBe(true);
    expect(textoCoincide(c, "garza")).toBe(false);
    expect(cumpleFiltro(c, f({ texto: "pena" }))).toBe(true);
    expect(cumpleFiltro(c, f({ texto: "nadie" }))).toBe(false);
  });
  it("hayFiltro y las tiendas del desplegable", () => {
    expect(hayFiltro(f())).toBe(false);
    expect(hayFiltro(f({ texto: "  " }))).toBe(false);
    expect(hayFiltro(f({ desde: "2026-10-01" }))).toBe(true);
    expect(tiendasDelFiltro(["RDZ Pharr", "RDZ McAllen"], [{ store: "Weslaco" }, { store: null }, { store: "RDZ Pharr" }])).toEqual(["RDZ Pharr", "RDZ McAllen", "Weslaco"]);
  });
});

describe("el orden y las tandas", () => {
  // Desordenada a propósito: una prueba de orden con datos ya ordenados pasa con cualquier implementación.
  const lista = [
    cotizacion({ id: "vieja", created_at: "2026-09-01T10:00:00Z" }),
    cotizacion({ id: "nueva", created_at: "2026-10-05T10:00:00Z" }),
    cotizacion({ id: "media-b", created_at: "2026-09-15T10:00:00Z" }),
    cotizacion({ id: "media-a", created_at: "2026-09-15T10:00:00Z" }),
  ];
  it("de la más reciente a la más vieja; a igual instante, por id, para que las tandas no bailen", () => {
    expect(masRecientePrimero(lista).map((c) => c.id)).toEqual(["nueva", "media-b", "media-a", "vieja"]);
  });
  it("cada tanda pide TANDA + 1 filas, y se queda con TANDA diciendo si hay más", () => {
    expect(TANDA).toBe(50);
    expect(rangoDeTanda(0)).toEqual({ desde: 0, hasta: 50 });
    expect(rangoDeTanda(2)).toEqual({ desde: 100, hasta: 150 });
    expect(rangoDeTanda(-1)).toEqual({ desde: 0, hasta: 50 });
    const muchas = Array.from({ length: 51 }, (_, i) => i);
    expect(cortaTanda(muchas)).toEqual({ filas: muchas.slice(0, 50), hayMas: true });
    expect(cortaTanda(muchas.slice(0, 50))).toEqual({ filas: muchas.slice(0, 50), hayMas: false });
    expect(cortaTanda([])).toEqual({ filas: [], hayMas: false });
  });
  it("en memoria: filtra, ordena y corta por tandas", () => {
    const muchas = Array.from({ length: 120 }, (_, i) => cotizacion({ id: `q${String(i).padStart(3, "0")}`, created_at: `2026-0${1 + (i % 9)}-15T10:00:00Z`, store: i % 2 ? "A" : "B" }));
    const t0 = tandaEnMemoria(muchas, f(), 0);
    expect(t0.filas).toHaveLength(50);
    expect(t0.hayMas).toBe(true);
    expect(t0.filas[0].created_at >= t0.filas[49].created_at).toBe(true);
    const t2 = tandaEnMemoria(muchas, f(), 2);
    expect(t2.filas).toHaveLength(20);
    expect(t2.hayMas).toBe(false);
    const soloA = tandaEnMemoria(muchas, f({ tienda: "A" }), 1);
    expect(soloA.filas).toHaveLength(10);
    expect(soloA.filas.every((c) => c.store === "A")).toBe(true);
    expect(soloA.hayMas).toBe(false);
  });
});

describe("el estado", () => {
  it("impresa si se generó la copia alguna vez; si no, guardada sin imprimir", () => {
    expect(estadoDeCotizacion({ print_count: 0, printed_at: null })).toBe("guardada");
    expect(estadoDeCotizacion({ print_count: 2, printed_at: "2026-10-05T10:00:00Z" })).toBe("impresa");
    expect(estadoDeCotizacion({ print_count: 0, printed_at: "2026-10-05T10:00:00Z" })).toBe("impresa");
  });
});

describe("lo que se le pide a la base", () => {
  function consultaFalsa() {
    const llamadas: string[] = [];
    const q: Consulta = {
      eq: vi.fn((c: string, v: string) => { llamadas.push(`eq ${c} ${v}`); return q; }),
      gte: vi.fn((c: string, v: string) => { llamadas.push(`gte ${c} ${v}`); return q; }),
      lt: vi.fn((c: string, v: string) => { llamadas.push(`lt ${c} ${v}`); return q; }),
      or: vi.fn((s: string) => { llamadas.push(`or ${s}`); return q; }),
    };
    return { q, llamadas };
  }
  it("el mismo filtro que cumpleFiltro, columna a columna; sin filtro no se pide nada", () => {
    const vacia = consultaFalsa();
    aplicaFiltro(vacia.q, f());
    expect(vacia.llamadas).toEqual([]);
    const llena = consultaFalsa();
    aplicaFiltro(llena.q, f({ vendedor: "u1", tienda: "RDZ Pharr", desde: "2026-10-05", hasta: "2026-10-05", texto: "pena" }));
    expect(llena.llamadas).toEqual([
      "eq owner_id u1",
      "eq store RDZ Pharr",
      "gte created_at 2026-10-05T05:00:00.000Z",
      "lt created_at 2026-10-06T05:00:00.000Z",
      'or estimate_num.ilike."*pena*",customer->>full_name.ilike."*pena*"',
    ]);
  });
  it("el texto va entre comillas y sin comodines ni comillas coladas", () => {
    expect(filtroDeTextoPostgrest("  ")).toBeNull();
    expect(filtroDeTextoPostgrest('a,b) "c" 50%_')).toBe('estimate_num.ilike."*a,b) c 50\\%\\_*",customer->>full_name.ilike."*a,b) c 50\\%\\_*"');
  });
  it("las columnas de la lista: con el dueño por su clave foránea y SIN la entrega (lleva la dirección)", () => {
    expect(COLUMNAS_DE_LA_LISTA).toContain("owner:profiles!estimator_quotes_owner_id_fkey(full_name)");
    expect(COLUMNAS_DE_LA_LISTA).toContain("created_at");
    expect(COLUMNAS_DE_LA_LISTA.split(",").map((c) => c.trim())).not.toContain("delivery");
  });
  it("de la fila al resumen: el nombre del dueño embebido, el cliente del jsonb y el total con impuesto", () => {
    const fila = {
      id: "q1", estimate_num: "E-1", owner_id: "u1", store: " RDZ Pharr ", print_count: 1, printed_at: "2026-10-05T10:00:00Z",
      created_at: "2026-10-05T09:00:00Z", updated_at: "2026-10-05T10:00:00Z",
      customer: { full_name: " Luis Pena " }, lines: [{ kind: "unit", id: "a", unit_price: 100, quantity: 1 }],
      owner: { full_name: "Ana Garza" },
    };
    const r = resumenDeFila(fila);
    expect(r).toMatchObject({ id: "q1", estimate_num: "E-1", owner_id: "u1", owner_name: "Ana Garza", store: "RDZ Pharr", customer_name: "Luis Pena", print_count: 1 });
    expect(r.total).toBe(108.25);
    // PostgREST puede devolver el embebido como lista; y una fila sin dueño no revienta.
    expect(resumenDeFila({ ...fila, owner: [{ full_name: "Beto" }] }).owner_name).toBe("Beto");
    expect(resumenDeFila({ ...fila, owner: null, owner_id: null })).toMatchObject({ owner_name: null, owner_id: null, total: 108.25 });
  });
  it("listarTodas pide las columnas, de la más reciente a la más vieja, el rango de la tanda, y corta con hayMas", async () => {
    const llamadas: string[] = [];
    const filas = Array.from({ length: 51 }, (_, i) => ({ id: `q${i}`, estimate_num: `E-${i}`, customer: {}, lines: [], created_at: "2026-10-05T10:00:00Z" }));
    const tabla: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "or", "order"]) tabla[m] = vi.fn((...a: unknown[]) => { llamadas.push(`${m} ${a.map(String).join(" ")}`); return tabla; });
    tabla.range = vi.fn(async (a: number, b: number) => { llamadas.push(`range ${a} ${b}`); return { data: filas, error: null }; });
    const sb = { from: vi.fn(() => tabla) } as unknown as SupabaseClient;
    const r = await almacenDeLaBase(sb).listarTodas(f({ tienda: "RDZ Pharr" }), 1);
    expect(r.ok && r.valor.filas).toHaveLength(50);
    expect(r.ok && r.valor.hayMas).toBe(true);
    expect(llamadas).toEqual([
      `select ${COLUMNAS_DE_LA_LISTA}`, "eq store RDZ Pharr", "order created_at [object Object]", "order id [object Object]", "range 50 100",
    ]);
    const orden = (tabla.order as ReturnType<typeof vi.fn>).mock.calls;
    expect(orden[0]).toEqual(["created_at", { ascending: false }]);
    expect(orden[1]).toEqual(["id", { ascending: false }]);
  });
  it("sin la 148 dice sinTabla; otro error, error", async () => {
    const con = (error: { code: string; message: string }) => {
      const tabla: Record<string, unknown> = {};
      for (const m of ["select", "order"]) tabla[m] = vi.fn(() => tabla);
      tabla.range = vi.fn(async () => ({ data: null, error }));
      return { from: vi.fn(() => tabla) } as unknown as SupabaseClient;
    };
    const sin = await almacenDeLaBase(con({ code: "PGRST205", message: "no table" })).listarTodas(f(), 0);
    expect(sin.ok === false && sin.sinTabla).toBe(true);
    const otro = await almacenDeLaBase(con({ code: "42501", message: "permission denied" })).listarTodas(f(), 0);
    expect(otro.ok === false && !otro.sinTabla && otro.error).toBe("permission denied");
  });
  it("los vendedores del desplegable: admin o la casilla estimator", async () => {
    const llamadas: string[] = [];
    const tabla: Record<string, unknown> = {};
    for (const m of ["select", "or"]) tabla[m] = vi.fn((...a: unknown[]) => { llamadas.push(`${m} ${a.join(" ")}`); return tabla; });
    tabla.order = vi.fn(async () => ({ data: [{ id: "u1", full_name: "Ana", store: null }], error: null }));
    const r = await almacenDeLaBase({ from: vi.fn(() => tabla) } as unknown as SupabaseClient).vendedores();
    expect(r.ok && r.valor).toEqual([{ id: "u1", full_name: "Ana", store: null }]);
    expect(llamadas).toEqual(["select id, full_name, store", "or role.eq.admin,module_access.cs.{estimator}"]);
  });
});

describe("el demo hace lo que haría la 148 con la lista", () => {
  const admin = { id: "u-admin", name: "You (Admin)", admin: true, store: null };
  it("el admin ve las dos de la semilla, la más reciente primero, con vendedor, tienda, cliente, total y estado", async () => {
    const a = almacenDemo(() => admin, false);
    const r = await a.listarTodas(filtroVacio(), 0);
    expect(r.ok && r.valor.hayMas).toBe(false);
    expect(r.ok && r.valor.filas.map((c) => c.estimate_num)).toEqual([DEMO_ESTIMADO_AJENO, DEMO_ESTIMADO_IMPRESO]);
    const impresa = r.ok ? r.valor.filas[1] : cotizacion();
    expect(impresa).toMatchObject({ owner_id: "u-sales", owner_name: "Sam Sales", store: "Edinburg", customer_name: "Ana Garza", print_count: 1 });
    expect(estadoDeCotizacion(impresa)).toBe("impresa");
    // 53 cajas × 23.8 × 1.89 = 2,384.05 + 8.25% de impuesto (D-413, D-442).
    expect(impresa.total).toBe(2580.73);
    expect(estadoDeCotizacion(r.ok ? r.valor.filas[0] : cotizacion({ print_count: 1 }))).toBe("guardada");
  });
  it("el filtro del demo es el mismo que el de la base", async () => {
    const a = almacenDemo(() => admin, false);
    const porVendedor = await a.listarTodas(f({ vendedor: DEMO_OTRO_VENDEDOR.id }), 0);
    expect(porVendedor.ok && porVendedor.valor.filas.map((c) => c.estimate_num)).toEqual([DEMO_ESTIMADO_AJENO]);
    const porTienda = await a.listarTodas(f({ tienda: "Edinburg" }), 0);
    expect(porTienda.ok && porTienda.valor.filas.map((c) => c.estimate_num)).toEqual([DEMO_ESTIMADO_IMPRESO]);
    const porTexto = await a.listarTodas(f({ texto: "garza" }), 0);
    expect(porTexto.ok && porTexto.valor.filas.map((c) => c.estimate_num)).toEqual([DEMO_ESTIMADO_IMPRESO]);
    const porFecha = await a.listarTodas(f({ desde: "2026-10-01" }), 0);
    expect(porFecha.ok && porFecha.valor.filas.map((c) => c.estimate_num)).toEqual([DEMO_ESTIMADO_AJENO]);
  });
  it("un vendedor solo ve las suyas y las de su tienda (la política de SELECT de la 148), aunque pida todas", async () => {
    let yo = { id: "u-nadie", name: "Nadie", admin: false, store: "Mission" as string | null };
    const a = almacenDemo(() => yo, false);
    const nada = await a.listarTodas(filtroVacio(), 0);
    expect(nada.ok && nada.valor.filas).toEqual([]);
    yo = { id: "u-otro", name: "Otro", admin: false, store: "Edinburg" };
    const tienda = await a.listarTodas(filtroVacio(), 0);
    expect(tienda.ok && tienda.valor.filas.map((c) => c.estimate_num)).toEqual([DEMO_ESTIMADO_IMPRESO]);
    yo = { id: DEMO_OTRO_VENDEDOR.id, name: DEMO_OTRO_VENDEDOR.name, admin: false, store: null };
    const mias = await a.listarTodas(filtroVacio(), 0);
    expect(mias.ok && mias.valor.filas.map((c) => c.estimate_num)).toEqual([DEMO_ESTIMADO_AJENO]);
  });
  it("una guardada nueva entra en la lista con su fecha; imprimirla la marca impresa", async () => {
    const a = almacenDemo(() => admin, false);
    const g = await a.guardar(null, { ...borradorVacio(), estimate_num: "N-9" });
    const id = g.ok ? g.valor : "";
    expect((await a.marcarImpresa(id, 1)).ok).toBe(true);
    const r = await a.listarTodas(f({ texto: "n-9" }), 0);
    expect(r.ok && r.valor.filas.map((c) => [c.estimate_num, estadoDeCotizacion(c)])).toEqual([["N-9", "impresa"]]);
    const lista = await a.listarTodas(filtroVacio(), 0);
    expect(lista.ok && lista.valor.filas[0].estimate_num).toBe("N-9");
  });
  it("los vendedores del demo, y con ?sinTabla=1 nada", async () => {
    const v = await almacenDemo(() => admin, false).vendedores();
    expect(v.ok && v.valor.map((x) => x.id)).toContain("u-sales");
    const sin = await almacenDemo(() => admin, true).listarTodas(filtroVacio(), 0);
    expect(sin.ok === false && sin.sinTabla).toBe(true);
  });
});

describe("la pantalla", () => {
  const pantalla = leer("src/app/estimator/Estimador.tsx");
  const pestana = leer("src/app/estimator/TodasLasCotizaciones.tsx");
  it("la pestaña y su contenido solo se pintan si puedeVerTodas, con el mismo almacén y el de la competencia", () => {
    expect(pantalla).toContain("{puedeVerTodas(me) && (");
    expect(pantalla).toContain('data-pestana="todas"');
    expect(pantalla).toContain("{pestana === \"todas\" && puedeVerTodas(me) && (");
    expect(pantalla).toContain("<TodasLasCotizaciones almacen={almacen} competencia={almacenCompetencia} me={me} t={t} lang={lang}");
    expect(pantalla).toContain("onAbrir={(id) => void abrirDesdeLista(id)} />");
    // Si «Ver como» deja de ser admin estando en la pestaña, se vuelve a la cotización.
    expect(pantalla).toContain("useEffect(() => { if (pestana === \"todas\" && !puedeVerTodas(me)) setPestana(\"cotizacion\"); }, [pestana, me]);");
  });
  it("abrir desde la lista va a la pestaña Cotización y carga la guardada (donde se imprime como siempre)", () => {
    expect(pantalla).toContain("const abrirDesdeLista = async (id: string) => {\n    setPestana(\"cotizacion\");\n    setVistaPrevia(false);\n    await abrirGuardada(id);\n  };");
  });
  it("la pestaña pide por tandas con el filtro, no pide nada si no es admin, y lista la competencia con «Abrir su cotización»", () => {
    expect(pestana).toContain("if (!puedeVerTodas(me)) return;\n    setOcupado(true);\n    const r = await almacen.listarTodas(f, n);");
    expect(pestana).toContain("if (!puedeVerTodas(me)) return null;");
    expect(pestana).toContain("setFilas((previas) => (n === 0 ? r.valor.filas : [...previas, ...r.valor.filas]));");
    expect(pestana).toContain("onClick={() => void cargar(filtro, tanda + 1)}");
    expect(pestana).toContain("if (r.sinTabla) { setEstado(\"sin-base\"); return; }");
    expect(pestana).toContain("const e = await competencia.listarTodos();");
    expect(pestana).toContain("filtraEstimados(estimados, { tienda: filtro.tienda, texto: filtro.texto })");
    expect(pestana).toContain("onAbrirCotizacion={onAbrir} />");
  });
  it("la tabla pinta fecha, vendedor, tienda, cliente, total, estado y «Abrir»; vacía, lo dice", () => {
    const h = renderToStaticMarkup(createElement(TablaDeCotizaciones, {
      filas: [cotizacion(), cotizacion({ id: "q2", owner_name: null, owner_id: null, store: null, print_count: 3, printed_at: "x", total: 2580.73 })],
      t, filtrando: false, onAbrir: () => {},
    }));
    expect(h).toContain("Ana Garza");
    expect(h).toContain("RDZ Pharr");
    expect(h).toContain("Luis Pena");
    expect(h).toContain("$100.00");
    expect(h).toContain("$2,580.73");
    expect(h).toContain("Saved, not printed");
    expect(h).toContain("Printed ×3");
    expect(h).toContain("(no owner)");
    expect(h).toContain("No store");
    expect(h.match(/data-cotizacion-abrir/g) ?? []).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(TablaDeCotizaciones, { filas: [], t, filtrando: true, onAbrir: () => {} }))).toContain("Nothing matches the filter.");
    expect(renderToStaticMarkup(createElement(TablaDeCotizaciones, { filas: [], t, filtrando: false, onAbrir: () => {} }))).toContain("No saved quotes yet.");
  });
  it("en la lista de la competencia, «Abrir su cotización» solo en los pegados a una, y solo si se pide", () => {
    const base = {
      id: "e1", quote_id: null, path: "general/u1/x.pdf", file_name: "x.pdf", mime_type: "application/pdf", size_bytes: 10,
      competitor: "Rival", competitor_total: null, note: null, uploaded_by: "u1", uploaded_by_name: "Ana",
      uploaded_at: "2026-09-29T10:00:00Z", customer_name: "Ana Garza", store: "RDZ Pharr", estimate_num: null,
    };
    const estimados = [base, { ...base, id: "e2", quote_id: "q1", estimate_num: "104582", path: "q1/y.pdf" }];
    const me = { id: "zz", name: "Admin", admin: true };
    const con = renderToStaticMarkup(createElement(ListaDeEstimados, { estimados, me, t, lang: "en", confirmando: null, ocupado: false, onAbrir: () => {}, onQuitar: () => {}, onConfirmar: () => {}, onAbrirCotizacion: () => {} }));
    expect(con.match(/data-estimado-abrir-cotizacion/g) ?? []).toHaveLength(1);
    expect(con).toContain("Rival");
    const sin = renderToStaticMarkup(createElement(ListaDeEstimados, { estimados, me, t, lang: "en", confirmando: null, ocupado: false, onAbrir: () => {}, onQuitar: () => {}, onConfirmar: () => {} }));
    expect(sin.match(/data-estimado-abrir-cotizacion/g) ?? []).toHaveLength(0);
  });
});
