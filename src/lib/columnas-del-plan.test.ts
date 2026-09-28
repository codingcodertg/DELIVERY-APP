import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORDEN_DE_PARTIDA } from "./orden-de-columnas";
import {
  COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, ORDEN_DE_PARTIDA_DEL_GESTOR, SOLO_DE_LA_ENTREGA, alternaColumna, columnaDeOrdenes,
  columnasDeLaTabla, columnasDePlantillaDelGestor, columnasDelSelector, conColumnasNuevas, fotoDePlantillaDelGestor, mueveEnElGestor,
  ordenDeLaTabla, ordenDePlantillaDelGestor, restableceOrdenDelGestor, seVeEnLaRecogida, tieneOrdenPropio,
} from "./routes-columns";
import { CLAVES_DE_PREFERENCIA, CLAVE_DE_COLUMNAS_DEL_GESTOR } from "./user-prefs";

/**
 * D-429: la tabla del PLANIFICADOR con las columnas de Órdenes. El dueño, 2026-09-28: «quiero que en el planificador salga
 * las mismas tables como en orden como te lo habia pedido sabajo» — «Las mismas que Órdenes» — «y que yo pueda editar las
 * columas cambiar ordenes y hasta dejar templates».
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const claves = (elegidas: readonly string[], orden: readonly string[] | null = null) => columnasDeLaTabla("plan", elegidas, orden).map((c) => c.key);
const PROPIAS = ["pl_horas", "pl_ventana", "pl_tramo", "pl_bordo"];
/** Las dos que Órdenes no tiene y van delante (D-434): el tipo de cliente y la ciudad de recogida. */
const DELANTE = ["pl_clase", "pl_ciudad_recogida", "pl_ciudad_entrega"];   // y la de entrega desde D-435

describe("las columnas: las de Órdenes, en el orden de Órdenes", () => {
  it("la tabla del plan tiene TODAS las de Órdenes en el orden de partida de Órdenes, y detrás las cuatro propias del plan", () => {
    // Desde D-434, delante, las dos que Órdenes no tiene.
    expect(ORDEN_DE_PARTIDA_DEL_GESTOR.plan).toEqual([...DELANTE, ...ORDEN_DE_PARTIDA.map((k) => `pl_${k}`), ...PROPIAS]);
    // Cada una pinta la celda de SU columna de Órdenes.
    const catalogo = ORDEN_DE_PARTIDA.map((key) => ({ key }));
    for (const k of ORDEN_DE_PARTIDA) expect(columnaDeOrdenes(`pl_${k}`, catalogo)?.key, k).toBe(k);
    for (const k of [...DELANTE, ...PROPIAS]) expect(columnaDeOrdenes(k, catalogo), k).toBeUndefined();
  });

  // D-429 veía de partida las de ventas en Órdenes. Reemplazado por D-434: las que pidió el dueño (describe de abajo).
  it("las cuatro del plan nacen escondidas", () => {
    for (const k of PROPIAS) expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO, k).not.toContain(k);
  });

  it("las cuatro de antes siguen existiendo: se eligen en ⚙ y salen donde diga el orden", () => {
    expect(columnasDelSelector("plan", null).map((c) => c.key)).toEqual(ORDEN_DE_PARTIDA_DEL_GESTOR.plan);
    const conHoras = alternaColumna(COLUMNAS_DEL_GESTOR_POR_DEFECTO, "pl_horas");
    expect(claves(conHoras).slice(-1)).toEqual(["pl_horas"]);
  });

  it("quien ya había guardado sus columnas recibe las del plan UNA vez; si luego las quita, no le vuelven", () => {
    const deAntes = ["invoice", "pallets", "_v2", "_v3", "_v4"];
    expect(claves(conColumnasNuevas(deAntes))).toEqual(claves(COLUMNAS_DEL_GESTOR_POR_DEFECTO));
    const sinFactura = alternaColumna(conColumnasNuevas(deAntes), "pl_invoice");
    expect(claves(conColumnasNuevas(sinFactura))).not.toContain("pl_invoice");
  });
});

