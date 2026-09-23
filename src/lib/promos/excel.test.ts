import { describe, expect, it } from "vitest";
import { disposicionDe, leePromo, numero, texto, type Celda, type HojaCruda } from "./excel";

/**
 * Las formas de aquí abajo **están medidas en el libro real** (`9.25.26 Promo`), pero los valores
 * son inventados a propósito: ni un código de producto, ni un código de tienda, ni un nombre de
 * tienda del dueño entra en el repositorio. Lo que se prueba es la ESTRUCTURA, que es lo que
 * rompe un lector: encabezados en la fila 2, un costo que llega como cadena vacía, tres formas
 * distintas de celda con fórmula, un código con un espacio dentro que además es prefijo de otro, y
 * filas con descripción pero sin código.
 */

/** La fila 1 del libro: un rótulo suelto encima de las columnas de tienda, y nada más. */
const FILA_1: Celda[] = [null, null, null, null, null, null, null, null, "QOH", "QOH", "QOH", null, null, null];

/** La fila 2: los ocho fijos, TRES columnas de tienda con nombres inventados, y COST/PRICE/DIFF. */
const FILA_2: Celda[] = [
  "SUPPLIER", "SIZE", "Unified Code", "Unified Description", "NOTES", "QOH", "DEMAND", "MO",
  "AA1", "BB2", "CC3",
  "COST", "PRICE", "DIFF",
];

type CampoDePrueba = "desc" | "notes" | "cost" | "price" | "diff" | "qoh" | "mo" | "demand";

/**
 * Una fila de producto, con lo justo para no repetir catorce celdas en cada prueba.
 *
 * `o()` mira si la CLAVE está, no si el valor es nulo: `?? ` daría el valor por defecto cuando la
 * prueba pide expresamente un `null` — y entonces la prueba del costo ausente no probaría nada.
 */
function fila(code: Celda, extra: Partial<Record<CampoDePrueba, Celda>> = {}, tiendas: Celda[] = [1, 2, 3]): Celda[] {
  const o = (k: CampoDePrueba, porDefecto: Celda): Celda => (k in extra ? extra[k] : porDefecto);
  return [
    "PROV", "8X48", code, o("desc", "DESCRIPCION"), o("notes", null),
    o("qoh", 100), o("demand", 10), o("mo", 5),
    ...tiendas,
    o("cost", 1), o("price", 2), o("diff", 1),
  ];
}

const hoja = (nombre: string, ...filasDeProducto: Celda[][]): HojaCruda => ({
  nombre,
  filas: [FILA_1, FILA_2, ...filasDeProducto],
});

// ===========================================================================
describe("una celda", () => {
  it("el costo vacío es AUSENTE, nunca cero — y esto es el fallo que se está evitando", () => {
    // Medido en el libro real: cinco productos traen COST como la cadena vacía. `Number("")` vale
    // 0, así que un lector ingenuo registra costo cero y la pantalla enseña un margen inventado.
    expect(numero("")).toBeNull();
    expect(numero("   ")).toBeNull();
    expect(numero(null)).toBeNull();
    expect(numero(undefined)).toBeNull();
    // Y que quede dicho lo que NO debe pasar, con el número a la vista:
    expect(numero("")).not.toBe(0);
  });

  it("lee las TRES formas de celda con fórmula que trae la misma hoja", () => {
    // 1 · fórmula normal
    expect(numero({ formula: "P3-O3", result: 0.4427 })).toBe(0.4427);
    // 2 · la maestra de una fórmula compartida
    expect(numero({ formula: "P4-O4", result: 0.3732, ref: "Q4:Q9", shareType: "shared" })).toBe(0.3732);
    // 3 · una seguidora, que NO trae `formula`
    expect(numero({ result: 0.2951, sharedFormula: "Q3" })).toBe(0.2951);
  });

  it("una fórmula sin calcular es ausente, no cero", () => {
    expect(numero({ formula: "P9-O9", result: undefined })).toBeNull();
    expect(numero({ formula: "P9-O9", result: null })).toBeNull();
  });

  it("un número que no lo es se queda en ausente", () => {
    expect(numero("no es un numero")).toBeNull();
    expect(numero(Number.NaN)).toBeNull();
    expect(numero(Number.POSITIVE_INFINITY)).toBeNull();
    expect(numero(true)).toBeNull();
    expect(numero("1.5")).toBe(1.5);
    expect(numero(0)).toBe(0);
  });

  it("el texto se recorta POR LOS LADOS y no por dentro", () => {
    expect(texto("  ZZZ 3.5GAL  ")).toBe("ZZZ 3.5GAL");
    expect(texto("")).toBeNull();
    expect(texto("   ")).toBeNull();
    expect(texto(477)).toBe("477");
    expect(texto({ richText: [{ text: "AB" }, { text: " CD" }] })).toBe("AB CD");
  });
});

