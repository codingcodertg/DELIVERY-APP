import { describe, expect, it } from "vitest";
import { borradorDeFila, faltaLaTabla, filaDeBorrador, precioPorSf, prefijoIlike } from "./almacen";
import { almacenDemo, buscarEnCatalogoDemo, DEMO_ESTIMADO_AJENO, DEMO_OTRO_VENDEDOR, extensionDemo } from "./demo";
import { borradorVacio, lineaSfVacia, lineaUnidadVacia, paraQuienSeImprime } from "./modelo";

describe("sin la 148: «no hay tabla» no es cualquier error", () => {
  it("los códigos de tabla o función que no existe", () => {
    for (const code of ["PGRST205", "PGRST202", "42P01", "42883"]) expect(faltaLaTabla({ code }), code).toBe(true);
  });
  it("un permiso, un duplicado o la red NO son «falta la tabla»", () => {
    for (const code of ["42501", "23505", "PGRST301", "", null]) expect(faltaLaTabla({ code, message: "x" }), String(code)).toBe(false);
    expect(faltaLaTabla(null)).toBe(false);
  });
});

describe("del precio del ERP a $/SF", () => {
  it("por SF, tal cual; por caja, entre los SF de la caja", () => {
    expect(precioPorSf(1.89, "sqft", 23.8)).toBe(1.89);
    expect(precioPorSf(47.6, "box", 23.8)).toBe(2);
  });
  it("por pieza o sin SF/caja no se inventa", () => {
    expect(precioPorSf(10, "piece", 23.8)).toBeNull();
    expect(precioPorSf(47.6, "box", null)).toBeNull();
    expect(precioPorSf(null, "sqft", 10)).toBeNull();
  });
  it("el código se busca por prefijo, sin comodines colados", () => {
    expect(prefijoIlike(" ABC_1%")).toBe("ABC\\_1\\%%");
    expect(prefijoIlike("ABC100")).toBe("ABC100%");
  });
});

describe("de la fila a la pantalla y de vuelta", () => {
  it("lo que se guarda vuelve igual", () => {
    const d = borradorVacio("2026-09-08");
    d.estimate_num = "E-1";
    d.lines = [{ ...lineaSfVacia(), id: "a", requested_sf: 10, sf_per_box: 5, price_per_sf: 2 }, { ...lineaUnidadVacia(), id: "b", unit_price: 385 }];
    const vuelta = borradorDeFila(JSON.parse(JSON.stringify(filaDeBorrador(d))));
    expect(vuelta).toEqual(d);
  });
  it("el navegador NO manda dueño, preparador, tienda ni fechas: los pone el disparador", () => {
    const claves = Object.keys(filaDeBorrador(borradorVacio())).sort();
    expect(claves).toEqual(["customer", "delivery", "display_level", "estimate_num", "lines", "project_summary", "sales_ext", "valid_through"]);
  });
  it("una fila rara no rompe la pantalla", () => {
    const d = borradorDeFila({ estimate_num: "X", lines: "no", display_level: "raro", customer: { salutation: "Dr." } });
    expect(d.lines).toEqual([]);
    expect(d.display_level).toBe("standard");
    expect(d.customer.salutation).toBe("Mr.");
  });
  it("una cotización guardada antes de D-NEXT, con last_name escrito a mano, se abre igual", () => {
    const d = borradorDeFila({
      estimate_num: "E-OLD", sales_ext: "214",
      customer: { salutation: "Ms.", full_name: "Ana Garza Lopez", last_name: "Garza", last_name_edited: true, company: "", phone: "956-555-0100", address: "" },
      lines: [{ kind: "sf", id: "a", customer_category: "x", requested_sf: 10, sf_per_box: 5, price_per_sf: 2 }],
      display_level: "basic", valid_through: "2026-09-08",
    });
    expect(d.customer).toEqual({ salutation: "Ms.", full_name: "Ana Garza Lopez", company: "", phone: "956-555-0100", address: "" });
    expect(d.lines).toHaveLength(1);
    expect(d.display_level).toBe("basic");
    // Lo que se imprime sale del nombre completo, que es lo que se ve en pantalla.
    expect(paraQuienSeImprime(d.customer)).toBe("Ms. Lopez");
  });
});

describe("el demo simula la extensión del expediente (D-NEXT)", () => {
  it("cada vendedor la suya; «Maria Manager» sin ninguna, para medir el caso a mano", () => {
    expect(extensionDemo("u-sales")).toBe("214");
    expect(extensionDemo(DEMO_OTRO_VENDEDOR.id)).toBe("201");
    expect(extensionDemo("u-mgr")).toBeNull();
  });
});

describe("el demo hace lo que haría la 148", () => {
  const yo = { id: "u-sales", name: "Sam Sales", admin: false };

  it("un estimado ajeno se encuentra con su dueño, y no se puede guardar encima", async () => {
    const a = almacenDemo(() => yo, false);
    const r = await a.buscar(` ${DEMO_ESTIMADO_AJENO.toLowerCase()} `);
    expect(r.ok && r.valor?.owner_name).toBe(DEMO_OTRO_VENDEDOR.name);
    const g = await a.guardar(r.ok ? r.valor!.quote_id : "", borradorVacio());
    expect(g.ok).toBe(false);
  });

  it("una sola cotización por estimado: la segunda falla como el índice único", async () => {
    const a = almacenDemo(() => yo, false);
    const d = { ...borradorVacio(), estimate_num: "N-1" };
    expect((await a.guardar(null, d)).ok).toBe(true);
    const otra = await a.guardar(null, { ...d, estimate_num: " n-1" });
    expect(otra.ok).toBe(false);
    expect(!otra.ok && otra.duplicado).toBe(true);
  });

  it("pedir, aprobar el dueño, y entonces sí se guarda", async () => {
    let quien = yo;
    const a = almacenDemo(() => quien, false);
    const r = await a.buscar(DEMO_ESTIMADO_AJENO);
    const qid = r.ok ? r.valor!.quote_id : "";
    expect((await a.pedirAprobacion(qid, null)).ok).toBe(true);
    quien = { id: DEMO_OTRO_VENDEDOR.id, name: DEMO_OTRO_VENDEDOR.name, admin: false };
    const p = await a.pendientes();
    expect(p.ok && p.valor.map((x) => x.requester_name)).toEqual([yo.name]);
    expect((await a.decidir(p.ok ? p.valor[0].approval_id : "", "approved")).ok).toBe(true);
    quien = yo;
    const r2 = await a.buscar(DEMO_ESTIMADO_AJENO);
    expect(r2.ok && r2.valor?.my_approval).toBe("approved");
    expect((await a.guardar(qid, borradorVacio())).ok).toBe(true);
  });

  it("con ?sinTabla=1 se porta como la base sin la 148", async () => {
    const a = almacenDemo(() => yo, true);
    const r = await a.buscar("N-1");
    expect(!r.ok && r.sinTabla).toBe(true);
  });

  it("el catálogo del demo busca por prefijo y es inventado (DEMO-*)", () => {
    expect(buscarEnCatalogoDemo("demo-24").map((p) => p.sku)).toEqual(["DEMO-2448"]);
    expect(buscarEnCatalogoDemo("")).toEqual([]);
  });
});
