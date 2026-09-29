import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLUMNAS_SEGUN_IDIOMA, MAX_FILTROS_GUARDADOS, VISTA_VACIA, aplicaFiltroGuardado, borraFiltro, claveDeFiltrosEnElNavegador, coincideConLaVista,
  filtroLlamado, filtrosAlEntrar, filtrosDelNavegador, fotoDeOrdenes, guardaFiltro, persisteFiltros, renombraFiltro, textoDeLoIgnorado,
  textoDelRechazoDeFiltro, type DestinoDeFiltros, type EstadoDeOrdenes, type VistaDeTabla,
} from "./filtros-guardados";
import {
  CLAVE_DE_FILTROS, MAX_NOMBRE_DE_FILTRO, columnasValidas, filtrosDeValor, filtrosGuardadosValidos, guardaColumnas, leeColumnas, plantillasDeValor,
  prefsDeValor, valorDeColumnas, type ClienteDePrefs, type FiltroGuardado,
} from "./user-prefs";
import { bytesEnLaBase, cabeEnLaFila } from "./plantillas-de-columnas";
import { comparaCeldas, filtraFilas, type ValorDeCelda } from "./orden-y-filtro";

/**
 * Los filtros guardados de Órdenes (D-440). El dueño, 2026-09-28: «create cuztomizable filters that the user sorts different
 * columns and that stays as a filter».
 */

const t = (en: string, es: string) => `${en} | ${es}`;
const es = (_en: string, es_: string) => es_;
const vista = (filtros: Record<string, string[]>, orden: VistaDeTabla["orden"] = null): VistaDeTabla =>
  ({ filtros: Object.fromEntries(Object.entries(filtros).map(([k, v]) => [k, new Set(v)])), orden });
const estado = (o: Partial<EstadoDeOrdenes> = {}): EstadoDeOrdenes =>
  ({ pastilla: "approved", preset: "recent", vista: vista({ store: ["Brownsville"] }, { clave: "date", dir: "desc" }), lang: "es", ...o });
const COLS = ["__id", "stage", "priority", "type", "store", "account", "date", "driver", "po"];
const ctx = (o: Partial<Parameters<typeof aplicaFiltroGuardado>[1]> = {}) =>
  ({ columnas: COLS, visibles: COLS, pastillas: ["all", "approved", "ready", "__atrasadas", "__doc_pendiente"], lang: "es" as const, ...o });

describe("la foto de lo que se ve", () => {
  it("guarda los filtros de columna, el orden, la pastilla, el chip de fechas y el idioma", () => {
    expect(fotoDeOrdenes(estado(), true)).toEqual({ f: "approved", p: "recent", c: { store: ["Brownsville"] }, s: ["date", "desc"], l: "es" });
  });
  it("sin la casilla, ni pastilla ni chip: solo lo de las columnas", () => {
    expect(fotoDeOrdenes(estado(), false)).toEqual({ c: { store: ["Brownsville"] }, s: ["date", "desc"], l: "es" });
  });
  it("un filtro vacío no filtra y no se guarda; los valores van ordenados; sin orden no hay `s`", () => {
    const f = fotoDeOrdenes(estado({ vista: vista({ store: ["Weslaco", "Brownsville"], type: [] }) }), false);
    expect(f).toEqual({ c: { store: ["Brownsville", "Weslaco"] }, l: "es" });
  });
  it("un chip de fechas que la pantalla no enseña no se guarda", () => {
    expect(fotoDeOrdenes(estado({ preset: "mine" }), true)).not.toHaveProperty("p");
  });
});

