import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V10, MARCA_V11, ORDEN_DE_PARTIDA_DEL_GESTOR, columnasDeLaTabla,
  conPoEnSuSitio, conRepEnSuSitio, conColumnasNuevas, preferenciasDelGestorAlLeer,
} from "./routes-columns";
import {
  SIN_FILTRO_EN_PARADAS, filasOcultas, hayFiltroEnParadas, paradaVisible, valorDeOrdenEnParadas, type ValoresDeOrden,
} from "./filtro-de-paradas";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

/** «Usuario» (`p_rep`) en la tabla de paradas: su catálogo, su puesto y las listas guardadas de antes. */
describe("«Usuario» en la tabla de paradas (p_rep)", () => {
  it("es una columna de paradas, de Órdenes (rep), visible por defecto, justo tras la cuenta", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_rep")).toEqual({
      key: "p_rep", en: "Stops: User", es: "Paradas: Usuario", tablas: ["paradas"], ancho: 128, deOrdenes: "rep",
    });
    const claves = COLUMNAS_DEL_GESTOR.map((c) => c.key);
    expect(claves.indexOf("p_rep")).toBe(claves.indexOf("p_account") + 1);
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_rep")?.oculta).toBeUndefined();
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain("p_rep");
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain(MARCA_V10);
  });

  it("en la partida de paradas va tras la cuenta", () => {
    const orden = ORDEN_DE_PARTIDA_DEL_GESTOR.paradas;
    expect(orden.indexOf("p_rep")).toBe(orden.indexOf("p_account") + 1);
    expect(columnasDeLaTabla("paradas", COLUMNAS_DEL_GESTOR_POR_DEFECTO, null).map((c) => c.key)).toContain("p_rep");
  });

  it("quien guardó sus columnas antes de esta tanda la recibe, y su orden la pone tras la cuenta", () => {
    const suyas = ["p_type", "p_eta", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", "_v8", "_v9"];
    const orden = ["p_type", "p_eta", "p_account", "p_so", "p_actual"];
    const al = preferenciasDelGestorAlLeer(suyas, orden);
    expect(al.columnas).toContain("p_rep");
    expect(al.columnas).toContain(MARCA_V10);
    expect(al.orden).toEqual(["p_po", "p_type", "p_eta", "p_account", "p_rep", "p_so", "p_actual"]); // + la PO delante del tipo (tanda _v11)
    expect(al.columnas).toContain("p_po");
    expect(al.columnas).toContain(MARCA_V11);
    expect(al.escribe).toBe(true);
  });

  it("quien ya tiene la marca no la recibe otra vez: si la quitó, sigue quitada", () => {
    const suyas = ["p_type", "p_eta", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", "_v8", "_v9", MARCA_V10, MARCA_V11];
    const al = preferenciasDelGestorAlLeer(suyas, ["p_type", "p_account"]);
    expect(al.columnas).not.toContain("p_rep");
    expect(al.orden).toEqual(["p_type", "p_account"]);
    expect(al.escribe).toBe(false);
  });

  it("conRepEnSuSitio solo inserta, y no toca un orden sin cuenta ni uno que ya la tiene", () => {
    expect(conRepEnSuSitio(null)).toBeNull();
    expect(conRepEnSuSitio(["p_type", "p_eta"])).toEqual(["p_type", "p_eta"]);
    expect(conRepEnSuSitio(["p_account", "p_rep", "p_so"])).toEqual(["p_account", "p_rep", "p_so"]);
  });
});

