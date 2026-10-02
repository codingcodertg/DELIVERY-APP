import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_DEFAULT_COLUMNS } from "./constants";
import { ORDEN_DE_PARTIDA, columnasEnOrden, ordenEfectivo } from "./orden-de-columnas";
import {
  COLUMNAS_DEL_GESTOR, COLUMNAS_DEL_GESTOR_POR_DEFECTO, MARCA_V2, MARCA_V3, MARCA_V4, claveEnOrdenes, columnasDeLaTabla,
  columnasDePlantillaDelGestor, columnasDelSelector, conColumnasNuevas, fotoDelGestor,
} from "./routes-columns";

/**
 * D-402: «Sin asignar» del Gestor de Rutas sale en el mismo orden que Órdenes vista por ventas. El dueño: «quiero que la
 * tabla que se hizo en logistic manager tenga el mismo orden que en order view de sales».
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const MARCAS = [MARCA_V2, MARCA_V3, MARCA_V4];

/** Lo que ve ventas en Órdenes: sus columnas, en el orden que pinta `OrdersTable` para ella (`orden` nulo → el de partida). */
const ordenDeVentas = (visibles: readonly string[]) => columnasEnOrden(visibles, ordenEfectivo([...ORDEN_DE_PARTIDA], null));
/** Las cabeceras de «Sin asignar», traducidas a la columna de Órdenes que ocupa su puesto (la recogida no tiene). */
const sinAsignarEnClavesDeOrdenes = (elegidas: readonly string[]) =>
  columnasDeLaTabla("sinAsignar", elegidas).map((c) => claveEnOrdenes(c)).filter((k): k is string => !!k);

describe("«Sin asignar» en el orden de Órdenes vista por ventas (D-402)", () => {
  it("cabecera por cabecera, las que tienen las dos tablas salen en el orden de ventas con sus columnas por defecto", () => {
    const ventas = ordenDeVentas(ROLE_DEFAULT_COLUMNS.sales!);
    expect(ventas).toEqual(["po", "type", "account", "stage", "store", "date", "pallets", "driver", "address", "windows"]);
    const gestor = sinAsignarEnClavesDeOrdenes(COLUMNAS_DEL_GESTOR_POR_DEFECTO);
    // El chofer no está en «Sin asignar»: son las que aún no tienen chofer.
    expect(gestor.filter((k) => ventas.includes(k))).toEqual(ventas.filter((k) => k !== "driver"));
  });
  it("y también con TODAS las de Órdenes puestas —lo que Ajustes podría darle a ventas—: el orden es el mismo", () => {
    const gestor = sinAsignarEnClavesDeOrdenes(COLUMNAS_DEL_GESTOR_POR_DEFECTO);
    expect(gestor).toEqual(ordenDeVentas(ORDEN_DE_PARTIDA).filter((k) => gestor.includes(k)));
    // Y no se queda ninguna fuera por no tener pareja: solo la recogida.
    expect(columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO).filter((c) => !claveEnOrdenes(c)).map((c) => c.key)).toEqual(["pickup"]);
  });
  it("la «Etapa» del Gestor (clave `status`) ocupa el puesto de la etapa de Órdenes", () => {
    const claves = columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key);
    expect(claves.indexOf("status")).toBeGreaterThan(claves.indexOf("contact"));
    expect(claves.indexOf("status")).toBe(claves.indexOf("store") - 1);
  });
  it("la recogida, que Órdenes no tiene, va justo delante de la dirección de entrega", () => {
    const claves = columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key);
    expect(claves).toContain("pickup");
    expect(claves.indexOf("pickup")).toBe(claves.indexOf("address") - 1);
  });
  it("lo guardado: se respetan las columnas que eligió cada quien, y salen en el orden nuevo", () => {
    const guardada = ["address", "invoice", "status", "pickup", ...MARCAS];
    expect(columnasDeLaTabla("sinAsignar", conColumnasNuevas(guardada)).map((c) => c.key)).toEqual(["invoice", "status", "pickup", "address"]);
  });
  it("«Default» devuelve el orden nuevo, y una plantilla se pinta en el orden nuevo sin que su foto cambie", () => {
    expect(columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR_POR_DEFECTO).map((c) => c.key)[0]).toBe("po");
    const foto = ["address", "po", "fee"];
    // Sin ninguna del plan, la plantilla es de antes de que el plan tuviera columnas (D-429): recibe las del plan por defecto.
    expect(new Set(fotoDelGestor(columnasDePlantillaDelGestor(foto)).filter((k) => !k.startsWith("pl_")))).toEqual(new Set(foto));
    // Desde D-408 la factura es fija: sale aunque la foto no la tenga, en su puesto de ventas (tras PO y SO).
    expect(columnasDeLaTabla("sinAsignar", columnasDePlantillaDelGestor(foto)).map((c) => c.key)).toEqual(["po", "invoice", "fee", "address"]);
  });
  it("el ⚙ de «Sin asignar» lista las columnas en el mismo orden que la tabla: la página le pasa el orden de la persona", () => {
    const pagina = plano(leer("src/app/(app)/routes/page.tsx"));
    // Hasta D-410, `columnasElegibles` (sin la factura, D-408). Ahora sale TODA la tabla, factura incluida —se mueve,
    // no se quita—, en el orden de la persona; sin orden propio, el de ventas.
    // Puesto al día por D-NEXT: el ⚙ lo pinta `tablaDeOrdenes` con `vista.selector`; «Sin asignar» le pasa esto.
    expect(pagina).toContain('selector: columnasDelSelector("sinAsignar", ordenGestor)');
    expect(pagina).toContain("<SelectorDeColumnas columnas={vista.selector}");
    expect(columnasDelSelector("sinAsignar", null).map((c) => c.key))
      .toEqual(columnasDeLaTabla("sinAsignar", COLUMNAS_DEL_GESTOR.map((c) => c.key)).map((c) => c.key));
  });
  it("sin orden propio, las tablas de PARADAS salen como antes de poder moverlas: el orden de partida no cambió", () => {
    // D-402 las dejó quietas; D-410 las deja mover, pero quien no mueve nada las ve igual que antes.
    // D-412: la prioridad llega al FINAL, como toda columna nueva de paradas; lo de antes no se mueve.
    // D-445 es la excepción: la ciudad de recogida va justo DELANTE de la de entrega (de dónde sale a dónde va), no al final.
    const DE_SIEMPRE = ["p_type", "p_ciudad_recogida", "p_address", "p_eta", "p_windows", "p_stage", "p_store", "p_account", "p_so", "p_po", "p_date", "p_fee", "p_contact", "p_priority"];
    expect(columnasDeLaTabla("paradas", COLUMNAS_DEL_GESTOR.map((c) => c.key)).map((c) => c.key)).toEqual(DE_SIEMPRE);
    expect(plano(leer("src/app/(app)/routes/page.tsx"))).toContain('columnas={columnasDelSelector("paradas", ordenGestor)}');
    expect(columnasDelSelector("paradas", null).map((c) => c.key)).toEqual(DE_SIEMPRE);
  });
  it("el lado de ventas es el orden de partida: `OrdersTable` ordena su catálogo con él y Órdenes no le pasa orden propio a ventas", () => {
    expect(plano(leer("src/components/OrdersTable.tsx"))).toContain("enOrdenDePartida(ORDER_COLUMNS);");
    expect(plano(leer("src/app/(app)/page.tsx"))).toContain('orden={me?.role === "sales" ? null : orden}');
  });
});