describe("guardar, actualizar, renombrar y borrar", () => {
  const A: FiltroGuardado = { n: "Mis Brownsville", c: { store: ["Brownsville"] } };
  const B: FiltroGuardado = { n: "Hoy", f: "ready" };
  it("uno nuevo va AL FINAL, tal cual; la lista de entrada no se toca", () => {
    const lista = [A];
    const r = guardaFiltro(lista, "  Hoy ", { f: "ready" });
    expect(r).toEqual({ ok: true, lista: [A, B], reemplaza: false });
    expect(lista).toEqual([A]);
  });
  it("un nombre que ya existe —con otras mayúsculas— se REEMPLAZA en su sitio: es «Actualizar»", () => {
    const r = guardaFiltro([A, B], "mis brownsville", { c: { store: ["Weslaco"] }, s: ["po", "asc"] });
    expect(r).toEqual({ ok: true, lista: [{ n: "mis brownsville", c: { store: ["Weslaco"] }, s: ["po", "asc"] }, B], reemplaza: true });
  });
  it("sin nombre no se guarda; con diez, uno nuevo tampoco — pero reemplazar sí", () => {
    expect(guardaFiltro([], "   ", {})).toEqual({ ok: false, motivo: "sin-nombre" });
    const diez = Array.from({ length: MAX_FILTROS_GUARDADOS }, (_, i) => ({ n: `F${i}` }));
    expect(guardaFiltro(diez, "Otro", {})).toEqual({ ok: false, motivo: "lleno" });
    expect(guardaFiltro(diez, "f3", { f: "all" }).ok).toBe(true);
  });
  it("el nombre se corta a 40", () => {
    const r = guardaFiltro([], "x".repeat(60), {});
    expect(r.ok && r.lista[0].n).toBe("x".repeat(MAX_NOMBRE_DE_FILTRO));
  });
  it("renombrar: en su sitio y con su contenido; no a un nombre que ya tiene otro; no uno que no está", () => {
    expect(renombraFiltro([A, B], "mis brownsville", "  Brownsville  ")).toEqual({ ok: true, lista: [{ ...A, n: "Brownsville" }, B], reemplaza: true });
    expect(renombraFiltro([A, B], "Mis Brownsville", "HOY")).toEqual({ ok: false, motivo: "repetido" });
    expect(renombraFiltro([A, B], "Nada", "Algo")).toEqual({ ok: false, motivo: "no-existe" });
    expect(renombraFiltro([A, B], "Hoy", " ")).toEqual({ ok: false, motivo: "sin-nombre" });
    // Cambiar solo las mayúsculas del propio nombre se puede.
    expect(renombraFiltro([A, B], "Hoy", "HOY")).toEqual({ ok: true, lista: [A, { ...B, n: "HOY" }], reemplaza: true });
  });
  it("borrar quita solo ese, sin distinguir mayúsculas; uno que no está no cambia nada", () => {
    expect(borraFiltro([A, B], "HOY")).toEqual([A]);
    expect(borraFiltro([A, B], "nada")).toEqual([A, B]);
    expect(filtroLlamado([A, B], " hoy ")).toBe(B);
    expect(filtroLlamado([A, B], "")).toBeUndefined();
  });
});

