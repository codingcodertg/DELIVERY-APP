import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  filaDePromo, filasDePrecio, filasDePromoDeGrupos, parsePreciosPorTamano, preciosPorTamano, tamanoDelProducto,
  type DecisionDeGrupo, type ProductoDeCatalogo,
} from "./tabla";

/**
 * D-812 (230): el precio por grupo. El dueño, con su hoja de precios por tamaño: «in brownsville promo add this prices
 * for the items names containing that sizes» · «en este caso este precio solo aplica para brownsville».
 */
const producto = (code: string, size: string | null, description = code): ProductoDeCatalogo => ({
  round_id: "R1", code, supplier: "KERTILES, LLC", size, description, qoh: 1, qoh_by_store: {}, price: 0.99,
  source_sheet: "TODO", row_no: 1, private: null,
});
const decision = (code: string, group_code: string, extra: Partial<DecisionDeGrupo> = {}): DecisionDeGrupo =>
  ({ round_id: "R1", code, group_code, status: "pending", note: null, ...extra });
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");

describe("el tamaño del producto", () => {
  it("la columna size, normalizada; si falta, el NNxNN de la descripción; si no hay, null", () => {
    expect(tamanoDelProducto({ size: "12X36", description: "X" })).toBe("12X36");
    expect(tamanoDelProducto({ size: " 8 x 48 ", description: "X" })).toBe("8X48");
    expect(tamanoDelProducto({ size: null, description: "RIVERDALE WHITE #1007 12X36 11.62 SF" })).toBe("12X36");
    expect(tamanoDelProducto({ size: "", description: "SATURNIA LIGHT (M) 24x48 15.28 SF" })).toBe("24X48");
    expect(tamanoDelProducto({ size: null, description: "SIN TAMAÑO" })).toBeNull();
  });
});

describe("lo que el dueño pega", () => {
  it("una línea por tamaño, con $ o sin él, coma o punto; lo que no se entiende se devuelve", () => {
    const { precios, malas } = parsePreciosPorTamano("10X64 $ 2.09\n12x36 1.59\n24X24, 1,19\n\nhola\n8X48\t$1.59");
    expect(precios).toEqual({ "10X64": 2.09, "12X36": 1.59, "24X24": 1.19, "8X48": 1.59 });
    expect(malas).toEqual(["hola"]);
  });
  it("la hoja de Brownsville entera", () => {
    const hoja = "10X64 $ 2.09\n12X36 $ 1.59\n16X48 $ 1.69\n24X24 $ 1.19\n24X48 $ 1.39\n32X32 $ 1.19\n48X48 $ 1.99\n8X24 $ 1.79\n8X48 $ 1.59";
    const { precios, malas } = parsePreciosPorTamano(hoja);
    expect(Object.keys(precios)).toHaveLength(9);
    expect(precios["48X48"]).toBe(1.99);
    expect(malas).toEqual([]);
  });
});

describe("qué productos reciben qué precio", () => {
  it("por tamaño; sin tamaño conocido o sin precio para él, no entra; un código solo una vez", () => {
    const productos = [producto("A", "12X36"), producto("B", null, "CANYON 8X24 9.04 SF"), producto("C", "99X99"), producto("D", null, "SIN"), producto("A", "12X36")];
    expect(preciosPorTamano(productos, { "12X36": 1.59, "8X24": 1.79 })).toEqual([
      { code: "A", tamano: "12X36", price: 1.59 }, { code: "B", tamano: "8X24", price: 1.79 },
    ]);
  });
  it("las filas a escribir llevan SOLO la clave y el precio: el estado de lo decidido no viaja", () => {
    const filas = filasDePrecio({ roundId: "R1", grupo: "BRO", precios: [{ code: "A", price: 1.59 }, { code: "A", price: 1.59 }, { code: "B", price: null }] });
    expect(filas).toEqual([{ round_id: "R1", code: "A", group_code: "BRO", price: 1.59 }, { round_id: "R1", code: "B", group_code: "BRO", price: null }]);
    expect(Object.keys(filas[0])).toEqual(["round_id", "code", "group_code", "price"]);
  });
});

describe("lo que se ve", () => {
  it("con precio de grupo, ese; sin él, el del libro", () => {
    expect(filaDePromo(producto("A", "12X36"), decision("A", "BRO", { price: 1.59 })).precioDelGrupo).toBe(1.59);
    expect(filaDePromo(producto("A", "12X36"), decision("A", "BRO")).precioDelGrupo).toBeNull();
    expect(filaDePromo(producto("A", "12X36"), undefined).price).toBe(0.99);
  });
  it("con varios grupos marcados, el precio de grupo solo si todos coinciden", () => {
    const productos = [producto("A", "12X36")];
    const iguales = [decision("A", "BRO", { price: 1.59 }), decision("A", "WES", { price: 1.59 })];
    const distintos = [decision("A", "BRO", { price: 1.59 }), decision("A", "WES", { price: 2 })];
    expect(filasDePromoDeGrupos(productos, iguales, ["BRO", "WES"])[0].precioDelGrupo).toBe(1.59);
    expect(filasDePromoDeGrupos(productos, distintos, ["BRO", "WES"])[0].precioDelGrupo).toBeNull();
  });
  it("la celda de precio pinta el del grupo sobre el del libro; la página lee `price` de las decisiones; el botón solo con un grupo", () => {
    const tabla = leer("src/app/promos/[id]/TablaDeRonda.tsx");
    expect(tabla).toContain('if (clave === "price") return textoDePrecio(fila.precioDelGrupo ?? fila.price);');
    expect(tabla).toContain("{sePuede && gruposActivos.length === 1 && (");
    expect(tabla).toContain('.upsert(filasAEscribir, { onConflict: "round_id,code,group_code" })');
    expect(leer("src/app/promos/[id]/page.tsx")).toContain('.select("round_id, code, group_code, status, note, price, decided_by, decided_at")');
  });
  it("la 230: la columna, no negativa, y sin transacción propia", () => {
    const sql = leer("supabase/migrations/230_promos_precio_por_grupo.sql");
    expect(sql).toContain("alter table public.promo_decisions add column if not exists price numeric");
    expect(sql).toContain("check (price is null or price >= 0)");
    expect(sql).not.toMatch(/(^|\s)(begin|commit);/);
  });
});
