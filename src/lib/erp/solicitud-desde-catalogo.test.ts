import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { arranqueDelFormulario, TIPOS_DE_SOLICITUD, TIPOS_DEL_EJECUTOR, TIPOS_QUE_CREAN_BORRADOR } from "./solicitud-campos";

// D-553: «Request» desde la fila del catálogo (traspaso del commit 7ec9380 de BH) y las columnas del
// catálogo en la vista guardada (cca6a99). Lo que decide se importa (arranqueDelFormulario); lo que solo
// enchufa piezas se mide en el fuente, normalizando los finales de línea.
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("arranqueDelFormulario", () => {
  it("sin producto (/erp/request): como antes — «new», con buscador y los seis tipos", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(arranqueDelFormulario(v), String(v)).toEqual({ tipo: "new", productoFijo: null, buscador: true, tipos: TIPOS_DE_SOLICITUD });
    }
  });
  it("desde una fila: «edit», ese producto fijo, sin buscador, y solo los tipos que actúan sobre él", () => {
    const a = arranqueDelFormulario(" PLG2163 ");
    expect(a).toEqual({ tipo: "edit", productoFijo: "PLG2163", buscador: false, tipos: TIPOS_DEL_EJECUTOR });
    expect(a.tipos).not.toContain("new");
    expect(a.tipos).not.toContain("copy");
  });
});