describe("aplicar", () => {
  const G: FiltroGuardado = { n: "Mis Brownsville", f: "approved", p: "recent", c: { store: ["Brownsville"], type: ["Retail"] }, s: ["date", "desc"], l: "es" };
  it("pone TAL CUAL filtros, orden, pastilla y chip; sin nada que ignorar", () => {
    const r = aplicaFiltroGuardado(G, ctx());
    expect(r).toEqual({ pastilla: "approved", preset: "recent", vista: vista({ store: ["Brownsville"], type: ["Retail"] }, { clave: "date", dir: "desc" }), avisos: [] });
  });
  it("sin orden guardado, quita el que hubiera; sin pastilla ni chip, deja los de ahora (`null`)", () => {
    const r = aplicaFiltroGuardado({ n: "x", c: { store: ["A"] } }, ctx());
    expect(r.vista.orden).toBeNull();
    expect(r.pastilla).toBeNull();
    expect(r.preset).toBeNull();
  });
  it("una columna que ya no existe: fuera su filtro y su orden, y se dice — el resto se aplica", () => {
    const r = aplicaFiltroGuardado({ n: "x", c: { store: ["A"], vieja: ["1"] }, s: ["vieja", "asc"] }, ctx());
    expect(r.vista).toEqual(vista({ store: ["A"] }));
    expect(r.avisos).toEqual([{ tipo: "columna", clave: "vieja" }]);
  });
  it("una pastilla que este rol no tiene: se queda la de ahora, y se dice", () => {
    const r = aplicaFiltroGuardado({ n: "x", f: "pending", c: { store: ["A"] } }, ctx());
    expect(r.pastilla).toBeNull();
    expect(r.vista).toEqual(vista({ store: ["A"] }));
    expect(r.avisos).toEqual([{ tipo: "pastilla", clave: "pending" }]);
  });
  it("«Etapa» o «Prioridad» guardadas en el otro idioma: fuera (no encontrarían nada), y se dice; las demás columnas valen", () => {
    expect(COLUMNAS_SEGUN_IDIOMA).toEqual(["stage", "priority"]);
    const r = aplicaFiltroGuardado({ n: "x", c: { stage: ["Programado"], store: ["A"] }, l: "es" }, ctx({ lang: "en" }));
    expect(r.vista).toEqual(vista({ store: ["A"] }));
    expect(r.avisos).toEqual([{ tipo: "idioma", clave: "stage" }]);
    // En el mismo idioma, o sin idioma guardado, se aplican.
    expect(aplicaFiltroGuardado({ n: "x", c: { stage: ["Programado"] }, l: "es" }, ctx()).vista).toEqual(vista({ stage: ["Programado"] }));
  });
  it("una columna OCULTA: se pone igual (vale en cuanto se muestre), pero se dice que ahora no hace nada", () => {
    const r = aplicaFiltroGuardado({ n: "x", c: { store: ["A"] }, s: ["driver", "asc"] }, ctx({ visibles: ["__id", "date"] }));
    expect(r.vista).toEqual(vista({ store: ["A"] }, { clave: "driver", dir: "asc" }));
    expect(r.avisos).toEqual([{ tipo: "oculta", clave: "store" }, { tipo: "oculta", clave: "driver" }]);
  });
  it("el texto de lo ignorado, en los dos idiomas, con el nombre de cada cosa", () => {
    const txt = textoDeLoIgnorado([{ tipo: "columna", clave: "vieja" }, { tipo: "pastilla", clave: "pending" }], es, (k) => k.toUpperCase());
    expect(txt).toBe("No se aplicó: la columna «VIEJA» ya no existe; la pastilla «PENDING» no está en su vista.");
    expect(textoDeLoIgnorado([], t, (k) => k)).toBe("");
    const en = (e: string) => e;
    expect(textoDeLoIgnorado([{ tipo: "oculta", clave: "store" }, { tipo: "idioma", clave: "stage" }], en, (k) => k))
      .toBe("Not applied: “store” is a hidden column: show it in ⚙ Columns for it to apply; the “stage” filter was saved in the other language.");
  });
});

