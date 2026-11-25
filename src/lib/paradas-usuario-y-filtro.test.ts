import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V10, ORDEN_DE_PARTIDA_DEL_GESTOR, columnasDeLaTabla,
  conRepEnSuSitio, preferenciasDelGestorAlLeer,
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
    expect(al.orden).toEqual(["p_type", "p_eta", "p_account", "p_rep", "p_so", "p_actual"]);
    expect(al.escribe).toBe(true);
  });

  it("quien ya tiene la marca no la recibe otra vez: si la quitó, sigue quitada", () => {
    const suyas = ["p_type", "p_eta", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", "_v8", "_v9", MARCA_V10];
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
