import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BYTES_DE_UN_ROL_LLENO, MAX_PLANTILLAS, NOMBRES_RESERVADOS, RESERVA_PARA_LO_DEMAS, TOPE_DE_LA_BASE, aplicaEnOrdenes, borraPlantilla, bytesEnLaBase,
  cabeEnLaFila, claveDePlantillasEnElNavegador, guardaPlantilla, persistePlantillas, plantillaLlamada, plantillasDelNavegador, type DestinoDePlantillas,
} from "./plantillas-de-columnas";
import {
  CLAVE_DE_PLANTILLAS, MAX_NOMBRE_DE_PLANTILLA, ROLES_QUE_ELIGEN, TODOS_LOS_ROLES, columnasValidas, guardaColumnas, leeColumnas, plantillasDeValor,
  plantillasValidas, prefsDeValor, valorDeColumnas, type ClienteDePrefs, type PlantillaDeColumnas,
} from "./user-prefs";
import { COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V2, MARCA_V3, MARCA_V4, alternaColumna, columnasDePlantillaDelGestor, conColumnasNuevas, fotoDelGestor } from "./routes-columns";

/**
 * Las plantillas de ⚙ Columnas (D-NEXT), en Órdenes y en el Gestor de Rutas. El dueño: «add template in columns that will be
 * like [save] the current order so if they change it and then want to go back to the old one they can», y «logistic manager
 * needs to have the same template as in order view».
 */

// Las claves de Órdenes, leídas del componente (un .tsx no se importa desde aquí).
const fuente = readFileSync(join(process.cwd(), "src/components/OrdersTable.tsx"), "utf8");
const bloque = fuente.slice(fuente.indexOf("export const ORDER_COLUMNS"), fuente.indexOf("export const DEFAULT_COLUMNS"));
const ORD = [...bloque.matchAll(/\bkey: "(\w+)"/g)].map((m) => m[1]);
const t = (en: string, es: string) => `${en} | ${es}`;
const t0 = (_en: string, es: string) => es;

describe("guardar, reemplazar y borrar", () => {
  const A: PlantillaDeColumnas = { n: "Mañana", v: ["date", "stage"] };
  const B: PlantillaDeColumnas = { n: "Tarde", v: ["so"] };

  it("una nueva va AL FINAL, con la foto tal cual; la lista de entrada no se toca", () => {
    const lista = [A, B];
    const r = guardaPlantilla(lista, "  Noche  ", { v: ["po", "fee"], o: ["fee", "po"], a: { po: 90 } });
    expect(r).toEqual({ ok: true, reemplaza: false, lista: [A, B, { n: "Noche", v: ["po", "fee"], o: ["fee", "po"], a: { po: 90 } }] });
    expect(lista).toEqual([A, B]);
  });
  it("un nombre que ya existe —con otras mayúsculas o espacios— se REEMPLAZA en su sitio, no se duplica", () => {
    const r = guardaPlantilla([A, B], " mañana ", { v: ["po"] });
    expect(r).toEqual({ ok: true, reemplaza: true, lista: [{ n: "mañana", v: ["po"] }, B] });
    expect(plantillaLlamada([A, B], "  TARDE ")).toBe(B);
    expect(plantillaLlamada([A, B], "   ")).toBeUndefined();
  });
  it("sin nombre, o con el nombre del «Por defecto» fijo, no se guarda", () => {
    expect(guardaPlantilla([A], "   ", { v: ["po"] })).toEqual({ ok: false, motivo: "sin-nombre" });
    expect(guardaPlantilla([A], "Default", { v: ["po"] })).toEqual({ ok: false, motivo: "reservado" });
    expect(guardaPlantilla([A], " POR DEFECTO ", { v: ["po"] })).toEqual({ ok: false, motivo: "reservado" });
    expect(NOMBRES_RESERVADOS).toEqual(["default", "por defecto"]);
  });
  it(`hasta ${MAX_PLANTILLAS}: la que haría once se rechaza, pero reemplazar una de las diez sí se puede`, () => {
    expect(MAX_PLANTILLAS).toBe(10);
    const diez = Array.from({ length: 10 }, (_, i) => ({ n: `P${i}`, v: ["po"] }));
    expect(guardaPlantilla(diez.slice(0, 9), "nueva", { v: ["so"] }).ok).toBe(true);
    expect(guardaPlantilla(diez, "nueva", { v: ["so"] })).toEqual({ ok: false, motivo: "lleno" });
    expect(guardaPlantilla(diez, "p3", { v: ["so"] })).toMatchObject({ ok: true, reemplaza: true });
  });
  it("el nombre se corta a 40; y sin orden ni anchos, la foto no los lleva", () => {
    const r = guardaPlantilla([], "x".repeat(60), { v: ["po"], a: {} });
    expect(MAX_NOMBRE_DE_PLANTILLA).toBe(40);
    expect(r).toEqual({ ok: true, reemplaza: false, lista: [{ n: "x".repeat(40), v: ["po"] }] });
  });
  it("borrar quita solo esa, sin distinguir mayúsculas; una que no está no cambia nada", () => {
    expect(borraPlantilla([A, B], "TARDE")).toEqual([A]);
    expect(borraPlantilla([A, B], "otra")).toEqual([A, B]);
  });
});

