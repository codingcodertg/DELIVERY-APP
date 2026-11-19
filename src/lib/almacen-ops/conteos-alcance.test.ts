import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buscarEnLista, claveDeMedida, claveDeNombre, coincideConAlcance, coincideConNota, normalizaBusqueda, proveedoresDelCatalogo, type ProductoParaAlcance,
} from "./conteos-alcance";

/**
 * El bug «No products match» (19 nov): con proveedor + medida, y con proveedor + nota, la vista previa salía vacía; solo
 * «un producto» (por id) funcionaba. Causa en la base (274): la comparación era TEXTO CRUDO del ERP contra el parámetro
 * recortado (`v.name = btrim(p_vendor)`, `p.size_in = btrim(p_size)`): cualquier espacio o mayúscula de más en el ERP
 * dejaba cero filas. La 333 compara normalizado; esta prueba fija la misma regla en TypeScript.
 */

const catalogo: ProductoParaAlcance[] = [
  { id: 1, sku: "PORC-2448-GRY", name: "Porcelain 24x48 Ash Grey", vendor_name: "Daltile", size_in: "24x48", color1: "Gray", collection: "Urban" },
  { id: 2, sku: "PORC-2448-BLK", name: "Porcelain 24x48 Black", vendor_name: "Daltile", size_in: "24 x 48", color1: "Black" },   // medida con espacios (como el ERP)
  { id: 3, sku: "PORC-1224-BLK", name: "Porcelain 12x24 Black", vendor_name: " DALTILE ", size_in: "12x24 ", color1: "Black" },  // proveedor y medida con espacios y mayúsculas
  { id: 4, sku: "CER-1212-WHT", name: "Ceramic 12x12 Matte White", vendor_name: "MSI", size_in: "12x12", style: "Matte" },
  { id: 5, sku: "MOS-HEX", name: "Hexagon Mosaic", vendor_name: "MSI", size_in: null, tags: "black, hex" },
];

describe("la comparación normalizada (la misma que la 333)", () => {
  it("el nombre: sin extremos, espacios colapsados, sin mayúsculas", () => {
    expect(claveDeNombre("  Daltile  ")).toBe("daltile");
    expect(claveDeNombre("DALTILE   Tile")).toBe("daltile tile");
    expect(claveDeNombre(null)).toBe("");
  });
  it("la medida: sin espacios y sin mayúsculas («24 x 48» = «24x48», igual que el ERP)", () => {
    expect(claveDeMedida("24 x 48")).toBe(claveDeMedida("24x48"));
    expect(claveDeMedida("Hex 2IN")).toBe("hex2in");
    expect(claveDeMedida(undefined)).toBe("");
  });
});

