import { describe, it, expect } from "vitest";
import {
  DEFAULT_SORTING,
  COST_COLUMN_IDS,
  catalogColumns,
  canMoveColumn,
  columnStateFromView,
  inOrder,
  isCustomOrder,
  moveColumn,
  resolveColumnOrder,
  resolveColumnVisibility,
  resolveSorting,
  toggleColumn,
  hideColumn,
  visibleIds,
} from "./catalog-columns";
import { CATALOG_SORTS } from "./catalog";

// D-553: las columnas del catálogo, traspaso del commit cca6a99 de BH. Las listas salen de la MISMA
// función que usa la tabla (catalogColumns), no de una copia escrita aquí.
const STAFF = catalogColumns({ canSeeCost: false, canRequest: true });
const MANAGER = catalogColumns({ canSeeCost: true, canRequest: true });
const ids = (cols: { id: string }[]) => cols.map((c) => c.id);

describe("catalogColumns · qué columnas tiene cada sesión", () => {
  it("staff no tiene Cost ni Margin; manager sí, detrás de Price", () => {
    for (const c of COST_COLUMN_IDS) expect(ids(STAFF)).not.toContain(c);
    const m = ids(MANAGER);
    expect(m.indexOf("cost")).toBe(m.indexOf("price") + 1);
    expect(m.indexOf("margin_pct")).toBe(m.indexOf("cost") + 1);
  });

  it("Request va justo después de Name, y solo si hay formulario que abrir", () => {
    expect(ids(STAFF).indexOf("request")).toBe(ids(STAFF).indexOf("name") + 1);
    expect(ids(catalogColumns({ canSeeCost: true, canRequest: false }))).not.toContain("request");
  });

  it("Name no se puede ocultar; el resto sí", () => {
    for (const c of MANAGER) expect(c.canHide, c.id).toBe(c.id !== "name");
  });

  it("se ordena exactamente por lo que ordena el servidor (CATALOG_SORTS)", () => {
    for (const c of MANAGER) expect(c.canSort, c.id).toBe(CATALOG_SORTS.has(c.id));
    expect(MANAGER.filter((c) => !c.canSort).map((c) => c.id)).toEqual(["thumb", "request", "review"]);
  });

  it("cada columna lleva etiqueta en los dos idiomas", () => {
    for (const c of MANAGER) expect(c.en && c.es, c.id).toBeTruthy();
  });
});

describe("resolveColumnOrder", () => {
  it("es el orden por defecto si la vista no guardó ninguno (vistas de antes de D-553)", () => {
    expect(resolveColumnOrder(undefined, ids(STAFF))).toEqual(ids(STAFF));
    expect(resolveColumnOrder([], ids(STAFF))).toEqual(ids(STAFF));
    expect(resolveColumnOrder("sku,name", ids(STAFF))).toEqual(ids(STAFF));
  });

  it("respeta un orden guardado completo", () => {
    const saved = [...ids(STAFF)].reverse();
    expect(resolveColumnOrder(saved, ids(STAFF))).toEqual(saved);
  });

  it("tira los ids que la sesión no tiene: una vista de manager no le da costo a staff", () => {
    const managerOrder = ["cost", "margin_pct", ...ids(STAFF)];
    const out = resolveColumnOrder(managerOrder, ids(STAFF));
    expect(out).not.toContain("cost");
    expect(out).not.toContain("margin_pct");
    expect(out).toEqual(ids(STAFF));
  });

  it("pone las columnas que la vista no conocía junto a su vecina, no al final", () => {
    // Guardada por staff con Name primero; abierta luego por una sesión que además tiene costo.
    const staffOrder = ["name", ...ids(STAFF).filter((id) => id !== "name")];
    const out = resolveColumnOrder(staffOrder, ids(MANAGER));
    expect(out.indexOf("cost")).toBe(out.indexOf("price") + 1);
    expect(out.indexOf("margin_pct")).toBe(out.indexOf("cost") + 1);
    expect(out[0]).toBe("name");
    expect([...out].sort()).toEqual([...ids(MANAGER)].sort());
  });

  it("una primera columna que falta vuelve al principio", () => {
    expect(resolveColumnOrder(["sku", "name"], ["thumb", "sku", "name"])).toEqual(["thumb", "sku", "name"]);
  });

  it("ignora duplicados y lo que no es texto", () => {
    expect(resolveColumnOrder(["sku", "sku", 7, null, "thumb"], ["thumb", "sku", "name"])).toEqual(["sku", "name", "thumb"]);
  });
});

