import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V6, MARCA_V7, MARCA_V8, ORDEN_DE_PARTIDA_DEL_GESTOR, alternaColumna,
  columnasDeLaTabla, columnasDePlantillaDelGestor, conCiudadDeRecogidaEnSuSitio, conColumnasNuevas, mueveEnElGestor, ordenDeLaTabla,
  preferenciasDelGestorAlLeer,
} from "./routes-columns";
import { zonaDeLaRecogida } from "./zonas";
import { ciudadDeEntrega } from "./ciudad-de-entrega";
import { celdaPropiaDelPlan } from "./route-plan/celdas-del-plan";

/**
 * D-445: la «Ciudad de recogida» en la tabla de paradas de cada chofer del Gestor de Rutas, y la de entrega rotulada como
 * tal. El dueño, 2026-09-29, con la captura de esa tabla: «no me sale ciudad de enetrega y quiero que claramente diga ciudad
 * tienda de rocigda». La columna de ciudad (`p_address`, «Paradas: Ciudad») iba vacía en las filas de RECOGIDA (P) y no había
 * ninguna que dijera de qué tienda sale la carga.
 */

const paradas = (elegidas: readonly string[], orden: readonly string[] | null = null) => columnasDeLaTabla("paradas", elegidas, orden).map((c) => c.key);
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

describe("el catálogo: la ciudad de recogida, delante de la de entrega", () => {
  it("es una columna de paradas, visible por defecto, sin puesto viejo, con su rótulo", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_ciudad_recogida")).toEqual({
      key: "p_ciudad_recogida", en: "Stops: Pickup city", es: "Paradas: Ciudad de recogida", tablas: ["paradas"], ancho: 104,   // D-446: más pegada
    });
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain("p_ciudad_recogida");
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain(MARCA_V8);
  });
  it("la de entrega se rotula «Ciudad de entrega», con la MISMA clave guardada", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_address")).toMatchObject({ en: "Stops: Delivery city", es: "Paradas: Ciudad de entrega", indice: 4 });
  });
  it("justo DELANTE de la de entrega: en el catálogo, en el orden de partida y en lo que se pinta", () => {
    const cat = COLUMNAS_DEL_GESTOR.map((c) => c.key);
    expect(cat.indexOf("p_ciudad_recogida")).toBeGreaterThan(-1);
    expect(cat.indexOf("p_address")).toBe(cat.indexOf("p_ciudad_recogida") + 1);
    const par = ORDEN_DE_PARTIDA_DEL_GESTOR.paradas;
    expect(par.indexOf("p_ciudad_recogida")).toBeGreaterThan(-1);
    expect(par.indexOf("p_address")).toBe(par.indexOf("p_ciudad_recogida") + 1);
    expect(paradas(COLUMNAS_DEL_GESTOR_POR_DEFECTO)).toEqual(["p_type", "p_ciudad_recogida", "p_address", "p_eta", "p_windows"]);
  });
});