// ===========================================================================
describe("reconocer una hoja de productos", () => {
  it("la reconoce por su FILA 2, no por su nombre", () => {
    const d = disposicionDe([FILA_1, FILA_2, fila("X1")]);
    expect(d).not.toBeNull();
    expect(d!.izquierda).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(d!.derecha).toEqual([11, 12, 13]);
  });

  it("las columnas de tienda se DESCUBREN: las que van entre MO y COST, con el nombre que diga el libro", () => {
    // Ni un código de tienda escrito en el código. Si el libro del mes que viene abre otra tienda,
    // esto la lee sola. Se comprueba con nombres que no son los de ninguna tienda real.
    const d = disposicionDe([FILA_1, FILA_2, fila("X1")])!;
    expect(d.tiendas).toEqual([{ nombre: "AA1", indice: 8 }, { nombre: "BB2", indice: 9 }, { nombre: "CC3", indice: 10 }]);

    const otroLibro = [...FILA_2];
    otroLibro.splice(8, 3, "QQ", "RR", "SS", "TT");
    const d2 = disposicionDe([FILA_1, otroLibro, []])!;
    expect(d2.tiendas.map((t) => t.nombre)).toEqual(["QQ", "RR", "SS", "TT"]);
    expect(d2.derecha).toEqual([12, 13, 14]);
  });

  it("una hoja que no es de productos devuelve null, y no revienta", () => {
    // La hoja de reglas del dueño: una sola columna de texto suelto.
    expect(disposicionDe([["MANAGERS CAN"], ["APPROVE"], ["REJECT"]])).toBeNull();
    expect(disposicionDe([])).toBeNull();
    expect(disposicionDe([FILA_2])).toBeNull(); // los encabezados en la fila 1: no es este libro
  });

  it("sin ninguna columna entre MO y COST no es esta hoja", () => {
    const sinTiendas = ["SUPPLIER", "SIZE", "Unified Code", "Unified Description", "NOTES", "QOH", "DEMAND", "MO", "COST", "PRICE", "DIFF"];
    expect(disposicionDe([FILA_1, sinTiendas])).toBeNull();
  });

  it("los encabezados se comparan sin distinguir mayúsculas ni espacios de más", () => {
    const gritando = FILA_2.map((c) => (typeof c === "string" ? `  ${c.toLowerCase()}  ` : c));
    expect(disposicionDe([FILA_1, gritando])).not.toBeNull();
  });
});