/** El filtro de la tabla de paradas (`src/lib/filtro-de-paradas.ts`): una fila se ve si alguna de sus órdenes cumple. */
describe("el filtro de la tabla de paradas", () => {
  const orden = (usuario: string | null, factura = "F1", tipo: string | null = "Retail"): ValoresDeOrden => ({ p_rep: usuario, _factura: factura, p_type: tipo });

  it("sin filtro se ve todo; con un filtro, solo lo que lo cumple", () => {
    expect(paradaVisible([orden("Juan")], {})).toBe(true);
    expect(paradaVisible([orden("Juan")], { p_rep: new Set() })).toBe(true);
    expect(paradaVisible([orden("María")], { p_rep: new Set(["María"]) })).toBe(true);
    expect(paradaVisible([orden("Juan")], { p_rep: new Set(["María"]) })).toBe(false);
  });

  it("una recogida con varias órdenes se ve si ALGUNA cumple", () => {
    const recogida = [orden("Juan"), orden("María")];
    expect(paradaVisible(recogida, { p_rep: new Set(["María"]) })).toBe(true);
    expect(paradaVisible(recogida, { p_rep: new Set(["Pedro"]) })).toBe(false);
  });

  it("con varias columnas filtradas, UNA misma orden tiene que cumplirlas todas", () => {
    const filtros = { p_rep: new Set(["María"]), p_type: new Set(["Retail"]) };
    expect(paradaVisible([orden("María", "F1", "Retail")], filtros)).toBe(true);
    expect(paradaVisible([orden("María", "F1", "Wholesale")], filtros)).toBe(false);
    // Ninguna de las dos cumple las dos a la vez: María/Wholesale y Juan/Retail.
    expect(paradaVisible([orden("María", "F1", "Wholesale"), orden("Juan", "F2", "Retail")], filtros)).toBe(false);
  });

  it("un valor vacío es «—», y se filtra por él", () => {
    expect(paradaVisible([orden(null)], { p_rep: new Set([" —"]) })).toBe(true);
    expect(paradaVisible([orden("Juan")], { p_rep: new Set([" —"]) })).toBe(false);
  });

  it("filasOcultas cuenta las filas que el filtro esconde, y sin filtro no esconde ninguna", () => {
    const filtros = { p_rep: new Set(["María"]) };
    expect(filasOcultas([[orden("María")], [orden("Juan")], [orden("Juan"), orden("Pedro")]], filtros)).toBe(2);
    expect(filasOcultas([[orden("Juan")]], {})).toBe(0);
  });

  it("un conjunto vacío no cuenta como filtro; un valor que la orden no tiene da nulo", () => {
    expect(hayFiltroEnParadas({})).toBe(false);
    expect(hayFiltroEnParadas({ p_rep: new Set() })).toBe(false);
    expect(hayFiltroEnParadas({ p_rep: new Set(["x"]) })).toBe(true);
    expect(valorDeOrdenEnParadas("no_existe", orden("x"))).toBeNull();
  });

  it("la llegada y la real no filtran: su celda es una hora de la medida de la ruta", () => {
    expect(SIN_FILTRO_EN_PARADAS).toEqual(["p_eta", "p_actual"]);
  });
});

/** Lo que va en el código, leído como texto (como el resto de pruebas de la pantalla del Gestor). */
describe("el encabezado de la tabla de paradas: filtrar sin ordenar", () => {
  it("CabeceraConMenu tiene soloFiltro, con el rótulo «Filtrar»; el menú de Órdenes sigue con su orden", () => {
    const cabecera = plano(leer("src/components/CabeceraConMenu.tsx"));
    expect(cabecera).toContain("soloFiltro");
    expect(cabecera).toContain('t("Filter", "Filtrar")');
    expect(plano(leer("src/components/OrdersTable.tsx"))).toContain('{!soloFiltro && <div className="col-menu-orden">');
  });

  it("la pantalla pone el filtro una sola vez para todas las tarjetas, con el aviso de lo oculto", () => {
    const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
    expect(pagina).toContain("soloFiltro");
    expect(pagina).toContain("<FiltrosPuestos estado={filtroParadas}");
    expect(pagina).toContain("parada(s) ocultas por el filtro");
    expect(pagina).toContain("stop(s) hidden by the filter");
  });
});