describe("«Mis Brownsville»: guardar, cambiar de pastilla y volver da las mismas filas en el mismo orden", () => {
  type Fila = { id: string; store: string | null; date: string | null; stage: string };
  const FILAS: Fila[] = [
    { id: "1", store: "Brownsville", date: "2026-09-27", stage: "approved" },
    { id: "2", store: "Weslaco", date: "2026-09-29", stage: "approved" },
    { id: "3", store: "Brownsville", date: "2026-09-30", stage: "ready" },
    { id: "4", store: "Brownsville", date: "2026-09-28", stage: "approved" },
    { id: "5", store: null, date: "2026-09-26", stage: "approved" },
  ];
  // Lo que hace la tabla con una vista: filtrar por columna y ordenar (la misma librería que usa `OrdersTable`).
  const pinta = (filas: Fila[], v: VistaDeTabla, pastilla: string) => {
    const deEtapa = pastilla === "all" ? filas : filas.filter((f) => f.stage === pastilla);
    const valor = (k: string, f: Fila): ValorDeCelda => (f as unknown as Record<string, ValorDeCelda>)[k];
    const filtradas = filtraFilas(deEtapa, v.filtros, valor);
    if (!v.orden) return filtradas.map((f) => f.id);
    const o = v.orden;
    return [...filtradas].sort((a, b) => (o.dir === "asc" ? 1 : -1) * comparaCeldas(valor(o.clave, a), valor(o.clave, b))).map((f) => f.id);
  };
  it("ida y vuelta por la base: las mismas filas, en el mismo orden, y su pastilla encendida", () => {
    const antes = estado({ pastilla: "approved", vista: vista({ store: ["Brownsville"] }, { clave: "date", dir: "desc" }) });
    const vistoAntes = pinta(FILAS, antes.vista, antes.pastilla);
    expect(vistoAntes).toEqual(["4", "1"]);                                 // contradice el orden de entrada (1 antes que 4)
    const g = guardaFiltro([], "Mis Brownsville", fotoDeOrdenes(antes, true));
    if (!g.ok) throw new Error("no guardó");
    // A la base y de vuelta, como JSON: los Set no sobreviven a JSON, los arrays sí.
    const leidos = filtrosDeValor(JSON.parse(JSON.stringify(valorDeColumnas({ visibles: {}, orden: {}, filtros: g.lista }))));
    // Otra pastilla, sin filtros de columna: se ve otra cosa.
    const otra = estado({ pastilla: "ready", vista: VISTA_VACIA });
    expect(pinta(FILAS, otra.vista, otra.pastilla)).toEqual(["3"]);
    expect(coincideConLaVista(leidos[0], otra)).toBe(false);
    // Pulsar «Mis Brownsville».
    const r = aplicaFiltroGuardado(leidos[0], ctx());
    const despues: EstadoDeOrdenes = { ...otra, pastilla: r.pastilla ?? otra.pastilla, preset: r.preset ?? otra.preset, vista: r.vista };
    expect(pinta(FILAS, despues.vista, despues.pastilla)).toEqual(vistoAntes);
    expect(coincideConLaVista(leidos[0], despues)).toBe(true);
  });
});

describe("cuándo se enciende su pastilla", () => {
  const G: FiltroGuardado = { n: "x", c: { store: ["B", "A"] }, s: ["date", "asc"] };
  it("con exactamente sus filtros y su orden, y los valores en cualquier orden", () => {
    expect(coincideConLaVista(G, estado({ vista: vista({ store: ["A", "B"] }, { clave: "date", dir: "asc" }) }))).toBe(true);
  });
  it("no, si falta o sobra un valor, una columna, o el orden es otro", () => {
    expect(coincideConLaVista(G, estado({ vista: vista({ store: ["A"] }, { clave: "date", dir: "asc" }) }))).toBe(false);
    expect(coincideConLaVista(G, estado({ vista: vista({ store: ["A", "B"], type: ["R"] }, { clave: "date", dir: "asc" }) }))).toBe(false);
    expect(coincideConLaVista(G, estado({ vista: vista({ store: ["A", "B"] }, { clave: "date", dir: "desc" }) }))).toBe(false);
    expect(coincideConLaVista(G, estado({ vista: vista({ store: ["A", "B"] }) }))).toBe(false);
  });
  it("la pastilla y el chip cuentan SOLO si los guardó", () => {
    const v = vista({ store: ["A", "B"] }, { clave: "date", dir: "asc" });
    expect(coincideConLaVista(G, estado({ pastilla: "ready", preset: "all", vista: v }))).toBe(true);
    const conPastilla = { ...G, f: "approved", p: "recent" };
    expect(coincideConLaVista(conPastilla, estado({ pastilla: "approved", preset: "recent", vista: v }))).toBe(true);
    expect(coincideConLaVista(conPastilla, estado({ pastilla: "ready", preset: "recent", vista: v }))).toBe(false);
    expect(coincideConLaVista(conPastilla, estado({ pastilla: "approved", preset: "today", vista: v }))).toBe(false);
  });
});