describe("lo ya guardado: la tanda `_v8`", () => {
  // Como una fila guardada tras D-435: sus columnas de paradas a su gusto (sin la llegada) y todas las marcas hasta `_v7`.
  const suyas = ["invoice", "account", "p_type", "p_address", "p_windows", "p_fee", "pl_clase", "_v2", "_v3", "_v4", "_v5", MARCA_V6, MARCA_V7];
  /** Un orden de paradas como lo guardaba el código de antes, que no conocía la columna: movido con el de hoy y sin la clave. */
  const comoAntes = (o: string[] | null) => { const r = o && o.filter((k) => k !== "p_ciudad_recogida"); expect(r).toContain("p_address"); return r; };

  it("AÑADE la columna y la marca, sin quitar nada de lo que eligió", () => {
    const con = conColumnasNuevas(suyas);
    expect(con).toEqual([...suyas, "p_ciudad_recogida", MARCA_V8]);
    expect(paradas(con)).toEqual(["p_type", "p_ciudad_recogida", "p_address", "p_windows", "p_fee"]);
  });
  it("con la marca y sin la columna, es que la quitó: no le vuelve", () => {
    const quitada = alternaColumna(conColumnasNuevas(suyas), "p_ciudad_recogida");
    expect(quitada).toContain(MARCA_V8);
    expect(conColumnasNuevas(quitada)).not.toContain("p_ciudad_recogida");
    expect(preferenciasDelGestorAlLeer(quitada, null)).toEqual({ columnas: quitada, orden: null, escribe: false });
  });
  it("sin orden guardado: la columna sale en su sitio de partida, y se guarda UNA vez", () => {
    const al = preferenciasDelGestorAlLeer(suyas, null);
    expect(al.orden).toBeNull();
    expect(paradas(al.columnas!, al.orden)).toEqual(["p_type", "p_ciudad_recogida", "p_address", "p_windows", "p_fee"]);
    expect(al.escribe).toBe(true);
    expect(preferenciasDelGestorAlLeer(al.columnas!, al.orden)).toEqual({ columnas: al.columnas, orden: null, escribe: false });
  });
  it("con las paradas MOVIDAS: su orden se queda, y la nueva entra justo delante de la ciudad de entrega; y se guarda una vez", () => {
    let orden: string[] | null = null;
    for (let i = 0; i < 3; i++) orden = mueveEnElGestor("paradas", orden, "p_fee", -1, suyas);
    orden = comoAntes(orden);
    expect(paradas(suyas, orden)).toEqual(["p_fee", "p_type", "p_address", "p_windows"]);   // de verdad lo movió
    const al = preferenciasDelGestorAlLeer(suyas, orden);
    expect(paradas(al.columnas!, al.orden)).toEqual(["p_fee", "p_type", "p_ciudad_recogida", "p_address", "p_windows"]);
    // Nada más cambió de sitio: sin la nueva, el orden de paradas es el que tenía (escondidas incluidas), y el de las otras tablas.
    expect(ordenDeLaTabla("paradas", al.orden).filter((k) => k !== "p_ciudad_recogida")).toEqual(ordenDeLaTabla("paradas", orden).filter((k) => k !== "p_ciudad_recogida"));
    expect(ordenDeLaTabla("sinAsignar", al.orden)).toEqual(ordenDeLaTabla("sinAsignar", orden));
    expect(ordenDeLaTabla("plan", al.orden)).toEqual(ordenDeLaTabla("plan", orden));
    expect(al.escribe).toBe(true);
    // Una vez pasada, no se repite.
    expect(preferenciasDelGestorAlLeer(al.columnas!, al.orden)).toEqual({ columnas: al.columnas, orden: al.orden, escribe: false });
  });
  it("con la ciudad de entrega movida al final: la de recogida va delante de ella, al final", () => {
    let orden: string[] | null = null;
    for (let i = 0; i < 2; i++) orden = mueveEnElGestor("paradas", orden, "p_address", 1, suyas);
    orden = comoAntes(orden);
    expect(paradas(suyas, orden)).toEqual(["p_type", "p_windows", "p_fee", "p_address"]);
    const al = preferenciasDelGestorAlLeer(suyas, orden);
    expect(paradas(al.columnas!, al.orden)).toEqual(["p_type", "p_windows", "p_fee", "p_ciudad_recogida", "p_address"]);
  });
  it("sin la inserción caería al FINAL del orden guardado (por eso existe `conCiudadDeRecogidaEnSuSitio`)", () => {
    let orden: string[] | null = null;
    for (let i = 0; i < 3; i++) orden = mueveEnElGestor("paradas", orden, "p_fee", -1, suyas);
    orden = comoAntes(orden);
    const con = conColumnasNuevas(suyas);
    expect(paradas(con, orden).slice(-1)).toEqual(["p_ciudad_recogida"]);
    expect(paradas(con, conCiudadDeRecogidaEnSuSitio(orden))).toEqual(["p_fee", "p_type", "p_ciudad_recogida", "p_address", "p_windows"]);
    expect(conCiudadDeRecogidaEnSuSitio(null)).toBeNull();
    // Sin la tabla de paradas en el orden (está en su partida), no toca nada.
    const soloSin = mueveEnElGestor("sinAsignar", null, "account", -1, suyas)!;
    expect(conCiudadDeRecogidaEnSuSitio(soloSin)).toEqual(soloSin);
    // Ya la tiene: no la duplica.
    const ya = conCiudadDeRecogidaEnSuSitio(orden)!;
    expect(conCiudadDeRecogidaEnSuSitio(ya)).toEqual(ya);
  });
  it("quien viene de `_v6` (sin la ciudad de entrega del plan) recibe las DOS, cada una en su sitio", () => {
    const de6 = suyas.filter((k) => k !== MARCA_V7);
    let orden: string[] | null = null;
    for (let i = 0; i < 3; i++) orden = mueveEnElGestor("paradas", orden, "p_fee", -1, de6);
    for (let i = 0; i < 2; i++) orden = mueveEnElGestor("plan", orden, "pl_windows", -1, de6);
    orden = comoAntes(orden)!.filter((k) => k !== "pl_ciudad_entrega");
    const al = preferenciasDelGestorAlLeer(de6, orden);
    expect(al.columnas).toEqual(expect.arrayContaining([MARCA_V7, MARCA_V8, "pl_ciudad_entrega", "p_ciudad_recogida"]));
    expect(paradas(al.columnas!, al.orden)).toEqual(["p_fee", "p_type", "p_ciudad_recogida", "p_address", "p_windows"]);
    const plan = ordenDeLaTabla("plan", al.orden);
    expect(plan.indexOf("pl_ciudad_entrega")).toBe(plan.indexOf("pl_ciudad_recogida") + 1);
    expect(al.escribe).toBe(true);
  });
  it("quien viene de antes de `_v6`: el plan vuelve a su partida y las paradas movidas reciben la columna en su sitio", () => {
    const viejas = ["invoice", "p_type", "p_address", "p_windows", "p_fee", "_v2", "_v3", "_v4", "_v5"];
    let orden: string[] | null = null;
    for (let i = 0; i < 3; i++) orden = mueveEnElGestor("paradas", orden, "p_fee", -1, viejas);
    orden = comoAntes(orden);
    const al = preferenciasDelGestorAlLeer(viejas, orden);
    expect(paradas(al.columnas!, al.orden)).toEqual(["p_fee", "p_type", "p_ciudad_recogida", "p_address", "p_windows"]);
    expect(ordenDeLaTabla("plan", al.orden)).toEqual(ORDEN_DE_PARTIDA_DEL_GESTOR.plan);
    expect(al.escribe).toBe(true);
  });
  it("las plantillas se aplican como se guardaron: una de antes no gana la columna, y recargar no se la añade", () => {
    const puesta = columnasDePlantillaDelGestor(["invoice", "p_type", "p_address"]);
    expect(puesta).toContain(MARCA_V8);
    expect(paradas(conColumnasNuevas(puesta))).toEqual(["p_type", "p_address"]);
  });
});