describe("proveedor + medida: el alcance encuentra los productos aunque el ERP tenga espacios", () => {
  it("Daltile · 24x48 trae el 24x48 y el «24 x 48», y no el 12x24", () => {
    const ids = catalogo.filter((p) => coincideConAlcance(p, { scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48" })).map((p) => p.id);
    expect(ids).toEqual([1, 2]);
  });
  it("el proveedor con espacios y mayúsculas en el ERP (« DALTILE ») cuenta como Daltile", () => {
    const ids = catalogo.filter((p) => coincideConAlcance(p, { scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "12x24" })).map((p) => p.id);
    expect(ids).toEqual([3]);
  });
  it("la nota es OPCIONAL en proveedor + medida: vacía no filtra; con texto, afina", () => {
    expect(catalogo.filter((p) => coincideConAlcance(p, { scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48", note: "" })).length).toBe(2);
    expect(catalogo.filter((p) => coincideConAlcance(p, { scope_kind: "vendor_size", vendor_name: "Daltile", size_in: "24x48", note: "black" })).map((p) => p.id)).toEqual([2]);
  });
  it("un producto sin medida no entra a una medida", () => {
    expect(catalogo.filter((p) => coincideConAlcance(p, { scope_kind: "vendor_size", vendor_name: "MSI", size_in: "12x12" })).map((p) => p.id)).toEqual([4]);
  });
});

describe("proveedor + nota: la nota es un FILTRO de texto sobre nombre, SKU, colección, etiquetas, color y estilo", () => {
  it("«black» trae los de Daltile con black en nombre o color; no los de MSI", () => {
    const ids = catalogo.filter((p) => coincideConAlcance(p, { scope_kind: "vendor_note", vendor_name: "Daltile", note: "black" })).map((p) => p.id);
    expect(ids).toEqual([2, 3]);
  });
  it("busca en etiquetas, estilo y colección (sin mayúsculas)", () => {
    expect(coincideConNota(catalogo[4], "HEX")).toBe(true);
    expect(coincideConNota(catalogo[3], "matte")).toBe(true);
    expect(coincideConNota(catalogo[0], "urban")).toBe(true);
  });
  it("sin palabra no filtra; con MSI y «black» no hay nada salvo el de las etiquetas", () => {
    expect(coincideConNota(catalogo[0], "")).toBe(true);
    expect(catalogo.filter((p) => coincideConAlcance(p, { scope_kind: "vendor_note", vendor_name: "MSI", note: "black" })).map((p) => p.id)).toEqual([5]);
  });
});

describe("un producto: por id", () => {
  it("solo ese id, sin importar proveedor ni nota", () => {
    expect(catalogo.filter((p) => coincideConAlcance(p, { scope_kind: "product", product_id: 4 })).map((p) => p.id)).toEqual([4]);
    expect(catalogo.filter((p) => coincideConAlcance(p, { scope_kind: "product", product_id: null })).length).toBe(0);
  });
});

describe("los proveedores y sus medidas, como la base (agrupados por nombre normalizado)", () => {
  it("Daltile y « DALTILE » son un solo proveedor; la medida «24 x 48» y «24x48» son una sola", () => {
    const provs = proveedoresDelCatalogo(catalogo);
    const daltile = provs.find((p) => claveDeNombre(p.vendor_name) === "daltile");
    expect(provs.filter((p) => claveDeNombre(p.vendor_name) === "daltile").length).toBe(1);
    expect(daltile?.products).toBe(3);
    expect(daltile?.sizes.map(claveDeMedida).sort()).toEqual(["12x24", "24x48"]);
  });
  it("un proveedor sin medidas en el catálogo sale con la lista vacía", () => {
    const provs = proveedoresDelCatalogo([{ id: 9, sku: "X", name: "X", vendor_name: "Solo", size_in: null }]);
    expect(provs).toEqual([{ vendor_name: "Solo", sizes: [], products: 1 }]);
  });
});

describe("el buscador del teléfono", () => {
  const opciones = ["Daltile", "Dal-Tile Outlet", "MSI", "Marazzi", "Mohawk"];
  it("sin texto, las primeras; al escribir, las que coinciden (sin acentos ni mayúsculas)", () => {
    expect(buscarEnLista(opciones, (x) => x, "", 3)).toEqual(["Daltile", "Dal-Tile Outlet", "MSI"]);
    expect(buscarEnLista(opciones, (x) => x, "MAR")).toEqual(["Marazzi"]);
  });
  it("cada palabra debe aparecer; «24 x 48» encuentra «24x48» (sin espacios)", () => {
    expect(buscarEnLista(["24x48", "12x24", "24x24"], (x) => x, "24 x 48")).toEqual(["24x48"]);
    expect(buscarEnLista(["24x48", "12x24", "24x24"], (x) => x, "24 x")).toHaveLength(3);
    expect(buscarEnLista(opciones, (x) => x, "dal out")).toEqual(["Dal-Tile Outlet"]);
  });
  it("sin acentos: «mosaico» encuentra «Mósaico»", () => {
    expect(normalizaBusqueda("Mósaico Grís")).toBe("mosaico gris");
    expect(buscarEnLista(["Mósaico"], (x) => x, "mosaico")).toEqual(["Mósaico"]);
  });
  it("nada coincide: lista vacía", () => {
    expect(buscarEnLista(opciones, (x) => x, "zzz")).toEqual([]);
  });
});

describe("la base (la 333) compara normalizado en las dos funciones del catálogo", () => {
  const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/333_conteos_revision_y_sistema.sql"), "utf8");
  it("proveedores y productos pasan por warehouse_ops_norm_nombre / _medida", () => {
    expect(SQL).toContain("warehouse_ops_norm_nombre(v.name) = public.warehouse_ops_norm_nombre(p_vendor)");
    expect(SQL).toContain("warehouse_ops_norm_medida(p.size_in) = public.warehouse_ops_norm_medida(p_size)");
    expect(SQL).not.toMatch(/v\.name = btrim\(p_vendor\)/);
    expect(SQL).not.toMatch(/p\.size_in = btrim\(p_size\)/);
  });
  it("la nota de proveedor + medida es opcional (no se exige en la base)", () => {
    expect(SQL).toContain("elsif p_scope_kind = 'vendor_size' and not sin_nota and length(btrim(p_note)) < 2");
  });
});