describe("dónde vive: la quinta mitad de `order_columns`, sin migración", () => {
  const G: FiltroGuardado = { n: "Mis Brownsville", f: "approved", c: { store: ["Brownsville"] }, s: ["date", "desc"], l: "es" };
  it("se escribe como `_filtros` y se lee igual; sin filtros no se escribe la clave", () => {
    const v = valorDeColumnas({ visibles: { logistics: ["store"] }, orden: {}, filtros: [G] });
    expect(v[CLAVE_DE_FILTROS]).toEqual([G]);
    expect(filtrosDeValor(v)).toEqual([G]);
    expect(valorDeColumnas({ visibles: { logistics: ["store"] }, orden: {} })).not.toHaveProperty(CLAVE_DE_FILTROS);
  });
  it("`_filtros` no es un rol: no se cuela en las columnas de nadie", () => {
    expect(columnasValidas({ logistics: ["store"], _filtros: [G] })).toEqual({ logistics: ["store"] });
    expect(prefsDeValor({ logistics: ["store"], _filtros: [G] }).visibles).toEqual({ logistics: ["store"] });
  });
  it("lo leído se sanea: basura fuera, repetidos fuera, chip desconocido fuera, orden mal formado fuera, nunca más de diez", () => {
    const sucio = [
      null, "x", [], { n: "" }, { n: "  Bueno  ", p: "mine", s: ["date", "arriba"], c: { store: ["A", "A", 3, ""], vacia: [], "": ["x"] }, l: "fr" },
      { n: "bueno" }, { n: "Dos", s: ["po", "asc"], p: "today", f: "x".repeat(41) },
      ...Array.from({ length: 12 }, (_, i) => ({ n: `N${i}` })),
    ];
    const r = filtrosGuardadosValidos(sucio);
    expect(r).toHaveLength(MAX_FILTROS_GUARDADOS);
    expect(r[0]).toEqual({ n: "Bueno", c: { store: ["A"] } });
    expect(r[1]).toEqual({ n: "Dos", s: ["po", "asc"], p: "today" });
    expect(filtrosGuardadosValidos({ n: "no es lista" })).toEqual([]);
    expect(filtrosGuardadosValidos([{ n: "x", c: { store: Array.from({ length: 301 }, (_, i) => `v${i}`) } }])).toEqual([{ n: "x" }]);
  });

  function baseCon(valor: unknown) {
    const fila = { value: valor as Record<string, unknown> };
    const cliente = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: fila.value }, error: null }) }) }) }),
        upsert: (f: { value: Record<string, unknown> }) => ({ select: async () => { fila.value = f.value; return { data: [{ user_id: "yo" }], error: null }; } }),
      }),
    } as unknown as ClienteDePrefs;
    return { cliente, fila };
  }
  const LLENA = valorDeColumnas({
    visibles: { logistics: ["date", "so"] }, orden: { logistics: ["so", "date"] }, anchos: { logistics: { date: 150 } },
    plantillas: [{ n: "Vieja", v: ["stage"] }], filtros: [G],
  });
  it("se lee con la fila, y guardar filtros NO borra columnas, orden, anchos ni plantillas", async () => {
    const { cliente, fila } = baseCon(LLENA);
    const l = await leeColumnas(cliente, "yo");
    expect(l.filtros).toEqual([G]);
    await guardaColumnas(cliente, "yo", l.columnas, "order_columns", l.orden, l.anchos, l.plantillas, [...l.filtros, { n: "Otro" }]);
    expect(prefsDeValor(fila.value)).toEqual(prefsDeValor(LLENA));
    expect(plantillasDeValor(fila.value)).toEqual([{ n: "Vieja", v: ["stage"] }]);
    expect(filtrosDeValor(fila.value).map((g) => g.n)).toEqual(["Mis Brownsville", "Otro"]);
  });
  it("marcar una casilla pasando los filtros leídos NO los borra; sin pasarlos, sí (por eso la página escribe por un sitio)", async () => {
    const { cliente, fila } = baseCon(LLENA);
    const l = await leeColumnas(cliente, "yo");
    await guardaColumnas(cliente, "yo", { ...l.columnas, logistics: ["po"] }, "order_columns", l.orden, l.anchos, l.plantillas, l.filtros);
    expect(filtrosDeValor(fila.value)).toEqual([G]);
    await guardaColumnas(cliente, "yo", l.columnas, "order_columns", l.orden, l.anchos, l.plantillas);
    expect(filtrosDeValor(fila.value)).toEqual([]);
  });
  it("tamaño (modelo `bytesEnLaBase`, no medida): diez filtros normales caben con un rol lleno; uno enorme no pasa la guarda", () => {
    const normales = Array.from({ length: 10 }, (_, i) => ({ n: `Filtro de logística ${i}`, f: "approved", p: "recent", c: { store: ["Brownsville", "Weslaco"], type: ["Retail"] }, s: ["date", "desc"] as ["date", "desc"], l: "es" as const }));
    const O = ["po", "so", "invoice", "type", "account", "contact", "stage", "priority", "store", "date", "pallets", "fee", "driver", "address", "windows"];
    const conUnRol = (filtros: FiltroGuardado[]) => valorDeColumnas({ visibles: { logistics: O }, orden: { logistics: O }, anchos: { logistics: Object.fromEntries(O.map((k) => [k, 800])) }, filtros });
    expect(bytesEnLaBase(conUnRol(normales))).toBeLessThan(4000);
    expect(cabeEnLaFila(conUnRol(normales))).toBe(true);
    const enorme = [{ n: "Todas las direcciones", c: { address: Array.from({ length: 300 }, (_, i) => `${1000 + i} East Some Long Street Name, Brownsville TX 78520`) } }];
    expect(cabeEnLaFila(conUnRol(enorme))).toBe(false);
  });
});

