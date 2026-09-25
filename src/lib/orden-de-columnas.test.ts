import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { columnasEnOrden, mueveColumna, ordenEfectivo } from "./orden-de-columnas";
import {
  CLAVE_DEL_ORDEN, ROLES_QUE_ELIGEN, columnasValidas, guardaColumnas, leeColumnas, prefsDeValor, valorDeColumnas, type ClienteDePrefs,
} from "./user-prefs";

/** Reordenar las columnas de la tabla de Órdenes (D-332). Los datos de aquí CONTRADICEN el orden canónico a propósito:
 *  una prueba de orden con datos ya ordenados pasa con la implementación equivocada. */

// Las claves del selector, leídas del componente (un .tsx no se puede importar desde aquí): de `ORDER_COLUMNS` a su cierre.
const fuente = readFileSync(join(process.cwd(), "src/components/OrdersTable.tsx"), "utf8");
const bloque = fuente.slice(fuente.indexOf("export const ORDER_COLUMNS"), fuente.indexOf("export const DEFAULT_COLUMNS"));
const ORDER_COLUMNS = [...bloque.matchAll(/\bkey: "(\w+)"/g)].map((m) => ({ key: m[1] }));      // también las que ocupan varias líneas

const CANON = ["stage", "type", "store", "account", "so", "date"];

describe("el orden de la persona", () => {
  it("sin nada guardado es el canónico, tal cual: nadie nota nada hasta que pulsa una flecha", () => {
    expect(ordenEfectivo(CANON, null)).toEqual(CANON);
    expect(ordenEfectivo(CANON, [])).toEqual(CANON);
  });
  it("lo guardado manda; una columna NUEVA que lo guardado no conoce entra al final; una que ya no existe se cae; sin repetidas", () => {
    expect(ordenEfectivo(CANON, ["date", "stage", "columna_retirada", "date", "account"])).toEqual(["date", "stage", "account", "type", "store", "so"]);
  });
  it("se PINTAN las visibles, en el orden de la persona — no en el canónico ni en el orden en que se marcaron", () => {
    const orden = ["date", "so", "account", "store", "type", "stage"];                      // el canónico, al revés
    expect(columnasEnOrden(["stage", "account", "date"], orden)).toEqual(["date", "account", "stage"]);
    expect(columnasEnOrden(["account", "date", "stage"], orden)).toEqual(["date", "account", "stage"]);      // el orden de marcado da igual
    expect(columnasEnOrden([], orden)).toEqual([]);
  });
  it("ocultar una columna y volver a mostrarla no le hace perder su sitio", () => {
    const orden = ["date", "account", "stage", "type", "store", "so"];
    expect(columnasEnOrden(["date", "stage"], orden)).toEqual(["date", "stage"]);
    expect(columnasEnOrden(["date", "stage", "account"], orden)).toEqual(["date", "account", "stage"]);
  });
});

describe("mover una columna", () => {
  const orden = ["date", "so", "account", "store"];
  it("sube o baja UN puesto, y devuelve una lista nueva", () => {
    expect(mueveColumna(orden, "account", -1)).toEqual(["date", "account", "so", "store"]);
    expect(mueveColumna(orden, "so", 1)).toEqual(["date", "account", "so", "store"]);
    expect(orden).toEqual(["date", "so", "account", "store"]);
  });
  it("en el tope no pasa nada; una clave desconocida, tampoco", () => {
    expect(mueveColumna(orden, "date", -1)).toEqual(orden);
    expect(mueveColumna(orden, "store", 1)).toEqual(orden);
    expect(mueveColumna(orden, "no_existe", 1)).toEqual(orden);
  });
  it("una columna VISIBLE salta por encima de las ocultas: una pulsación siempre se ve", () => {
    // so y account están ocultas. «store» sube: tiene que quedar delante de «date», no detrás de una oculta.
    expect(mueveColumna(orden, "store", -1, ["date", "store"])).toEqual(["store", "date", "so", "account"]);
    expect(mueveColumna(orden, "date", 1, ["date", "store"])).toEqual(["so", "account", "store", "date"]);
    // Si por encima solo hay ocultas, no hay adónde ir.
    expect(mueveColumna(["so", "account", "date"], "date", -1, ["date"])).toEqual(["so", "account", "date"]);
  });
  it("una columna OCULTA se mueve de a un puesto, sin saltar a nadie", () => {
    expect(mueveColumna(orden, "account", -1, ["date", "store"])).toEqual(["date", "account", "so", "store"]);
  });
});