// ——— La página ——————————————————————————————————————————————————————————————————————————————————————————————————————————

describe("la página: las dos ciudades en las filas P y D", () => {
  const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
  const ini = pagina.indexOf('if (f.tipo === "P") {');
  const fin = pagina.indexOf("const d = porId.get(f.orden);", ini);
  const filaP = pagina.slice(ini, fin);
  const filaD = pagina.slice(fin, pagina.indexOf("{filaDeLaBase(u.key, \"regreso\"", fin));
  // Nota D-548 (2026-10-14): las celdas de paradas se pintan con UNA función, `celdaDeParada`, que usan las filas P, D y ya
  // hechas y, desde D-548, «Sin asignar» y «Todas». Hasta aquí estas pruebas buscaban las tres copias del `switch` en cada
  // fila; ahora buscan lo mismo en la función, y en cada fila lo que le pasa (la tienda en la P).
  const celda = pagina.slice(pagina.indexOf("const celdaDeParada = ("), pagina.indexOf("return <td key={c.key} className={clasePastillas(c.key)}>{celdaDeOrdenes(c.key, d)}</td>; };"));

  it("la fila D pinta la ciudad de recogida con `zonaDeLaRecogida` y la de entrega con `ciudadDeEntrega`", () => {
    expect(ini).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(ini);
    expect(celda.length).toBeGreaterThan(100);
    expect(filaD).toContain("{colsParadas.map((c) => celdaDeParada(c, d, { tipo: \"D\",");
    expect(filaD).not.toContain("recogida:");
    expect(celda).toContain('case "p_ciudad_recogida": return <td key={c.key}>{como.recogida ?? ((d && zonaDeLaRecogida(d, settings.stores ?? [], ciudadesQueSeConocen)) || "—")}</td>;');
    expect(celda).toContain('case "p_address": return <td key={c.key} title={d?.delivery_address || undefined}>{(d && ciudadDeEntrega(d.delivery_address, ciudadesQueSeConocen)) || "—"}{!como.sinAviso && <AvisoSoloCiudad orden={d} corto />}</td>;');
    expect(pagina).toContain('import { esDeSuZona, zonaDeLaRecogida } from "@/lib/zonas";');
  });
  it("la fila P: la TIENDA en la ciudad de recogida, sin «Recoger en» (D-447); la ciudad de entrega de su orden; el Tipo de su orden", () => {
    // D-447: el dueño, «eso de rdz mcallen deberia esta en ciudad de recodiga tienes todo alreves».
    expect(filaP).not.toContain('{t("Pick up at", "Recoger en")}');
    expect(filaP).toContain('<b>{f.lugar ?? t("(no store on the order)", "(la orden no dice la tienda)")}</b>');
    // La P pasa SU orden (`o`), la tienda como ciudad de recogida, y que es una recogida.
    expect(filaP).toContain('{colsParadas.map((c) => celdaDeParada(c, o, { tipo: "P", recogida: dondeRecoge,');
    expect(celda).toContain('case "p_type": return <td key={c.key} title={d?.order_type || undefined}>{d?.order_type || "—"}</td>;');
    // Lo de la ENTREGA va vacío en una recogida —ventanas y lo que `seVeEnLaRecogida` aparta—, y nada sin orden.
    expect(celda).toContain('case "p_windows": return <td key={c.key}>{como.tipo === "D" && d ? fmtWindows(d.delivery_windows) : ""}</td>;');
    const vacias = 'if (!d || (como.tipo === "P" && !seVeEnLaRecogida(c))) return <td key={c.key} />;';
    expect(celda).toContain(vacias);
    // Las ciudades van ANTES de la que deja vacío: si no, esa se las comería.
    expect(celda.indexOf('case "p_ciudad_recogida"')).toBeLessThan(celda.indexOf(vacias));
    expect(celda.indexOf('case "p_address"')).toBeLessThan(celda.indexOf(vacias));
    // La de antes, que dejaba la ciudad vacía en la recogida, ya no está.
    expect(pagina).not.toContain('c.key === "p_address" || c.key === "p_windows"');
  });
});