describe("dónde vive: la cuarta mitad de la fila, sin migración", () => {
  it("se escribe como `_plantillas` junto a las otras tres, y se lee igual; sin plantillas no se escribe la clave", () => {
    const pl = [{ n: "Mía", v: ["date"], o: ["date", "so"], a: { date: 120 } }];
    const valor = valorDeColumnas({ visibles: { logistics: ["date"] }, orden: { logistics: ["date", "so"] }, anchos: { logistics: { date: 99 } }, plantillas: pl });
    expect(Object.keys(valor).sort()).toEqual(["_anchos", "_orden", CLAVE_DE_PLANTILLAS, "logistics"].sort());
    expect(plantillasDeValor(valor)).toEqual(pl);
    expect(CLAVE_DE_PLANTILLAS in valorDeColumnas({ visibles: { logistics: ["date"] }, orden: {} })).toBe(false);
  });
  it("`_plantillas` no es un rol: no se cuela en las columnas de nadie", () => {
    const valor = { logistics: ["date"], [CLAVE_DE_PLANTILLAS]: [{ n: "x", v: ["so"] }] };
    expect(columnasValidas(valor)).toEqual({ logistics: ["date"] });
    expect(prefsDeValor(valor)).toEqual({ visibles: { logistics: ["date"] }, orden: {}, anchos: {} });
  });
  it("lo leído se sanea: basura fuera, nombres repetidos fuera, y nunca más de diez", () => {
    expect(plantillasValidas("texto")).toEqual([]);
    expect(plantillasValidas([null, 3, { n: "", v: ["a"] }, { n: "sin columnas" }, { n: "ok", v: ["a"], o: "no", a: { a: "ancho" } }])).toEqual([{ n: "ok", v: ["a"] }]);
    expect(plantillasValidas([{ n: "Uno", v: ["a"] }, { n: " uno ", v: ["b"] }])).toEqual([{ n: "Uno", v: ["a"] }]);
    expect(plantillasValidas(Array.from({ length: 14 }, (_, i) => ({ n: `P${i}`, v: ["a"] })))).toHaveLength(10);
  });

  // «No reenviar lo leído» no aplica a una fila JSON que se escribe entera; lo que sí aplica es partir de lo leído y cambiar
  // solo lo propio. Se mide con una base falsa que guarda la fila.
  function baseCon(value: Record<string, unknown>) {
    const fila = { value };
    const cliente = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: fila.value }, error: null }) }) }) }),
        upsert: (f: { value: Record<string, unknown> }) => ({ select: async () => { fila.value = f.value; return { data: [{ user_id: "yo" }], error: null }; } }),
      }),
    } as unknown as ClienteDePrefs;
    return { cliente, fila };
  }
  const LLENA = valorDeColumnas({
    visibles: { logistics: ["date", "so"], admin: ["po"] }, orden: { logistics: ["so", "date"] }, anchos: { logistics: { date: 150 } },
    plantillas: [{ n: "Vieja", v: ["stage"] }],
  });
  it("guardar una plantilla NO borra visibles, orden ni anchos de ningún rol", async () => {
    const { cliente, fila } = baseCon(LLENA);
    const l = await leeColumnas(cliente, "yo");
    expect(l.plantillas).toEqual([{ n: "Vieja", v: ["stage"] }]);
    await guardaColumnas(cliente, "yo", l.columnas, "order_columns", l.orden, l.anchos, [...l.plantillas, { n: "Nueva", v: ["po"] }]);
    const antes = prefsDeValor(LLENA), despues = prefsDeValor(fila.value);
    expect(despues).toEqual(antes);
    expect(plantillasDeValor(fila.value).map((p) => p.n)).toEqual(["Vieja", "Nueva"]);
  });
  it("marcar una casilla pasando las plantillas leídas NO las borra; sin pasarlas, sí (por eso cada página escribe por un sitio)", async () => {
    const { cliente, fila } = baseCon(LLENA);
    const l = await leeColumnas(cliente, "yo");
    await guardaColumnas(cliente, "yo", { ...l.columnas, logistics: ["po"] }, "order_columns", l.orden, l.anchos, l.plantillas);
    expect(plantillasDeValor(fila.value)).toEqual([{ n: "Vieja", v: ["stage"] }]);
    await guardaColumnas(cliente, "yo", l.columnas, "order_columns", l.orden, l.anchos);
    expect(plantillasDeValor(fila.value)).toEqual([]);
  });
});