describe("resolveColumnVisibility", () => {
  it("vacío (todo se ve) si la vista no guardó nada", () => {
    expect(resolveColumnVisibility(undefined, STAFF)).toEqual({});
    expect(resolveColumnVisibility(null, STAFF)).toEqual({});
    expect(resolveColumnVisibility(["qoh"], STAFF)).toEqual({});
  });

  it("guarda los booleanos de columnas reales", () => {
    expect(resolveColumnVisibility({ qoh: false, sku: true }, STAFF)).toEqual({ qoh: false, sku: true });
  });

  it("tira los ids que la sesión no tiene: costo no se enciende para staff", () => {
    expect(resolveColumnVisibility({ cost: true, margin_pct: true, qoh: false }, STAFF)).toEqual({ qoh: false });
  });

  it("nunca oculta Name, e ignora valores que no son booleanos", () => {
    expect(resolveColumnVisibility({ name: false, qoh: "no", sku: 0 }, STAFF)).toEqual({});
  });
});

describe("resolveSorting", () => {
  it("respeta una ordenación guardada por una columna ordenable", () => {
    expect(resolveSorting([{ id: "price", desc: true }], STAFF)).toEqual([{ id: "price", desc: true }]);
  });

  it("se queda con la primera: el servidor solo ordena por una", () => {
    expect(resolveSorting([{ id: "sku", desc: false }, { id: "price", desc: true }], STAFF)).toEqual([{ id: "sku", desc: false }]);
  });

  it("cae a la de por defecto si falta, no se ordena por ella, o no existe (costo para staff)", () => {
    expect(resolveSorting(undefined, STAFF)).toEqual(DEFAULT_SORTING);
    expect(resolveSorting([], STAFF)).toEqual(DEFAULT_SORTING);
    expect(resolveSorting([{ id: "thumb", desc: false }], STAFF)).toEqual(DEFAULT_SORTING);
    expect(resolveSorting([{ id: "request", desc: false }], STAFF)).toEqual(DEFAULT_SORTING);
    expect(resolveSorting([{ id: "cost", desc: true }], STAFF)).toEqual(DEFAULT_SORTING);
    expect(resolveSorting([{ id: "cost", desc: true }], MANAGER)).toEqual([{ id: "cost", desc: true }]);
  });
});

describe("columnStateFromView", () => {
  it("una vista vieja (filtros + orden, sin columnas) abre en la disposición por defecto con su orden", () => {
    const old = { globalFilter: "", statusFilter: "active", recordTab: "all", reviewOnly: false, sorting: [{ id: "qoh", desc: true }] };
    expect(columnStateFromView(old, MANAGER)).toEqual({
      columnOrder: ids(MANAGER),
      columnVisibility: {},
      sorting: [{ id: "qoh", desc: true }],
    });
  });

  it("un chip prefijado (sin orden tampoco) abre en la disposición y el orden por defecto", () => {
    expect(columnStateFromView({ statusFilter: "active" }, STAFF)).toEqual({
      columnOrder: ids(STAFF),
      columnVisibility: {},
      sorting: DEFAULT_SORTING,
    });
  });

  it("restaura una vista guardada con columnas", () => {
    const order = moveColumn(ids(STAFF), "qoh", -1);
    const out = columnStateFromView({ columnOrder: order, columnVisibility: { thumb: false }, sorting: [{ id: "vendor_name", desc: false }] }, STAFF);
    expect(out.columnOrder).toEqual(order);
    expect(out.columnVisibility).toEqual({ thumb: false });
    expect(out.sorting).toEqual([{ id: "vendor_name", desc: false }]);
  });

  it("una vista de manager abierta por staff: costo fuera del orden, de la visibilidad y de la ordenación", () => {
    const vistaDeManager = { columnOrder: ["cost", ...ids(MANAGER)], columnVisibility: { cost: true, margin_pct: true }, sorting: [{ id: "margin_pct", desc: true }] };
    const out = columnStateFromView(vistaDeManager, STAFF);
    expect(JSON.stringify(out)).not.toMatch(/cost|margin_pct/);
    expect(out.sorting).toEqual(DEFAULT_SORTING);
  });
});