describe("lo que sale en la celda: la misma ciudad que la columna del plan", () => {
  const TIENDAS = [
    { name: "Tienda Norte", address: "1 Main St, Villa Norte, TX 78500", lat: 26.2, lng: -98.2 },
    { name: "Tienda Sur", address: "9 Bay Rd, Puerto Sur, TX 78520", lat: 25.9, lng: -97.5 },
  ];
  const o = { pickup_name: "Tienda Sur", store: "Tienda Norte", delivery_address: "5 Obra Ln, Llano Centro, TX 78501", order_type: "Venta", account: "Cuenta" };
  it("recogida: la ciudad de la tienda de `pickup_name`; entrega: la de la dirección; y «—» si no hay tienda con punto", () => {
    expect(zonaDeLaRecogida(o, TIENDAS, []) || "—").toBe("Puerto Sur");
    expect(ciudadDeEntrega(o.delivery_address, []) || "—").toBe("Llano Centro");
    expect(zonaDeLaRecogida({ pickup_name: "Otra", store: "Otra" }, TIENDAS, []) || "—").toBe("—");
    // La misma que «Plan: Ciudad de recogida» (D-434): no hay dos lógicas.
    expect(celdaPropiaDelPlan("pl_ciudad_recogida", o, { reglas: undefined as never, tiendas: TIENDAS, conocidas: [], es: true })).toBe("Puerto Sur");
  });
});