describe("el tope de la base: `pg_column_size(value) < 8192` (136)", () => {
  // Los casos, construidos aquí igual que se construyeron para medirlos en un Postgres 17 local el 2026-09-25
  // (`select pg_column_size('<json>'::jsonb)`, y el `insert` contra un `check` igual al de la 136). Los números de la derecha
  // son los que dio Postgres, no los de esta función: si alguien la cambia, tiene que seguir dándolos.
  const ANCH = Object.fromEntries(["__id", ...ORD].map((k) => [k, 800]));
  const nombre = (i: number) => (`Plantilla número ${i} `).padEnd(40, "x");
  const llenas = (n: number) => Array.from({ length: n }, (_, i) => ({ n: nombre(i), v: ORD, o: ORD, a: ANCH }));
  const roles = (rs: readonly string[], x: unknown) => Object.fromEntries(rs.map((r) => [r, x]));
  const unRol = (pl: PlantillaDeColumnas[]) => valorDeColumnas({ visibles: { logistics: ORD }, orden: { logistics: ORD }, anchos: { logistics: ANCH }, plantillas: pl });
  const O14 = ["po", "so", "invoice", "type", "account", "contact", "stage", "store", "date", "pallets", "fee", "driver", "address", "windows"];
  const GEST = ["invoice", "account", "address", "pickup", "store", "pallets", "date", "windows", "status", "p_type", "p_eta", "p_fee"];
  const casos: [string, unknown, number][] = [
    ["Órdenes, un rol lleno, 10 plantillas llenas", unRol(llenas(10)), 7561],
    ["Órdenes, un rol lleno, sin plantillas", unRol([]), 697],
    ["Órdenes, todos los roles llenos, sin plantillas", valorDeColumnas({ visibles: roles(ROLES_QUE_ELIGEN, ORD), orden: roles(ROLES_QUE_ELIGEN, ORD), anchos: roles(TODOS_LOS_ROLES, ANCH) }), 4241],
    ["Órdenes, todos los roles llenos, 10 plantillas llenas (la base la RECHAZA)", valorDeColumnas({ visibles: roles(ROLES_QUE_ELIGEN, ORD), orden: roles(ROLES_QUE_ELIGEN, ORD), anchos: roles(TODOS_LOS_ROLES, ANCH), plantillas: llenas(10) }), 11105],
    ["Gestor, todos los roles, 10 plantillas de todas sus columnas", valorDeColumnas({
      visibles: roles(ROLES_QUE_ELIGEN, [...COLUMNAS_DEL_GESTOR.map((c) => c.key), MARCA_V2, MARCA_V3, MARCA_V4]), orden: {},
      plantillas: Array.from({ length: 10 }, (_, i) => ({ n: nombre(i), v: COLUMNAS_DEL_GESTOR.map((c) => c.key) })),
    }), 5343],
    ["Órdenes, lo normal: un rol, 10 plantillas con nombres cortos y 2 anchos", valorDeColumnas({
      visibles: { accounting: O14.slice(0, 8) }, orden: { accounting: [...O14].reverse() }, anchos: { accounting: { po: 90, date: 120, __id: 64 } },
      plantillas: Array.from({ length: 10 }, (_, i) => ({ n: `Revisión mañana ${i + 1}`, v: O14.slice(0, 8 - (i % 3)), o: [...O14].reverse(), a: { po: 90 + i, date: 120 } })),
    }), 3531],
    ["Gestor, lo normal: un rol, 10 plantillas", valorDeColumnas({
      visibles: { logistics: ["invoice", "account", "address", "pickup", "store", "pallets", "date", "windows", "status", "p_type", "p_eta", "_v2", "_v3", "_v4"] }, orden: {},
      plantillas: Array.from({ length: 10 }, (_, i) => ({ n: `Logística ${i + 1}`, v: GEST.slice(0, 12 - i) })),
    }), 1401],
    ["números de 2 a 5 cifras, un 10000, texto con acentos", { a: { b: 40, cc: 99, d: 100, eee: 800, f: 10000, g: 12345 }, h: [1, "x", 2], "ñ": "á" }, 190],
  ];
  for (const [nombreDelCaso, valor, medido] of casos) {
    it(`da lo que midió Postgres: ${nombreDelCaso} → ${medido}`, () => {
      expect(ORD).toHaveLength(14);                                                              // si el regex perdiera columnas, el caso mentiría
      expect(bytesEnLaBase(valor)).toBe(medido);
    });
  }
  it("el texto NO sirve de medida: la fila más cargada ocupa en la base un 43 % más que su JSON", () => {
    const v = unRol(llenas(10));
    expect(new TextEncoder().encode(JSON.stringify(v)).length).toBe(5294);
    expect(bytesEnLaBase(v)).toBe(7561);
  });
  it("la guarda deja sitio para lo demás: en el peor caso caben 9 plantillas llenas, la décima no; lo normal, las 10 con holgura", () => {
    expect(TOPE_DE_LA_BASE).toBe(8192);
    expect(RESERVA_PARA_LO_DEMAS).toBeGreaterThan(BYTES_DE_UN_ROL_LLENO);
    expect(BYTES_DE_UN_ROL_LLENO).toBe(bytesEnLaBase(unRol([])));
    expect(cabeEnLaFila(unRol(llenas(9)))).toBe(true);
    expect(cabeEnLaFila(unRol(llenas(10)))).toBe(false);
    expect(cabeEnLaFila(casos[5][1] as Record<string, unknown>)).toBe(true);
    expect(cabeEnLaFila(casos[6][1] as Record<string, unknown>)).toBe(true);
    expect(bytesEnLaBase(unRol(llenas(9))) + RESERVA_PARA_LO_DEMAS).toBeLessThan(8192);
  });
});