describe("visibilidad y orden viven juntos y no se pisan", () => {
  const valor = { logistics: ["stage", "date"], admin: ["so"], [CLAVE_DEL_ORDEN]: { logistics: ["date", "stage", "so"], sales: ["type"], inventado: ["x"] }, sales: ["type"] };

  it("`_orden` NO es un rol: no se cuela en las visibles, ni en ningún bucle que recorra roles", () => {
    expect(ROLES_QUE_ELIGEN as readonly string[]).not.toContain(CLAVE_DEL_ORDEN);
    expect(Object.keys(columnasValidas(valor)).sort()).toEqual(["admin", "logistics"]);
    expect(prefsDeValor(valor)).toEqual({ visibles: { logistics: ["stage", "date"], admin: ["so"] }, orden: { logistics: ["date", "stage", "so"] }, anchos: {} });
  });
  it("el orden se sanea igual que la visibilidad: ni ventas, ni roles inventados, ni basura", () => {
    expect(prefsDeValor({ [CLAVE_DEL_ORDEN]: "texto" }).orden).toEqual({});
    expect(prefsDeValor({ [CLAVE_DEL_ORDEN]: ["stage"] }).orden).toEqual({});
    expect(prefsDeValor(null)).toEqual({ visibles: {}, orden: {}, anchos: {} });
  });
  it("ida y vuelta: lo que se guarda es lo que se lee; y sin orden elegido no se escribe `_orden`", () => {
    const p = { visibles: { logistics: ["stage", "date"] }, orden: { logistics: ["date", "stage"] } };
    expect(prefsDeValor(valorDeColumnas(p))).toEqual({ ...p, anchos: {} });
    expect(valorDeColumnas({ visibles: { logistics: ["stage"] }, orden: {} })).toEqual({ logistics: ["stage"] });
  });

  function cliente(fila: { value: unknown } | null) {
    const guardado: unknown[] = [];
    const c: ClienteDePrefs = { from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fila, error: null }) }) }) }),
      upsert: (f) => ({ select: async () => { guardado.push(f.value); return { data: [{ user_id: f.user_id }], error: null }; } }),
    }) };
    return { c, guardado };
  }
  it("GUARDAR LA VISIBILIDAD NO PISA EL ORDEN: quien marca una casilla pasa el orden que leyó, y sale intacto", async () => {
    const { c, guardado } = cliente({ value: valor });
    const leido = await leeColumnas(c, "yo");
    await guardaColumnas(c, "yo", { ...leido.columnas, logistics: ["stage", "date", "so"] }, "order_columns", leido.orden);
    expect(guardado[0]).toEqual({ logistics: ["stage", "date", "so"], admin: ["so"], [CLAVE_DEL_ORDEN]: { logistics: ["date", "stage", "so"] } });
  });
  it("GUARDAR EL ORDEN NO PISA LA VISIBILIDAD, ni el orden de OTRO rol", async () => {
    const { c, guardado } = cliente({ value: { ...valor, [CLAVE_DEL_ORDEN]: { logistics: ["date", "stage"], admin: ["so", "date"] } } });
    const leido = await leeColumnas(c, "yo");
    await guardaColumnas(c, "yo", leido.columnas, "order_columns", { ...leido.orden, logistics: ["stage", "date"] });
    expect(guardado[0]).toEqual({ logistics: ["stage", "date"], admin: ["so"], [CLAVE_DEL_ORDEN]: { logistics: ["stage", "date"], admin: ["so", "date"] } });
  });
  it("«Restablecer orden» BORRA el orden del rol —no lo iguala al canónico—, y el de los demás roles se queda", async () => {
    const { c, guardado } = cliente(null);
    await guardaColumnas(c, "yo", { logistics: ["stage"] }, "order_columns", { admin: ["so", "date"] });
    expect(guardado[0]).toEqual({ logistics: ["stage"], [CLAVE_DEL_ORDEN]: { admin: ["so", "date"] } });
  });

  it("el peor caso cabe de sobra en el tope de 8 KB de la base: todos los roles, todas las columnas, en los dos mapas", () => {
    const todas = ORDER_COLUMNS.map((c) => c.key);
    const lleno = Object.fromEntries(ROLES_QUE_ELIGEN.map((r) => [r, todas]));
    const bytes = Buffer.byteLength(JSON.stringify(valorDeColumnas({ visibles: lleno, orden: lleno })), "utf8");
    expect(todas).toHaveLength(14);                                                          // contadas: si el regex de arriba perdiera alguna, el «peor caso» mentiría
    expect(todas).toEqual(expect.arrayContaining(["date", "fee"]));                          // las dos que ocupan varias líneas en el fichero                                                // si el regex de arriba no casara, el «peor caso» sería vacío
    expect(bytes).toBeLessThan(8192 / 2);
    expect([ROLES_QUE_ELIGEN.length, todas.length, bytes]).toEqual([6, ORDER_COLUMNS.length, bytes]);      // el número va a la entrada
  });
});