/** La PO en la tabla de paradas (`p_po`, tanda `_v11`): sale por defecto delante del tipo, y quien ya la tenía no la pierde. */
describe("la PO en la tabla de paradas (p_po, tanda _v11)", () => {
  const sinPo = ["p_type", "p_eta", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", "_v8", "_v9", MARCA_V10];

  it("sale por defecto, visible y delante del tipo; la marca va en el defecto", () => {
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_po")).toMatchObject({ tablas: ["paradas"], deOrdenes: "po" });
    expect(COLUMNAS_DEL_GESTOR.find((c) => c.key === "p_po")?.oculta).toBeUndefined();
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain("p_po");
    expect(COLUMNAS_DEL_GESTOR_POR_DEFECTO).toContain(MARCA_V11);
    expect(columnasDeLaTabla("paradas", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key)[0]).toBe("p_po");
    expect(ORDEN_DE_PARTIDA_DEL_GESTOR.paradas.indexOf("p_po")).toBe(ORDEN_DE_PARTIDA_DEL_GESTOR.paradas.indexOf("p_type") - 1);
  });
  it("conPoEnSuSitio: la pone justo delante del tipo, la saca de donde estuviera, y no toca lo demás", () => {
    expect(conPoEnSuSitio(null)).toBeNull();
    expect(conPoEnSuSitio(["p_eta", "p_type", "p_so", "p_po"])).toEqual(["p_eta", "p_po", "p_type", "p_so"]);
    expect(conPoEnSuSitio(["p_po", "p_fee", "p_type"])).toEqual(["p_fee", "p_po", "p_type"]);
    // Sin el tipo en el orden, no inventa su sitio: la deja como estaba.
    expect(conPoEnSuSitio(["p_eta", "p_so"])).toEqual(["p_eta", "p_so"]);
  });
  it("quien NO la tenía encendida, con la tanda: la recibe UNA vez, en su sitio, y se guarda", () => {
    // La PO de partida de antes (tras el SO) se va delante del tipo.
    const orden = ["p_type", "p_eta", "p_so", "p_po", "p_account"];
    const al = preferenciasDelGestorAlLeer(sinPo, orden);
    expect(al.columnas).toContain("p_po");
    expect(al.columnas).toContain(MARCA_V11);
    expect(al.orden).toEqual(["p_po", "p_type", "p_eta", "p_so", "p_account"]);
    expect(al.escribe).toBe(true);
    expect(preferenciasDelGestorAlLeer(al.columnas!, al.orden)).toEqual({ columnas: al.columnas, orden: al.orden, escribe: false });
  });
  it("quien YA la tenía encendida conserva su sitio en el orden; solo se marca la tanda", () => {
    const suyas = [...sinPo, "p_po"];
    const orden = ["p_eta", "p_so", "p_po", "p_type"];
    const al = preferenciasDelGestorAlLeer(suyas, orden);
    expect(al.orden).toEqual(orden);
    expect(al.columnas).toContain(MARCA_V11);
    expect(al.escribe).toBe(true);
  });
  it("con la marca, nada cambia: y si la ocultó después, sigue oculta (la marca impide que vuelva)", () => {
    const con = [...sinPo, "p_po", MARCA_V11];
    expect(preferenciasDelGestorAlLeer(con, ["p_type", "p_eta"])).toEqual({ columnas: con, orden: ["p_type", "p_eta"], escribe: false });
    const oculta = [...sinPo, MARCA_V11];
    expect(conColumnasNuevas(oculta)).not.toContain("p_po");
    expect(preferenciasDelGestorAlLeer(oculta, null).columnas).not.toContain("p_po");
  });
  it("sin lista guardada, sale la partida con la PO delante del tipo", () => {
    const al = preferenciasDelGestorAlLeer(undefined, null);
    expect(al.columnas).toBeNull();
    expect(columnasDeLaTabla("paradas", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key).slice(0, 2)).toEqual(["p_po", "p_type"]);
  });
});