describe("guardar donde toque, y decirlo si no se pudo", () => {
  const destino = (o: Partial<DestinoDePlantillas> & { escrito?: PlantillaDeColumnas[][]; navegador?: PlantillaDeColumnas[][] } = {}) => {
    const escrito: PlantillaDeColumnas[][] = o.escrito ?? [], navegador: PlantillaDeColumnas[][] = o.navegador ?? [];
    const d: DestinoDePlantillas = {
      sinBase: false, baseLeida: true, filaCon: (lista) => ({ [CLAVE_DE_PLANTILLAS]: lista }),
      guardaEnElNavegador: (lista) => { navegador.push(lista); }, escribe: async (lista) => { escrito.push(lista); return true; }, ...o,
    };
    return { d, escrito, navegador };
  };
  const una = [{ n: "Mía", v: ["po"] }];
  it("con base leída: escribe en la base y dice que quedó (`null`)", async () => {
    const { d, escrito, navegador } = destino();
    expect(await persistePlantillas(una, true, d, t)).toBeNull();
    expect(escrito).toEqual([una]);
    expect(navegador).toEqual([]);
  });
  it("el demo (sin base): al navegador, y nada a la base", async () => {
    const { d, escrito, navegador } = destino({ sinBase: true, baseLeida: false });
    expect(await persistePlantillas(una, true, d, t)).toBeNull();
    expect(navegador).toEqual([una]);
    expect(escrito).toEqual([]);
  });
  it("sin la base leída no se escribe a ciegas: la fila se escribe entera y se llevaría lo que hubiera", async () => {
    const { d, escrito } = destino({ baseLeida: false });
    expect(await persistePlantillas(una, true, d, t0)).toContain("Recargue");
    expect(escrito).toEqual([]);
  });
  it("si no cabe, no se escribe y se dice; pero BORRAR (no crece) se deja siempre, aunque la fila ya esté llena", async () => {
    const enorme = { relleno: "x".repeat(8000) };
    const { d, escrito } = destino({ filaCon: () => enorme });
    expect(await persistePlantillas(una, true, d, t0)).toBe("No cabe: borre una plantilla para hacer sitio.");
    expect(escrito).toEqual([]);
    expect(await persistePlantillas([], false, d, t0)).toBeNull();
    expect(escrito).toEqual([[]]);
  });
  it("si la base no la acepta, se dice: la pantalla no enseña una plantilla que al recargar no estaría", async () => {
    const { d } = destino({ escribe: async () => false });
    expect(await persistePlantillas(una, true, d, t0)).toBe("No se pudo guardar. Inténtelo otra vez.");
  });
  it("el navegador del demo: una llave por pantalla, y un JSON roto no es ninguna plantilla", () => {
    expect(claveDePlantillasEnElNavegador("order_columns")).toBe("rtg_plantillas_order_columns");
    expect(plantillasDelNavegador((k) => (k === "rtg_plantillas_routes_columns" ? JSON.stringify(una) : null), "routes_columns")).toEqual(una);
    expect(plantillasDelNavegador(() => "{roto", "routes_columns")).toEqual([]);
  });
});