describe("guardar donde toque, y decirlo", () => {
  const destino = (o: Partial<DestinoDeFiltros> = {}) => {
    const base: FiltroGuardado[][] = [], navegador: FiltroGuardado[][] = [];
    const d: DestinoDeFiltros = {
      sinBase: false, baseLeida: true, filaCon: (lista) => ({ [CLAVE_DE_FILTROS]: lista }),
      guardaEnElNavegador: (lista) => { navegador.push(lista); }, escribe: async (lista) => { base.push(lista); return true; }, ...o,
    };
    return { d, base, navegador };
  };
  const L: FiltroGuardado[] = [{ n: "A" }];
  it("con base leída: al navegador (la red) Y a la base; sin texto", async () => {
    const { d, base, navegador } = destino();
    expect(await persisteFiltros(L, true, d, t)).toEqual({ guardado: "base", texto: null });
    expect(base).toEqual([L]);
    expect(navegador).toEqual([L]);
  });
  it("el demo: solo al navegador", async () => {
    const { d, base, navegador } = destino({ sinBase: true });
    expect(await persisteFiltros(L, true, d, t)).toEqual({ guardado: "navegador", texto: null });
    expect(base).toEqual([]);
    expect(navegador).toEqual([L]);
  });
  it("la base no se pudo leer: NO se escribe a ciegas (la fila va entera), queda en el navegador y se dice", async () => {
    const { d, base, navegador } = destino({ baseLeida: false });
    const r = await persisteFiltros(L, true, d, es);
    expect(r.guardado).toBe("navegador");
    expect(r.texto).toContain("queda solo en este navegador");
    expect(base).toEqual([]);
    expect(navegador).toEqual([L]);
  });
  it("la base no la aceptó: queda en el navegador y se dice", async () => {
    const { d } = destino({ escribe: async () => false });
    const r = await persisteFiltros(L, true, d, es);
    expect(r).toEqual({ guardado: "navegador", texto: expect.stringContaining("El servidor no contestó") });
  });
  it("si no cabe, no se escribe en NINGÚN sitio y se dice; borrar (no crece) se deja siempre", async () => {
    const lleno = { filaCon: () => ({ x: "y".repeat(8000) }) };
    const a = destino(lleno);
    expect(await persisteFiltros(L, true, a.d, t)).toEqual({ guardado: "no", texto: textoDelRechazoDeFiltro("no-cabe", t) });
    expect(a.base).toEqual([]);
    expect(a.navegador).toEqual([]);
    const b = destino(lleno);
    expect((await persisteFiltros([], false, b.d, t)).guardado).toBe("base");
  });
  it("ni navegador ni base: no se guardó, y la pantalla no lo enseña", async () => {
    const { d } = destino({ baseLeida: false, guardaEnElNavegador: () => { throw new Error("lleno"); } });
    expect((await persisteFiltros(L, true, d, t)).guardado).toBe("no");
  });
  it("al entrar: la base si se leyó (aunque venga vacía); si no, el navegador", () => {
    expect(filtrosAlEntrar({ leida: true, filtros: [] }, L)).toEqual([]);
    expect(filtrosAlEntrar({ leida: false, filtros: [] }, L)).toBe(L);
  });
  it("el navegador: una llave por persona, y un JSON roto no es ningún filtro", () => {
    expect(claveDeFiltrosEnElNavegador("u1")).toBe("rtg_filtros_ordenes_u1");
    expect(filtrosDelNavegador((k) => (k === "rtg_filtros_ordenes_u1" ? JSON.stringify([{ n: "A" }, { n: "" }]) : null), "u1")).toEqual([{ n: "A" }]);
    expect(filtrosDelNavegador(() => "{roto", "u1")).toEqual([]);
    expect(filtrosDelNavegador(() => null, "u1")).toEqual([]);
  });
  it("los rechazos, en los dos idiomas", () => {
    for (const m of ["sin-nombre", "lleno", "repetido", "no-existe", "no-cabe"] as const) expect(textoDelRechazoDeFiltro(m, t)).toMatch(/.+ \| .+/);
  });
});