describe("mover columnas y plantillas: el mismo mecanismo que el resto del Gestor", () => {
  const elegidas = COLUMNAS_DEL_GESTOR_POR_DEFECTO;
  /** Pulsar la flecha n veces (negativo = arriba), como la persona. */
  const mueve = (clave: string, veces: number, orden: string[] | null = null, cuales: readonly string[] = elegidas) => {
    for (let i = 0; i < Math.abs(veces); i++) orden = mueveEnElGestor("plan", orden, clave, veces < 0 ? -1 : 1, cuales);
    return orden;
  };

  it("mover una columna del plan cambia SOLO el plan; «Restablecer orden» la devuelve", () => {
    const orden = mueve("pl_windows", -2);
    expect(claves(elegidas, orden)).toEqual(["pl_clase", "pl_ciudad_recogida", "pl_ciudad_entrega", "pl_windows", "pl_invoice", "pl_address"]);
    expect(ordenDeLaTabla("sinAsignar", orden)).toEqual(ordenDeLaTabla("sinAsignar", null));
    expect(ordenDeLaTabla("paradas", orden)).toEqual(ordenDeLaTabla("paradas", null));
    expect(tieneOrdenPropio("plan", orden)).toBe(true);
    expect(restableceOrdenDelGestor("plan", orden)).toBeNull();
  });

  it("una plantilla guarda qué columnas del plan se ven y su orden, y al aplicarla vuelven los dos", () => {
    const orden = mueve("pl_windows", -9);
    const conPo = alternaColumna(alternaColumna(elegidas, "pl_po"), "pl_invoice");
    const foto = fotoDePlantillaDelGestor(conPo, orden);
    const puestas = columnasDePlantillaDelGestor(foto.v);
    expect(claves(puestas, ordenDePlantillaDelGestor(foto.o))).toEqual(claves(conPo, orden));
    expect(claves(puestas)).toContain("pl_po");
    expect(claves(puestas)).not.toContain("pl_invoice");
  });

  it("una plantilla de ANTES (sin ninguna columna del plan) recibe las del plan por defecto, en vez de dejarlo vacío", () => {
    expect(claves(columnasDePlantillaDelGestor(["invoice", "account", "p_type"]))).toEqual(claves(COLUMNAS_DEL_GESTOR_POR_DEFECTO));
    expect(claves(columnasDePlantillaDelGestor(["invoice", "pl_po"]))).toEqual(["pl_po"]);
  });

  it("se guarda en la MISMA preferencia que el resto del Gestor: ninguna clave nueva de `user_prefs`", () => {
    expect(CLAVE_DE_COLUMNAS_DEL_GESTOR).toBe("routes_columns");
    expect([...CLAVES_DE_PREFERENCIA]).toContain("routes_columns");
    expect(COLUMNAS_DEL_GESTOR.every((c) => c.key.length <= 40)).toBe(true);           // `esLista` de user-prefs
    expect(COLUMNAS_DEL_GESTOR.length).toBeLessThanOrEqual(60 - 5);                    // MAX_COLUMNAS, con las marcas
  });
});

describe("la fila de RECOGIDA (P)", () => {
  it("lo de la entrega —dirección, ventanas, contacto, y la ciudad de entrega (D-435)— no se pinta en una recogida; lo de la orden, sí; y las demás propias del plan, siempre", () => {
    expect([...SOLO_DE_LA_ENTREGA]).toEqual(["address", "windows", "contact"]);
    const enP = COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("plan") && seVeEnLaRecogida(c)).map((c) => c.key);
    expect(enP).toEqual([...DELANTE.filter((k) => k !== "pl_ciudad_entrega"),"pl_po", "pl_so", "pl_invoice", "pl_type", "pl_account", "pl_stage", "pl_priority", "pl_store", "pl_date", "pl_pallets", "pl_fee", "pl_driver", ...PROPIAS]);
  });
});

describe("la pantalla usa esto", () => {
  const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
  const vista = plano(leer("src/components/RutaDelPlan.tsx"));

  it("la página le pasa al plan SUS columnas, su ⚙ con las flechas del plan y las MISMAS plantillas del Gestor", () => {
    const bloque = pagina.slice(pagina.indexOf("<PlanDelDia"), pagina.indexOf("}} />", pagina.indexOf("<PlanDelDia")));
    // Desde D-434 la celda es `celdaDelPlan`: las dos propias y, las demás, la de Órdenes (describe de abajo).
    expect(bloque).toContain('lista: columnasDeLaTabla("plan", colsGestor, ordenGestor), celda: celdaDelPlan, clase: clasePastillas');
    expect(bloque).toContain('columnas={columnasDelSelector("plan", ordenGestor)}');
    expect(bloque).toContain("elegidas={colsGestor} onAlterna={alternaColumnaDelGestor}");
    expect(bloque).toContain("plantillas={propsDePlantillas}");
    expect(bloque).toContain('mover={moverEn("plan")}');
  });

  it("la tabla pinta la lista que le dan, en su orden, y en una recogida deja vacío lo de la entrega", () => {
    expect(vista).toContain("{lista.map((c) => <th key={c.key} data-columna-del-plan={c.key}>{rotulo(c)}</th>)}");
    expect(vista).toContain("{lista.map((c) => celda(c, p, k))}");
    expect(vista).toContain('if (p.kind === "P" && !seVeEnLaRecogida(c)) return <td key={c.key} data-solo-entrega />;');
    expect(vista).toContain("{columnas?.selector && <div data-columnas-del-plan style={{ textAlign: \"right\" }}>{columnas.selector}</div>}");
  });
});