describe("la tabla y la página", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n").replace(/\s+/g, " ");
  const tabla = leer("src/components/OrdersTable.tsx"), pagina = leer("src/app/(app)/page.tsx");

  it("la tabla pinta la `#` primera y FIJA, y después las visibles en el orden de la persona", () => {
    expect(tabla).toContain("const enOrden = columnasEnOrden(visible, ordenEfectivo(ORDER_COLUMNS.map((c) => c.key), orden));");
    expect(tabla).toContain("return [idCol, ...enOrden.map((k) => ORDER_COLUMNS.find((c) => c.key === k)!)];");
    expect(ORDER_COLUMNS.map((c) => c.key)).not.toContain("__id");                          // no está en el selector: no se puede mover
  });
  it("ventas no reordena: a la tabla le llega `null` y ve el orden canónico, como hasta hoy", () => {
    expect(pagina).toContain('orden={me?.role === "sales" ? null : orden}');
    expect(pagina).toContain('if (!me || me.role === "sales" || SIN_BASE || prefsDeLaBase.current === null) return;');
  });
  it("el selector lista en el orden de la persona, con flechas que usan la función probada y se apagan cuando no moverían nada", () => {
    expect(pagina).toContain("{ordenDelSelector.map((k) => ORDER_COLUMNS.find((c) => c.key === k)!).map((c) => (");
    expect(pagina).toContain("onClick={() => guardaOrden(mueveColumna(ordenDelSelector, c.key, -1, cols))}>↑</button>");
    expect(pagina).toContain("onClick={() => guardaOrden(mueveColumna(ordenDelSelector, c.key, 1, cols))}>↓</button>");
    expect(pagina).toContain("disabled={!seMueve(c.key, -1)}");
    expect(pagina).toContain("disabled={!seMueve(c.key, 1)}");
  });
  it("las dos mitades se guardan SIEMPRE juntas: al marcar una casilla va el orden, y al reordenar va la visibilidad", () => {
    // Desde D-338 (el ancho, la tercera mitad) la fila se escribe por UN solo sitio, con las tres mitades tal como están.
    // Desde D-394, con la cuarta mitad (las plantillas), tal como se leyó.
    expect(pagina).toContain("const escribeLaFila = () => guardaColumnas(createClient() as unknown as ClienteDePrefs, me!.id, prefsDeLaBase.current ?? {}, CLAVE_DE_COLUMNAS, ordenDeLaBase.current, anchosDeLaBase.current, plantillasDeLaBase.current);");
    expect(pagina.split("guardaColumnas(").length - 1).toBe(1);
    expect(pagina.split("escribeLaFila()").length - 1).toBe(6);                            // sembrar, marcar, reordenar, ensanchar, aplicar plantilla, guardar plantillas
  });
  it("«Restablecer orden» borra el orden del rol; y al leer la base llegan las dos mitades", () => {
    expect(pagina).toContain("if (next) todos[me.role] = next; else delete todos[me.role];");
    expect(pagina).toContain("{orden && <button className=\"notif-clear\" onClick={() => guardaOrden(null)}>");
    expect(pagina).toContain("ordenDeLaBase.current = leido.orden; anchosDeLaBase.current = leido.anchos; setOrden(leido.orden[rol] ?? null); setAnchos(leido.anchos[rol] ?? null);");
  });
});

describe("el orden de partida es el de la captura del dueño (D-347)", () => {
  it("las diez de la captura van en SU orden, y las cuatro que no lleva, junto a su vecina", async () => {
    const { ORDEN_DE_PARTIDA, enOrdenDePartida } = await import("./orden-de-columnas");
    const captura = ["po", "type", "account", "stage", "store", "date", "pallets", "driver", "address", "windows"];
    expect(ORDEN_DE_PARTIDA.filter((k) => captura.includes(k))).toEqual(captura);
    // Ordena el catálogo de verdad, que llega en OTRO orden (el de siempre, leído del fuente).
    const antes = ORDER_COLUMNS.map((c) => c.key);
    const despues = enOrdenDePartida(ORDER_COLUMNS.map((c) => ({ ...c }))).map((c) => c.key);
    expect(antes).not.toEqual(despues);
    expect(despues).toEqual([...ORDEN_DE_PARTIDA]);
  });
  it("cubre el catálogo entero; y una columna que la lista no conozca se va al final, no desaparece", async () => {
    const { ORDEN_DE_PARTIDA, enOrdenDePartida } = await import("./orden-de-columnas");
    expect([...ORDEN_DE_PARTIDA].sort()).toEqual(ORDER_COLUMNS.map((c) => c.key).sort());
    expect(enOrdenDePartida([{ key: "nueva" }, { key: "windows" }, { key: "po" }]).map((c) => c.key)).toEqual(["po", "windows", "nueva"]);
  });
  it("la tabla ordena su catálogo con esa función, y los defectos sin juego propio son los de la captura", () => {
    const tablaFuente = readFileSync(join(process.cwd(), "src/components/OrdersTable.tsx"), "utf8");
    expect(tablaFuente).toContain("enOrdenDePartida(ORDER_COLUMNS);");
    expect(tablaFuente).toContain('export const DEFAULT_COLUMNS = ["po", "type", "account", "stage", "store", "date", "pallets", "driver", "address", "windows"];');
  });
});