// ===========================================================================
describe("leer el libro entero", () => {
  it("saca los productos de la fila 3 en adelante, con su fila del libro", () => {
    const r = leePromo([hoja("TODO", fila("X1"), fila("X2"))]);
    expect(r.productos.map((p) => [p.code, p.rowNo, p.sourceSheet])).toEqual([["X1", 3, "TODO"], ["X2", 4, "TODO"]]);
    expect(r.productos[0].qohByStore).toEqual({ AA1: 1, BB2: 2, CC3: 3 });
  });

  it("una hoja que no es de productos se AVISA, no se traga", () => {
    const reglas: HojaCruda = { nombre: "REGLAS", filas: [["MANAGERS CAN"], ["APPROVE"]] };
    const r = leePromo([hoja("TODO", fila("X1")), reglas]);
    expect(r.productos).toHaveLength(1);
    expect(r.avisos.filter((a) => a.tipo === "hoja-ignorada").map((a) => a.hoja)).toEqual(["REGLAS"]);
  });

  it("una fila con descripción pero SIN código no es un producto, y se dice cuál era", () => {
    // El libro real trae tres así: epígrafes escritos a mano al final de una hoja.
    const r = leePromo([hoja("TODO", fila("X1"), fila(null, { desc: "EPIGRAFE" }))]);
    expect(r.productos.map((p) => p.code)).toEqual(["X1"]);
    const aviso = r.avisos.find((a) => a.tipo === "fila-sin-codigo");
    expect(aviso).toMatchObject({ hoja: "TODO", fila: 4 });
    expect(aviso!.detalle).toContain("EPIGRAFE");
  });

  it("las filas vacías del final se saltan sin avisar de nada", () => {
    const h = hoja("TODO", fila("X1"));
    h.filas.push([], [null, null, null], []);
    const r = leePromo([h]);
    expect(r.productos).toHaveLength(1);
    expect(r.avisos).toEqual([]);
  });

  it("un código que es PREFIJO de otro, con un espacio dentro, siguen siendo dos productos", () => {
    // La forma exacta que trae el libro: `X 3.5GAL` no es `X`. Normalizar espacios los fundiría.
    const r = leePromo([hoja("TODO", fila("ZZZ"), fila("ZZZ 3.5GAL"))]);
    expect(r.productos.map((p) => p.code)).toEqual(["ZZZ", "ZZZ 3.5GAL"]);
    expect(r.avisos).toEqual([]);
  });

  it("un producto sin costo ni precio se guarda igual, con los dos en ausente", () => {
    const r = leePromo([hoja("SUELTOS", fila("X1", { cost: "", price: null, diff: null }))]);
    expect(r.productos[0]).toMatchObject({ code: "X1", cost: null, price: null, diff: null });
  });

  it("sin grupos conocidos, TODO es universo y no hay ni una sugerencia", () => {
    // El día que se estrena esto nadie ha cruzado nada en Ajustes. Es lo honesto: sin el cruce no
    // se puede saber de qué grupo era esa hoja.
    const r = leePromo([hoja("TODO", fila("X1")), hoja("G1", fila("X1"))]);
    expect(r.sugerencias).toEqual([]);
    expect(r.productos.map((p) => p.code)).toEqual(["X1"]);
    expect(r.avisos.filter((a) => a.tipo === "codigo-repetido")).toHaveLength(1);
  });

  it("una hoja que se llama como un grupo conocido son SUGERENCIAS, no universo", () => {
    const r = leePromo([hoja("TODO", fila("X1"), fila("X2")), hoja("G1", fila("X2"))], ["G1"]);
    expect(r.productos.map((p) => [p.code, p.sourceSheet])).toEqual([["X1", "TODO"], ["X2", "TODO"]]);
    expect(r.sugerencias).toEqual([{ code: "X2", groupCode: "G1" }]);
    expect(r.avisos).toEqual([]);
  });

  it("el nombre de la hoja casa con el grupo sin distinguir mayúsculas ni espacios", () => {
    const r = leePromo([hoja("TODO", fila("X1")), hoja("  g1 ", fila("X1"))], ["G1"]);
    expect(r.sugerencias).toEqual([{ code: "X1", groupCode: "G1" }]);
  });

  it("un producto que SOLO está en la hoja de un grupo se conserva, y se avisa", () => {
    // Perderlo sería inventar que la hoja no lo decía.
    const r = leePromo([hoja("TODO", fila("X1")), hoja("G1", fila("X9"))], ["G1"]);
    expect(r.productos.map((p) => [p.code, p.sourceSheet])).toEqual([["X1", "TODO"], ["X9", "G1"]]);
    expect(r.sugerencias).toEqual([{ code: "X9", groupCode: "G1" }]);
    expect(r.avisos).toEqual([{ tipo: "sugerido-fuera-del-universo", hoja: "G1", fila: 3, detalle: expect.stringContaining("X9") }]);
  });

  it("un grupo conocido para el que el libro no trae hoja se avisa", () => {
    const r = leePromo([hoja("TODO", fila("X1")), hoja("G1", fila("X1"))], ["G1", "G2"]);
    expect(r.avisos).toEqual([{ tipo: "grupo-sin-hoja", hoja: "G2", detalle: expect.stringContaining("G2") }]);
  });

  it("un código repetido DENTRO de una hoja: gana el primero y se avisa de dónde estaba", () => {
    const r = leePromo([hoja("TODO", fila("X1", { desc: "PRIMERA" }), fila("X1", { desc: "SEGUNDA" }))]);
    expect(r.productos).toHaveLength(1);
    expect(r.productos[0].description).toBe("PRIMERA");
    expect(r.avisos).toEqual([{ tipo: "codigo-repetido", hoja: "TODO", fila: 4, detalle: expect.stringContaining("la fila 3") }]);
  });

  it("un código repetido entre DOS hojas de universo también se avisa, nombrando la otra", () => {
    const r = leePromo([hoja("TODO", fila("X1")), hoja("SUELTOS", fila("X1"))]);
    expect(r.productos).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ tipo: "codigo-repetido", hoja: "SUELTOS", fila: 3 });
    expect(r.avisos[0].detalle).toContain("TODO");
  });

  it("las hojas de grupo NO añaden sugerencias de un producto por cada vez que aparece en otra", () => {
    // Dos grupos sugiriendo el mismo producto son dos sugerencias, una por grupo, y ni una más.
    const r = leePromo([hoja("TODO", fila("X1")), hoja("G1", fila("X1")), hoja("G2", fila("X1"))], ["G1", "G2"]);
    expect(r.sugerencias).toEqual([{ code: "X1", groupCode: "G1" }, { code: "X1", groupCode: "G2" }]);
    expect(r.productos).toHaveLength(1);
  });

  it("el libro entero: la forma que se midió, con todas sus trampas a la vez", () => {
    const r = leePromo(
      [
        hoja("TODO", fila("X1"), fila("X2"), fila("X3")),
        { nombre: "REGLAS", filas: [["MANAGERS CAN"], ["APPROVE"]] },
        hoja("G1", fila("X1"), fila("X2")),
        hoja("G2", fila("X3")),
        hoja("SUELTOS",
          fila("ZZZ", { cost: 40, price: 45, diff: null }),
          fila("ZZZ 3.5GAL", { cost: 133, price: 135, diff: null }),
          fila("YY1", { cost: "", price: null, diff: null }),
          fila(null, { desc: "EPIGRAFE" })),
      ],
      ["G1", "G2"],
    );
    expect(r.productos.map((p) => p.code)).toEqual(["X1", "X2", "X3", "ZZZ", "ZZZ 3.5GAL", "YY1"]);
    expect(r.sugerencias).toEqual([
      { code: "X1", groupCode: "G1" }, { code: "X2", groupCode: "G1" }, { code: "X3", groupCode: "G2" },
    ]);
    expect(r.productos.find((p) => p.code === "YY1")).toMatchObject({ cost: null, price: null });
    expect(r.avisos.map((a) => a.tipo)).toEqual(["hoja-ignorada", "fila-sin-codigo"]);
  });
});