describe("aplicar", () => {
  it("Órdenes: pone EXACTAMENTE la foto; lo que ya no existe se cae; sin orden o sin anchos, los de la app", () => {
    const claves = ["po", "so", "date"];
    expect(aplicaEnOrdenes({ n: "x", v: ["date", "vieja", "po"], o: ["date", "vieja", "so", "po"], a: { date: 130, vieja: 99, __id: 70 } }, claves))
      .toEqual({ visibles: ["date", "po"], orden: ["date", "so", "po"], anchos: { date: 130, __id: 70 } });
    expect(aplicaEnOrdenes({ n: "x", v: ["so"] }, claves)).toEqual({ visibles: ["so"], orden: null, anchos: {} });
  });
  it("Gestor: las columnas de la foto que existen, en el orden del catálogo, CON las marcas — y recargar no le añade las quitadas", () => {
    const foto = fotoDelGestor(alternaColumna(alternaColumna([...COLUMNAS_DEL_GESTOR_POR_DEFECTO], "address"), "fee"));
    expect(foto).not.toContain("address");
    expect(foto).not.toContain("fee");
    expect(foto.some((k) => k.startsWith("_"))).toBe(false);
    const puesta = columnasDePlantillaDelGestor(["fee", "retirada", ...foto]);
    expect(puesta.slice(-3)).toEqual([MARCA_V2, MARCA_V3, MARCA_V4]);
    expect(puesta).toContain("fee");
    expect(puesta).not.toContain("retirada");
    expect(conColumnasNuevas(columnasDePlantillaDelGestor(foto))).not.toContain("address");   // sin marcas, `conColumnasNuevas` la devolvería
    expect(columnasDePlantillaDelGestor(["contact", "invoice"]).slice(0, 2)).toEqual(["invoice", "contact"]);  // contradice el orden de entrada
  });
});