// La pantalla usa las funciones: la prueba se alimenta de quien llama.
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n").replace(/\s+/g, " ");

describe("Órdenes usa los filtros guardados", () => {
  const p = leer("src/app/(app)/page.tsx");
  it("la tabla lleva la vista de la página: sus filtros y su orden son los que se guardan", () => {
    expect(p).toContain("vista={vistaTabla} onVista={setVistaTabla}");
    expect(p).toContain("const estadoDeOrdenes = { pastilla: filter, preset, vista: vistaTabla, lang };");
  });
  it("guardar y actualizar hacen la foto de lo que se ve con la función probada", () => {
    expect(p).toContain("const r = guardaFiltro(filtrosGuardados, nombre, fotoDeOrdenes(estadoDeOrdenes, conPastilla));");
    expect(p).toContain("const r = guardaFiltro(filtrosGuardados, antes.n, fotoDeOrdenes(estadoDeOrdenes, antes.f !== undefined));");
    expect(p).toContain("const r = renombraFiltro(filtrosGuardados, viejo, nuevo);");
    expect(p).toContain("cambiaFiltrosGuardados(borraFiltro(filtrosGuardados, nombre), false,");
  });
  it("lo que no quedó en ningún sitio no se pinta", () => {
    const c = p.slice(p.indexOf("const cambiaFiltrosGuardados = "), p.indexOf("const guardaFiltroActual"));
    expect(c).toContain("const r = await persisteFiltros(lista, crece, destinoDeFiltros, t);");
    // Primero que esté: un `indexOf` de −1 pasaría la prueba de orden.
    expect(c).toContain('if (r.guardado === "no") return { texto: r.texto ?? "", mal: true };');
    expect(c.indexOf('if (r.guardado === "no") return')).toBeLessThan(c.indexOf("setFiltrosGuardados(lista);"));
  });
  it("la fila entera, con las otras mitades tal como se leyeron, para medir si cabe", () => {
    expect(p).toContain("filaCon: (lista: FiltroGuardado[]) => valorDeColumnas({ visibles: prefsDeLaBase.current ?? {}, orden: ordenDeLaBase.current, anchos: anchosDeLaBase.current, plantillas: plantillasDeLaBase.current, filtros: lista }),");
    expect(p).toContain("guardaEnElNavegador: (lista: FiltroGuardado[]) => localStorage.setItem(claveDeFiltrosEnElNavegador(me!.id), JSON.stringify(lista)),");
  });
  it("los lee: del navegador al entrar, y de la base al leer la fila", () => {
    expect(p).toContain("const filtrosDeAqui = filtrosDelNavegador(");
    expect(p).toContain("filtrosDeLaBase.current = leido.filtros; setFiltrosGuardados(filtrosAlEntrar(leido, filtrosDeAqui));");
  });
  it("cada uno es una pastilla ★ en la fila, que se enciende si coincide y al pulsarla se aplica con las pastillas del rol", () => {
    const fila = p.slice(p.indexOf("{pastillas.map((p) => ("), p.indexOf("{view === \"table\" && avisoDeFiltro"));
    expect(fila).toContain("{filtrosGuardados.map((g) => {");
    expect(fila).toContain("const encendido = coincideConLaVista(g, estadoDeOrdenes);");
    expect(fila).toContain('className={"chip chip-guardado" + (encendido ? " on" : "")}');
    expect(fila).toContain("onClick={() => aplicaGuardado(g, encendido)}");
    const a = p.slice(p.indexOf("const aplicaGuardado = "), p.indexOf("// Who gets the checkbox column."));
    expect(a).toContain("pastillas: pastillas.map((p) => p.key),");
    expect(a).toContain('columnas: ["__id", ...ORDER_COLUMNS.map((c) => c.key)],');
    expect(a).toContain('visibles: ["__id", ...cols],');
    expect(a).toContain("if (r.pastilla !== null) setFilter(r.pastilla);");
    expect(a).toContain("if (r.preset !== null) setPreset(r.preset as Preset);");
    expect(a).toContain("setVistaTabla(r.vista);");
    expect(a).toContain("textoDeLoIgnorado(r.avisos, t, nombreDe)");
  });
});

