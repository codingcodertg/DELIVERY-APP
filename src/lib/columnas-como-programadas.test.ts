import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankDelivery } from "./blank-delivery";
import {
  CHOFER_DE_TODAS, COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V2, MARCA_V8, TABLA_DE_LAS_ORDENES,
  alternaColumna, columnasDeLaTabla, columnasDeLasOrdenes, columnasDePlantillaDelGestor, columnasDelSelector,
  columnasDelSelectorDeLasOrdenes, conColumnasNuevas, mueveEnElGestor, preferenciasDelGestorAlLeer, sinElNombreDeLaTabla,
} from "./routes-columns";
import { llegadaEnLasOrdenes, valorDelGestor } from "./valores-del-gestor";
import type { Delivery } from "./types";

/**
 * D-548 (2026-10-14): «Sin asignar» y «Todas» del Gestor de Rutas enseñan EXACTAMENTE las columnas de la tabla de paradas
 * («Programadas»). El dueño, 2026-10-13: «sin asignar y todas shou;d have the samea columns view as programadas»; y
 * 2026-10-14: «in sing asingar en in todas quiero que se miren exatamente las mismas columnas como en programadas estonces
 * cambialas». Las reglas, importadas; y que la pantalla las usa.
 */

const claves = (cs: readonly { key: string }[]) => cs.map((c) => c.key);
/** Lo que pinta la tabla de paradas de un chofer, tras sus fijas (número, factura, cuenta de pallets). */
const deParadas = (elegidas: readonly string[], orden?: readonly string[] | null) => claves(columnasDeLaTabla("paradas", elegidas, orden));
/** Lo que pinta «Sin asignar» tras sus fijas (factura y pallets). */
const deSinAsignar = (elegidas: readonly string[], orden?: readonly string[] | null) => claves(columnasDeLasOrdenes("sinAsignar", elegidas, orden)).slice(2);
const deTodas = (elegidas: readonly string[], orden?: readonly string[] | null) => claves(columnasDeLasOrdenes("todas", elegidas, orden)).slice(3);