// Las pantallas usan las funciones: la prueba se alimenta de quien llama.
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n").replace(/\s+/g, " ");

describe("Órdenes usa las plantillas", () => {
  const p = leer("src/app/(app)/page.tsx");
  it("el bloque está en el menú de ⚙ Columnas, con sus tres acciones", () => {
    const menu = p.slice(p.indexOf('<div className="col-menu">'), p.indexOf("{ordenDelSelector.map("));
    expect(menu).toContain("<PlantillasDeColumnas plantillas={plantillas} onAplicar={aplicaPlantilla} onGuardar={guardaPlantillaActual} onBorrar={borraPlantillaGuardada} t={t} />");
  });
  it("aplicar: la función probada, o el defecto del rol con orden canónico y anchos de partida; y se escribe con las mitades de este rol", () => {
    const a = p.slice(p.indexOf("const aplicaPlantilla = "), p.indexOf("const destinoDePlantillas"));
    expect(a).toContain("const r = p ? aplicaEnOrdenes(p, ORDER_COLUMNS.map((c) => c.key)) : { visibles: defaultColsFor(me.role), orden: null, anchos: {} };");
    expect(a).toContain("setCols(r.visibles); setOrden(r.orden); setAnchos(r.anchos);");
    expect(a).toContain("if (r.orden) ordenes[me.role] = r.orden; else delete ordenes[me.role];");
    expect(a).toContain("if (Object.keys(r.anchos).length) anchosTodos[me.role] = r.anchos; else delete anchosTodos[me.role];");
    expect(a).toContain("if (SIN_BASE || prefsDeLaBase.current === null) return;");
    expect(a).toContain("void escribeLaFila();");
  });
  it("guardar: la foto de lo que se ve —columnas, orden y anchos—, por `persistePlantillas`, con la fila entera como quedaría", () => {
    expect(p).toContain("const r = guardaPlantilla(plantillasDeLaBase.current, nombre, { v: cols, o: orden ?? undefined, a: anchosQueSeVen });");
    expect(p).toContain("return r.ok ? cambiaPlantillas(r.lista, true) : Promise.resolve(textoDelRechazo(r.motivo, t));");
    expect(p).toContain("const problema = await persistePlantillas(lista, crece, destinoDePlantillas, t); if (problema) return problema; plantillasDeLaBase.current = lista; setPlantillas(lista);");
    expect(p).toContain("filaCon: (lista: PlantillaDeColumnas[]) => valorDeColumnas({ visibles: prefsDeLaBase.current ?? {}, orden: ordenDeLaBase.current, anchos: anchosDeLaBase.current, plantillas: lista }),");
    expect(p).toContain("baseLeida: prefsDeLaBase.current !== null,");
    expect(p).toContain("const borraPlantillaGuardada = (nombre: string) => cambiaPlantillas(borraPlantilla(plantillasDeLaBase.current, nombre), false);");
  });
  it("lee las plantillas: de la base al leer la fila, y del navegador en el demo", () => {
    expect(p).toContain("plantillasDeLaBase.current = leido.plantillas; setPlantillas(leido.plantillas);");
    expect(p).toContain("plantillasDeLaBase.current = SIN_BASE ? plantillasDelNavegador(");
    expect(p).toContain("localStorage.setItem(claveDePlantillasEnElNavegador(CLAVE_DE_COLUMNAS), JSON.stringify(lista))");
  });
  it("lo arrastrado se refleja en `anchos`: si no, re-aplicar una plantilla con los mismos anchos no los devolvería", () => {
    const g = p.slice(p.indexOf("const guardaAnchos = "), p.indexOf("const ordenDelSelector"));
    expect(g.indexOf("setAnchos(next);")).toBeGreaterThanOrEqual(0);
    expect(g.indexOf("setAnchos(next);")).toBeLessThan(g.indexOf("if (!me || SIN_BASE"));
  });
});