describe("moveColumn / canMoveColumn", () => {
  const order = ["a", "b", "c"];
  it("intercambia una columna con su vecina", () => {
    expect(moveColumn(order, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveColumn(order, "b", 1)).toEqual(["a", "c", "b"]);
  });
  it("no hace nada pasado un extremo o con un id desconocido", () => {
    expect(moveColumn(order, "a", -1)).toEqual(order);
    expect(moveColumn(order, "c", 1)).toEqual(order);
    expect(moveColumn(order, "z", 1)).toEqual(order);
    expect([canMoveColumn(order, "a", -1), canMoveColumn(order, "c", 1), canMoveColumn(order, "z", 1)]).toEqual([false, false, false]);
    expect([canMoveColumn(order, "a", 1), canMoveColumn(order, "c", -1)]).toEqual([true, true]);
  });
  it("no muta lo que recibe", () => {
    moveColumn(order, "b", 1);
    expect(order).toEqual(["a", "b", "c"]);
  });
});

describe("lo que el ⚙ Columnas enseña", () => {
  it("inOrder: las columnas en el orden de la persona, sin perder ninguna", () => {
    const order = moveColumn(ids(STAFF), "qoh", -1);
    expect(ids(inOrder(STAFF, order))).toEqual(order);
    expect(ids(inOrder(STAFF, []))).toEqual(ids(STAFF));
  });
  it("visibleIds: ausente = se ve; Name se ve aunque el mapa diga que no", () => {
    expect(visibleIds(STAFF, {})).toEqual(ids(STAFF));
    expect(visibleIds(STAFF, { qoh: false, name: false })).toEqual(ids(STAFF).filter((id) => id !== "qoh"));
  });
  it("toggleColumn: oculta y vuelve a enseñar; con Name no hace nada", () => {
    const qoh = STAFF.find((c) => c.id === "qoh")!;
    const name = STAFF.find((c) => c.id === "name")!;
    const oculta = toggleColumn({}, qoh);
    expect(oculta).toEqual({ qoh: false });
    expect(toggleColumn(oculta, qoh)).toEqual({ qoh: true });
    expect(toggleColumn({}, name)).toEqual({});
  });
  it("hideColumn (menú de cabecera): siempre oculta, también si ya estaba oculta; con Name no hace nada", () => {
    const qoh = STAFF.find((c) => c.id === "qoh")!;
    const name = STAFF.find((c) => c.id === "name")!;
    expect(hideColumn({}, qoh)).toEqual({ qoh: false });
    expect(hideColumn({ qoh: false }, qoh)).toEqual({ qoh: false });
    expect(hideColumn({ qoh: true }, qoh)).toEqual({ qoh: false });
    expect(hideColumn({}, name)).toEqual({});
  });
  it("isCustomOrder: solo cuando el orden difiere del de por defecto", () => {
    expect(isCustomOrder([], ids(STAFF))).toBe(false);
    expect(isCustomOrder(ids(STAFF), ids(STAFF))).toBe(false);
    expect(isCustomOrder(moveColumn(ids(STAFF), "qoh", -1), ids(STAFF))).toBe(true);
  });
});