describe("las mismas columnas que la tabla de paradas", () => {
  it("de partida: factura y pallets fijos delante, y Tipo, Ciudad de recogida, Ciudad de entrega, Llegada y Ventanas", () => {
    expect(claves(columnasDeLasOrdenes("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO)))
      .toEqual(["invoice", "pallets", "p_type", "p_ciudad_recogida", "p_address", "p_eta", "p_windows"]);
    expect(deSinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO)).toEqual(deParadas(COLUMNAS_DEL_GESTOR_POR_DEFECTO));
    expect(TABLA_DE_LAS_ORDENES).toBe("paradas");
  });
  it("«Todas» lleva el Chofer fijo delante (D-462) y lo demás igual que «Sin asignar»", () => {
    const todas = columnasDeLasOrdenes("todas", COLUMNAS_DEL_GESTOR_POR_DEFECTO);
    expect(todas[0]).toBe(CHOFER_DE_TODAS);
    expect(claves(todas).slice(1)).toEqual(claves(columnasDeLasOrdenes("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO)));
    expect(claves(columnasDeLasOrdenes("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO))).not.toContain("chofer");
  });
  it("los mismos rótulos que la cabecera de paradas: sin «Paradas: » / «Stops: »", () => {
    const cols = columnasDeLasOrdenes("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO);
    expect(cols.map((c) => c.es)).toEqual(["Factura #", "Pallets", "Tipo", "Ciudad de recogida", "Ciudad de entrega", "Llegada", "Ventanas"]);
    expect(cols.map((c) => c.en)).toEqual(["Invoice #", "Pallets", "Type", "Pickup city", "Delivery city", "ETA", "Windows"]);
    expect(sinElNombreDeLaTabla("Paradas: Etapa")).toBe("Etapa");
    expect(sinElNombreDeLaTabla("Etapa")).toBe("Etapa");
    // El catálogo no cambia: la clave guardada y el rótulo del ⚙ siguen siendo los de paradas.
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_eta")).toMatchObject({ en: "Stops: ETA", es: "Paradas: Llegada" });
  });
  it("el ⚙ es el de paradas, tal cual: las 14, en el orden de la persona, ninguna fija", () => {
    expect(claves(columnasDelSelectorDeLasOrdenes(null))).toEqual(claves(columnasDelSelector("paradas", null)));
    expect(columnasDelSelectorDeLasOrdenes(null)).toHaveLength(14);
    const movido = mueveEnElGestor("paradas", null, "p_windows", -1, COLUMNAS_DEL_GESTOR_POR_DEFECTO);
    expect(claves(columnasDelSelectorDeLasOrdenes(movido))).toEqual(claves(columnasDelSelector("paradas", movido)));
  });
});

describe("un solo ⚙: lo que se cambia en una tabla se ve en las tres", () => {
  it("marcar el Costo en el ⚙ lo pone en paradas, en «Sin asignar» y en «Todas»", () => {
    const con = alternaColumna(COLUMNAS_DEL_GESTOR_POR_DEFECTO, "p_fee");
    for (const t of [deParadas(con), deSinAsignar(con), deTodas(con)]) expect(t).toContain("p_fee");
    expect(deSinAsignar(con)).toEqual(deParadas(con));
    expect(deTodas(con)).toEqual(deParadas(con));
  });
  it("quitar la Llegada la quita de las tres", () => {
    const sin = alternaColumna(COLUMNAS_DEL_GESTOR_POR_DEFECTO, "p_eta");
    for (const t of [deParadas(sin), deSinAsignar(sin), deTodas(sin)]) expect(t).not.toContain("p_eta");
  });
  it("mover una columna (la flecha de cualquiera de los tres ⚙) la mueve en las tres", () => {
    const orden = mueveEnElGestor(TABLA_DE_LAS_ORDENES, null, "p_windows", -1, COLUMNAS_DEL_GESTOR_POR_DEFECTO);
    expect(deParadas(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden)).toEqual(["p_type", "p_ciudad_recogida", "p_address", "p_windows", "p_eta"]);
    expect(deSinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden)).toEqual(deParadas(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden));
    expect(deTodas(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden)).toEqual(deParadas(COLUMNAS_DEL_GESTOR_POR_DEFECTO, orden));
  });
  it("una plantilla aplicada pone las mismas columnas en las tres", () => {
    const puesta = columnasDePlantillaDelGestor(["invoice", "p_stage", "p_type"]);
    expect(deSinAsignar(puesta)).toEqual(["p_type", "p_stage"]);
    expect(deSinAsignar(puesta)).toEqual(deParadas(puesta));
  });
});

describe("lo guardado de cada persona (`user_prefs`, `routes_columns`)", () => {
  // Una lista como las de producción: lo de «Sin asignar» que eligió alguien, sus paradas y las marcas.
  const suyas = ["invoice", "account", "status", "so", "po", "p_type", "p_address", "p_windows", "p_fee", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", MARCA_V8];

  it("no hace falta tanda nueva: quien ya pasó por `_v8` no se reescribe al leer", () => {
    expect(preferenciasDelGestorAlLeer(suyas, null)).toEqual({ columnas: suyas, orden: null, escribe: false });
  });
  it("lo elegido para «Sin asignar» deja de decidir esa tabla: manda lo de paradas", () => {
    expect(deSinAsignar(suyas)).toEqual(["p_type", "p_address", "p_windows", "p_fee"]);
    expect(deSinAsignar(suyas)).not.toContain("account");
    expect(deSinAsignar(suyas)).toEqual(deParadas(suyas));
  });
  it("…pero no se borra: marcar una columna de paradas conserva las claves de «Sin asignar» en la lista guardada", () => {
    const tras = alternaColumna(suyas, "p_stage");
    for (const k of ["invoice", "account", "status", "so", "po"]) expect(tras, k).toContain(k);
  });
  it("nadie se queda con la tabla vacía: con cualquier lista, la factura y los pallets salen siempre", () => {
    const listas: (readonly string[])[] = [
      COLUMNAS_DEL_GESTOR_POR_DEFECTO,
      [MARCA_V2, "_v3", "_v4", "_v5", "_v6", "_v7", MARCA_V8],      // con todo quitado
      ["invoice", "account", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", MARCA_V8],   // solo cosas de «Sin asignar»
      conColumnasNuevas(["account"]),                                 // de antes de `_v2`: recibe las tandas
      [],
    ];
    for (const l of listas) {
      expect(claves(columnasDeLasOrdenes("sinAsignar", l)).slice(0, 2)).toEqual(["invoice", "pallets"]);
      expect(claves(columnasDeLasOrdenes("todas", l)).slice(0, 3)).toEqual(["chofer", "invoice", "pallets"]);
      expect(columnasDeLasOrdenes("sinAsignar", l).every((c, i) => i > 1 || c.fija)).toBe(true);
    }
    // Una lista de antes de las tandas recibe las de paradas (`_v2`, `_v8`): no se queda solo con las fijas.
    expect(deSinAsignar(conColumnasNuevas(["account"]))).toEqual(["p_type", "p_ciudad_recogida", "p_address", "p_eta", "p_windows"]);
  });
  it("un orden guardado de «Sin asignar» no mueve nada en estas tablas; el de paradas sí", () => {
    const soloSinAsignar = mueveEnElGestor("sinAsignar", null, "windows", -1, COLUMNAS_DEL_GESTOR_POR_DEFECTO);
    expect(soloSinAsignar).not.toBeNull();
    expect(deSinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO, soloSinAsignar)).toEqual(deSinAsignar(COLUMNAS_DEL_GESTOR_POR_DEFECTO));
  });
});

describe("la Llegada de una orden en estas tablas (`llegadaEnLasOrdenes`)", () => {
  const mk = (over: Partial<Delivery>) => blankDelivery({ stage: "approved", ...over });
  it("sin chofer: nada («—»), aunque la medida tuviera una hora", () => {
    expect(llegadaEnLasOrdenes(mk({ assigned_driver: null }), "10:30", true)).toBeNull();
  });
  it("con chofer: la que midió su ruta; sin medida, nada", () => {
    expect(llegadaEnLasOrdenes(mk({ assigned_driver: "Ana" }), "10:30", true)).toBe("10:30");
    expect(llegadaEnLasOrdenes(mk({ assigned_driver: "Ana" }), undefined, true)).toBeNull();
  });
  it("entregada: «✓» y la hora real, o «✓ entregada»; recogida: «🚚 en camino» — como su fila hecha en la tarjeta", () => {
    expect(llegadaEnLasOrdenes(mk({ assigned_driver: "Ana", stage: "delivered", pod_delivered_at: "2026-10-14T15:42:00Z" }), "09:00", true)).toBe("✓ 10:42");
    expect(llegadaEnLasOrdenes(mk({ assigned_driver: "Ana", stage: "delivered", pod_delivered_at: null }), "09:00", true)).toBe("✓ entregada");
    expect(llegadaEnLasOrdenes(mk({ assigned_driver: "Ana", stage: "delivered", pod_delivered_at: null }), null, false)).toBe("✓ delivered");
    // D-621: en el camión, la hora medida si la hay; sin medida, «en camino».
    expect(llegadaEnLasOrdenes(mk({ assigned_driver: "Ana", stage: "picked_up" }), "09:00", true)).toBe("09:00");
    expect(llegadaEnLasOrdenes(mk({ assigned_driver: "Ana", stage: "picked_up" }), null, true)).toBe("🚚 en camino");
  });
});

describe("ordenar y filtrar por las columnas de paradas (`valorDelGestor`)", () => {
  const d = blankDelivery({ order_type: "Builder", delivery_address: "1 Calle, Pharr TX", delivery_windows: "9-12", pickup_name: "RDZ Mission", store: "RDZ Mission" });
  const tiendas = [{ name: "RDZ Mission", address: "5 Conway Ave, Mission, TX 78572", lat: 26.2, lng: -98.3 }];
  it("cada una da lo que pinta su celda", () => {
    expect(valorDelGestor("p_type", d)).toBe("Builder");
    expect(valorDelGestor("p_address", d)).toBe("Pharr");
    expect(valorDelGestor("p_windows", d)).toBe("9-12");
    expect(valorDelGestor("p_ciudad_recogida", d, undefined, [], { tiendas })).toBe("Mission");
    expect(valorDelGestor("p_ciudad_recogida", d)).toBeNull();
    expect(valorDelGestor("p_eta", d, undefined, [], { llegada: () => "11:15" })).toBe("11:15");
    expect(valorDelGestor("p_eta", d)).toBeNull();
  });
});

describe("la pantalla", () => {
  const plano = (s: string) => s.replace(/\s+/g, " ");
  const pagina = plano(readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n"));
  const comun = pagina.slice(pagina.indexOf("const tablaDeOrdenes = (vista: VistaDeOrdenes) => {"), pagina.indexOf("const vistaDeSinAsignar: VistaDeOrdenes = {"));

  it("las dos vistas toman `columnasDeLasOrdenes` y el ⚙ de paradas, con sus rótulos y sus flechas", () => {
    expect(pagina).toContain('const colsSinAsignar = columnasDeLasOrdenes("sinAsignar", colsGestor, ordenGestor);');
    expect(pagina).toContain('const colsTodas = columnasDeLasOrdenes("todas", colsGestor, ordenGestor);');
    expect(pagina.split("selector: columnasDelSelectorDeLasOrdenes(ordenGestor)").length - 1).toBe(2);
    expect(comun).toContain("rotulo={(c) => sinElNombreDeLaTabla(lang === \"es\" ? c.es : c.en)}");
    expect(comun).toContain("mover={moverEn(TABLA_DE_LAS_ORDENES)}");
    // La tabla de paradas rotula con la MISMA función, en su cabecera y en su ⚙.
    expect(pagina).toContain("{colsParadas.map((c) => <th key={c.key}>{sinElNombreDeLaTabla(lang === \"es\" ? c.es : c.en)}");
    expect(pagina.split("rotulo={(c) => sinElNombreDeLaTabla(lang === \"es\" ? c.es : c.en)}").length - 1).toBe(2);
  });
  it("cada celda de paradas sale de `celdaDeParada`, la MISMA de la tabla de paradas; la llegada, de `llegadaDeLaOrden`", () => {
    expect(pagina.split("celdaDeParada(").length - 1).toBe(4);
    expect(comun).toContain("if (c.tablas.includes(TABLA_DE_LAS_ORDENES)) { const llegada = llegadaDeLaOrden(d); return celdaDeParada(c, d, { tipo: \"D\", llegada:");
    expect(comun).toContain("{llegada ?? \"—\"}</td> });");
    expect(pagina).toContain("return llegadaEnLasOrdenes(d, ruta ? routeEtas[ruta]?.[d.id] : null, lang === \"es\");");
    expect(pagina).toContain("const ruta = d.assigned_driver ? orderLaneKey(d) : null;");
  });
  it("las fijas: la factura como en paradas (con su ID), los pallets de la orden, y la fecha que se sigue cambiando", () => {
    // Nota D-574: la celda de la factura lleva ahora también el 📅 de Reprogramar, en línea; se parte en varias líneas.
    expect(comun).toContain('if (c.key === "invoice") return (');
    expect(comun).toMatch(/<td key=\{c\.key\} className="ordno">\s*\{facturaConSuId\(d\)\}/);
    expect(comun).toMatch(/\{etiquetaDeLaCarga\(d\)\}\s*<\/td>/);
    expect(comun).toContain('if (c.key === "pallets") return <td key={c.key} data-pallets-de-la-orden style={{ fontVariantNumeric: "tabular-nums" }}>{d.actual_pallets ?? d.est_pallets ?? "—"}</td>;');
    expect(comun).toContain('if (c.key === "p_date") return <td key={c.key} onClick={(e) => e.stopPropagation()}><DateCell d={d} date={date} onChange={reschedule} t={t} /></td>;');
    // La fecha va ANTES que el resto de paradas: si no, `celdaDeParada` la pintaría con la celda de Órdenes, sin editar.
    expect(comun.indexOf('if (c.key === "p_date")')).toBeLessThan(comun.indexOf("if (c.tablas.includes(TABLA_DE_LAS_ORDENES))"));
  });
  it("la llegada y el valor para ordenar se calculan tras la medida de las rutas (la que da `routeEtas`)", () => {
    const medida = pagina.indexOf("const { finDeLaRuta, routeInfo, routeStats, routeLines, routeEtas,");
    expect(medida).toBeGreaterThan(-1);
    expect(pagina.indexOf("const llegadaDeLaOrden = useCallback(")).toBeGreaterThan(medida);
    expect(pagina.indexOf("const valorDelGestorAqui = useCallback(")).toBeGreaterThan(pagina.indexOf("const llegadaDeLaOrden = useCallback("));
    expect(pagina).toContain("valorDelGestor(clave, d, deOrdenes, ciudadesQueSeConocen, { tiendas: settings.stores ?? [], llegada: llegadaDeLaOrden })");
  });
});