describe("el Gestor usa las MISMAS plantillas", () => {
  const p = leer("src/app/(app)/routes/page.tsx");
  it("los dos ⚙ (Sin asignar y paradas) llevan el bloque", () => {
    expect(p.split("plantillas={propsDePlantillas}").length - 1).toBe(2);
    expect(p.split("<SelectorDeColumnas").length - 1).toBe(2);
  });
  it("aplicar, guardar y borrar usan las funciones probadas", () => {
    expect(p).toContain("const next = p ? columnasDePlantillaDelGestor(p.v) : [...COLUMNAS_DEL_GESTOR_POR_DEFECTO];");
    expect(p).toContain("const r = guardaPlantilla(plantillasDelGestor.current, nombre, { v: fotoDelGestor(colsGestor) });");
    expect(p).toContain("onBorrar: (nombre: string) => cambiaPlantillasDelGestor(borraPlantilla(plantillasDelGestor.current, nombre), false),");
    expect(p).toContain("const problema = await persistePlantillas(lista, crece, destinoDelGestor, t);");
    expect(p).toContain("filaCon: (lista: PlantillaDeColumnas[]) => valorDeColumnas({ visibles: prefsDelGestor.current ?? {}, orden: {}, plantillas: lista }),");
  });
  it("las lee de la base con la fila, y del navegador en el demo", () => {
    expect(p).toContain("plantillasDelGestor.current = leido.plantillas; setPlantillasGestor(leido.plantillas);");
    expect(p).toContain("plantillasDelGestor.current = plantillasDelNavegador(");
  });
});

describe("el bloque", () => {
  const c = leer("src/components/PlantillasDeColumnas.tsx");
  const s = leer("src/components/SelectorDeColumnas.tsx");
  it("el ⚙ del Gestor lo pinta arriba, bajo el título, si le llegan plantillas", () => {
    expect(s).toContain('<div className="col-menu-head"><b>{titulo}</b></div> {plantillas && <PlantillasDeColumnas {...plantillas} t={t} />}');
  });
  it("«Por defecto» está siempre y aplica `null`", () => {
    expect(c).toContain('className="plantilla-col plantilla-col-defecto" onClick={() => aplicar(null)}');
  });
  it("borrar pide confirmar: el ✕ solo pregunta, y borra el «Sí, borrar»", () => {
    expect(c).toContain("onClick={() => setBorrando(p.n)}>✕</button>");
    expect(c).toContain('onClick={() => void borrar(p.n)}>{t("Yes, delete", "Sí, borrar")}</button>');
    expect(c.split("onBorrar(").length - 1).toBe(1);
    expect(c).toContain("const borrar = async (n: string) => { setBorrando(null); const problema = await onBorrar(n);");
  });
  it("un nombre repetido dice «Reemplazar», y con diez no se puede guardar otra", () => {
    expect(c).toContain('{reemplaza ? t("Replace", "Reemplazar") : t("Save", "Guardar")}');
    expect(c).toContain("const lleno = plantillas.length >= MAX_PLANTILLAS && !reemplaza;");
    expect(c).toContain("disabled={ocupado || !nombre.trim() || lleno}");
  });
  it("lo que no se guardó no se da por guardado: el mensaje de éxito solo sin problema", () => {
    expect(c).toContain("if (problema) { setAviso({ texto: problema, mal: true }); return; }");
  });
});