describe("el panel ★", () => {
  const c = leer("src/components/FiltrosGuardados.tsx");
  it("guardar manda el nombre y la casilla de la pastilla tal como está", () => {
    expect(c).toContain("void haz(() => onGuardar(n, conPastilla), () => setNombre(\"\"));");
    expect(c).toContain("checked={conPastilla} onChange={(e) => setConPastilla(e.target.checked)}");
  });
  it("borrar pide confirmar: el ✕ solo pregunta, y borra el «Sí, borrar»", () => {
    expect(c).toContain("onClick={() => setBorrando(g.n)}>✕</button>");
    expect(c.split("onBorrar(").length - 1).toBe(1);
    const si = c.slice(c.indexOf("btn btn-danger btn-sm"), c.indexOf('t("Yes, delete", "Sí, borrar")'));
    expect(si).toContain("onBorrar(g.n)");
  });
  it("actualizar y renombrar llaman a lo suyo", () => {
    expect(c).toContain("onClick={() => void haz(() => onActualizar(g.n))}");
    expect(c).toContain("void haz(() => onRenombrar(r.viejo, r.nuevo.trim()), () => setRenombrando(null));");
  });
  it("un nombre repetido dice «Reemplazar», y con diez no se puede guardar otro", () => {
    expect(c).toContain("const reemplaza = !!filtroLlamado(lista, nombre);");
    expect(c).toContain("disabled={ocupado || !nombre.trim() || lleno}");
  });
});

describe("la tabla", () => {
  const tabla = leer("src/components/OrdersTable.tsx");
  it("con `vista` y `onVista` manda la de la página; sin ellas, la suya, como siempre", () => {
    expect(tabla).toContain("const vistaQueManda = vista && onVista ? vista : vistaPropia;");
    expect(tabla).toContain("const cambiaVista = vista && onVista ? onVista : setVistaPropia;");
    expect(tabla).toContain("const filters = vistaQueManda.filtros;");
    expect(tabla).toContain("const sortKey = vistaQueManda.orden?.clave ?? null;");
  });
  it("filtrar y ordenar pasan por la vista", () => {
    expect(tabla).toContain("cambiaVista({ ...vistaQueManda, orden: dir ? { clave: key, dir } : null });");
    expect(tabla).toContain('cambiaVista({ ...vistaQueManda, filtros: typeof cambio === "function" ? cambio(filters) : cambio })');
  });
});