// D-578: «+ Artículo nuevo» en la cabecera del catálogo. El dueño (2026-10-18): «in the erp the buttom to
// create new items where did it went» — D-553 quitó «Request» del menú y la fila no ofrece «new».
describe("«+ Artículo nuevo» (D-578)", () => {
  it("soloNuevos sin producto: arranca en «new» y ofrece exactamente los dos tipos que crean un borrador", () => {
    const a = arranqueDelFormulario(undefined, true);
    expect(a.tipo).toBe("new");
    expect(a.productoFijo).toBeNull();
    expect([...a.tipos]).toEqual(["new", "copy"]);
    expect(a.tipos).toBe(TIPOS_QUE_CREAN_BORRADOR);
    for (const v of ["edit", "reactivate", "deactivate", "discontinue"]) expect(a.tipos, v).not.toContain(v);
  });
  it("un producto manda sobre soloNuevos: la fila sigue arrancando en «edit» sobre ese producto", () => {
    expect(arranqueDelFormulario("PLG2163", true)).toEqual(arranqueDelFormulario("PLG2163"));
    expect(arranqueDelFormulario("PLG2163", true).tipo).toBe("edit");
  });
  it("sin soloNuevos nada cambia respecto a D-553 (el defecto es false)", () => {
    expect(arranqueDelFormulario(undefined, false)).toEqual(arranqueDelFormulario(undefined));
    expect(arranqueDelFormulario(undefined).tipos).toBe(TIPOS_DE_SOLICITUD);
  });

  const tabla = leer("src/components/erp/catalog-table.tsx");
  const cajon = leer("src/components/erp/request-drawer.tsx");
  const form = leer("src/components/erp/request-form.tsx");
  it("la cabecera del catálogo tiene el botón, bilingüe, y solo para quien puede solicitar (canRequest)", () => {
    expect(tabla).toMatch(/\{canRequest && \(\n\s*<Button size="sm" onClick=\{\(\) => setNuevoAbierto\(true\)\}>\{t\("\+ New item", "\+ Artículo nuevo"\)\}<\/Button>/);
  });
  it("el botón abre el MISMO cajón, sin producto, con los mismos desplegables de la página", () => {
    expect(tabla).toMatch(/\{nuevoAbierto && requestPickers && \(\n\s*<RequestDrawer pickers=\{requestPickers\} canSeeCost=\{canSeeCost\} onClose=\{\(\) => setNuevoAbierto\(false\)\} \/>/);
    // Sin `product=`: el cajón de artículo nuevo no apunta a ninguna fila.
    expect(tabla).not.toMatch(/nuevoAbierto && requestPickers && \(\n\s*<RequestDrawer product=/);
  });
  it("sin producto, el cajón monta el formulario de verdad en modo soloNuevos", () => {
    expect(cajon).toContain("<RequestForm {...pickers} canSeeCost={canSeeCost} soloNuevos />");
    expect(cajon).toContain('t("New item", "Artículo nuevo")');
  });
  it("el formulario pasa soloNuevos al arranque, que es quien decide tipo y tipos", () => {
    expect(form).toContain("const arranque = arranqueDelFormulario(targetSku, soloNuevos);");
    expect(form).toMatch(/\{arranque\.tipos\.map\(\(rt\) => \(/);
    expect(form).toContain("useState<TipoDeSolicitud>(arranque.tipo)");
  });
});

describe("el formulario usa el arranque", () => {
  const form = leer("src/components/erp/request-form.tsx");
  it("con producto, lanza sola la MISMA búsqueda del botón «Buscar» (app_products, costo enmascarado)", () => {
    expect(form).toMatch(/const fijo = arranque\.productoFijo;\n\s*useEffect\(\(\) => \{\n\s*if \(fijo\) lookup\(fijo\);/);
    expect(form).toMatch(/onClick=\{\(\) => lookup\(lookupSku\)\}/);
    expect(form).toMatch(/m = await buscarProducto\(code, ""\);/);
    expect(form).toMatch(/await sb\.from\("app_products"\)\.select\(LOOKUP_COLS\)\.eq\("sku", sku\)\.maybeSingle\(\)/);
  });
  it("el buscador de SKU solo se pinta sin producto fijo", () => {
    expect(form).toMatch(/\{arranque\.buscador && \(\n\s*<Field label=\{t\("Find product by SKU"/);
  });
  it("al cambiar de tipo o tras enviar, el producto fijo se queda: solo se deshacen los cambios propuestos", () => {
    expect(form).toMatch(/if \(arranque\.productoFijo\) \{\n(\s*\/\/.*\n)*\s*setEditForm\(original\);\n\s*return;\n\s*\}\n\s*setTarget\(null\);/);
  });
});

describe("el cajón y las páginas", () => {
  it("el cajón pinta el formulario de verdad, apuntando al SKU de la fila", () => {
    const cajon = leer("src/components/erp/request-drawer.tsx");
    expect(cajon).toContain('import { RequestForm } from "@/components/erp/request-form";');
    expect(cajon).toContain("<RequestForm key={product.sku} {...pickers} canSeeCost={canSeeCost} targetSku={product.sku} />");
  });
  it("/erp/catalog y /erp/purchasing/categories cargan los desplegables UNA vez y los pasan a la tabla", () => {
    for (const [ruta, donde] of [["src/app/erp/catalog/page.tsx", "catalog"], ["src/app/erp/purchasing/categories/page.tsx", "purchasing/categories"]]) {
      const p = leer(ruta);
      expect(p.split("loadRequestPickers(").length - 1, ruta).toBe(1);
      expect(p, ruta).toContain(`loadRequestPickers(supabase, "${donde}")`);
      expect(p, ruta).toContain("requestPickers={requestPickers}");
    }
  });
  it("la tabla no consulta nada para el formulario: ni por fila ni al abrir", () => {
    const tabla = leer("src/components/erp/catalog-table.tsx");
    expect(tabla).not.toMatch(/loadRequestPickers\(|createClient\(|product_vocabulary/);
    expect(tabla).toContain("const canRequest = !!requestPickers;");
    expect(tabla).toMatch(/\{requestRow && requestPickers && \(\n\s*<RequestDrawer product=\{requestRow\} pickers=\{requestPickers\} canSeeCost=\{canSeeCost\}/);
    expect(tabla).toContain("<CatalogCards rows={rows} onRequest={canRequest ? setRequestRow : undefined} />");
  });
});

describe("las columnas del catálogo en la tabla", () => {
  const tabla = leer("src/components/erp/catalog-table.tsx");
  it("las columnas salen de catalogColumns, con costo solo para quien lo ve", () => {
    expect(tabla).toContain("catalogColumns({ canSeeCost, canRequest })");
    expect(tabla).toContain("enableSorting: c.canSort, enableHiding: c.canHide");
  });
  it("una vista se aplica con columnStateFromView (vistas viejas → por defecto; costo fuera para staff)", () => {
    expect(tabla).toContain("const cols = columnStateFromView(s, colInfo);");
    expect(tabla).toMatch(/setSorting\(cols\.sorting\);\n\s*setColumnOrder\(cols\.columnOrder\);\n\s*setColumnVisibility\(cols\.columnVisibility\);/);
  });
  it("guardar una vista lleva también las columnas", () => {
    expect(tabla).toContain("currentState={{ globalFilter, statusFilter, recordTab, reviewOnly, sorting, columnVisibility, columnOrder }}");
  });
  it("el menú de cabecera ordena por el estado que lee el SERVIDOR, no en el navegador", () => {
    expect(tabla).toContain("onSort={(desc) => setSorting([{ id: h.column.id, desc }])}");
    expect(tabla).toContain('sortId: sorting[0]?.id ?? "name",');
    expect(tabla).toContain("manualSorting: true,");
  });
  it("el ⚙ Columnas es el de la casa (SelectorDeColumnas), no uno segundo", () => {
    expect(tabla).toContain('import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";');
    expect(tabla).toContain("onAlterna={(key) => setColumnVisibility((v) => toggleColumn(v, infoDe(key)))}");
  });
});
