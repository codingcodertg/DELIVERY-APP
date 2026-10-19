import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { erpNav, navItems, analyticsItems, grupos, pestanasDe, pestanaActiva, grupoDe, entradaActiva } from "./nav";
import type { AppRole } from "./domain/roles";

// D-553: el menú del ERP tras el traspaso de los cambios de BH (9b906e7, 7ec9380, 99de2dd).
// D-586: Inventario, Revisión y Aprobaciones pasan a pestañas de Catálogo; OC ↔ Proforma y Recepción,
// a pestañas de Compras; Analítica es UNA entrada con sus pestañas dentro.
// Se IMPORTA la función que decide; la barra y la fila de pestañas solo la pintan.
const en = (e: string) => e;
const es = (_e: string, s: string) => s;
const hrefs = (xs: { href: string }[]) => xs.map((x) => x.href);

// Lo que cada rol veía como ENTRADAS antes de D-586 (la lista de D-553). Agrupar no puede cambiarlo:
// la unión de lo que un rol ve en la barra y en las pestañas tiene que ser exactamente esto.
const ANTES: Record<"staff" | "manager" | "admin", string[]> = {
  staff: ["/erp/catalog", "/erp/dashboard"],
  manager: [
    "/erp/catalog", "/erp/purchasing", "/erp/purchasing/orders", "/erp/purchasing/receiving",
    "/erp/inventory", "/erp/review", "/erp/requests", "/erp/master",
    "/erp/dashboard", "/erp/analytics/stores", "/erp/analytics/vendors", "/erp/analytics/categories", "/erp/analytics/salespeople",
  ],
  admin: [],
};
ANTES.admin = ANTES.manager;

const todoLoQueVe = (role: AppRole) => {
  const barra = hrefs(erpNav(role, en).main);
  const pestanas = (["catalog", "purchasing", "analytics"] as const).flatMap((g) => hrefs(pestanasDe(g, role, en)));
  return new Set([...barra, ...pestanas]);
};

describe("erpNav · la barra (D-586)", () => {
  it("staff: Catálogo y Analítica, nada más; el bloque aparte de Analítica va vacío", () => {
    const n = erpNav("staff", en);
    expect(hrefs(n.main)).toEqual(["/erp/catalog", "/erp/dashboard"]);
    expect(n.main[1].label).toBe("Analytics");
    expect(n.analytics).toEqual([]);
  });

  it("manager y admin: Catálogo, Compras, Excel round-trip y Analítica — cuatro entradas, en ese orden", () => {
    for (const role of ["manager", "admin"] as AppRole[]) {
      const n = erpNav(role, en);
      expect(hrefs(n.main), role).toEqual(["/erp/catalog", "/erp/purchasing", "/erp/master", "/erp/dashboard"]);
      expect(n.analytics, role).toEqual([]);
    }
  });

  it("sin catálogo (chofer, almacén: ADR 0010) no hay menú ni pestañas", () => {
    for (const role of ["driver", "warehouse"] as AppRole[]) {
      expect(erpNav(role, en), role).toEqual({ main: [], analytics: [] });
      for (const g of ["catalog", "purchasing", "analytics"] as const) expect(pestanasDe(g, role, en), `${role} ${g}`).toEqual([]);
    }
  });

  it("Inventory, Review, Approvals, PO ↔ Proforma, Receiving y las de /erp/analytics/* ya no son entradas de la barra", () => {
    for (const role of ["staff", "manager", "admin"] as AppRole[]) {
      const barra = hrefs(erpNav(role, en).main);
      for (const fuera of ["/erp/inventory", "/erp/review", "/erp/requests", "/erp/purchasing/orders", "/erp/purchasing/receiving", "/erp/analytics/stores", "/erp/analytics/vendors", "/erp/analytics/categories", "/erp/analytics/salespeople"]) {
        expect(barra, `${role} ${fuera}`).not.toContain(fuera);
      }
    }
  });

  it("las entradas de grupo saben su grupo; Excel round-trip no tiene", () => {
    const n = erpNav("admin", en).main;
    expect(n.map((i) => i.grupo ?? null)).toEqual(["catalog", "purchasing", null, "analytics"]);
  });
});

describe("pestanasDe · cada rol ve como pestañas exactamente lo que veía como entradas", () => {
  it("staff en Catálogo: solo Catalog (Inventory, Review y Approvals eran manager+)", () => {
    expect(hrefs(pestanasDe("catalog", "staff", en))).toEqual(["/erp/catalog"]);
  });
  it("manager y admin en Catálogo: Catalog · Inventory · Review · Approvals, en ese orden", () => {
    for (const role of ["manager", "admin"] as AppRole[]) {
      const tabs = pestanasDe("catalog", role, en);
      expect(hrefs(tabs), role).toEqual(["/erp/catalog", "/erp/inventory", "/erp/review", "/erp/requests"]);
      expect(tabs.map((x) => x.label), role).toEqual(["Catalog", "Inventory", "Review", "Approvals"]);
    }
  });
  it("staff en Compras: ninguna (Compras entera era manager+)", () => {
    expect(pestanasDe("purchasing", "staff", en)).toEqual([]);
  });
  it("manager y admin en Compras: Purchasing · PO ↔ Proforma · Receiving", () => {
    for (const role of ["manager", "admin"] as AppRole[]) {
      const tabs = pestanasDe("purchasing", role, en);
      expect(hrefs(tabs), role).toEqual(["/erp/purchasing", "/erp/purchasing/orders", "/erp/purchasing/receiving"]);
      expect(tabs.map((x) => x.label), role).toEqual(["Purchasing", "PO ↔ Proforma", "Receiving"]);
    }
  });
  it("staff en Analítica: solo Product Analytics (antes «Dashboard», ya lo veía)", () => {
    const tabs = pestanasDe("analytics", "staff", en);
    expect(hrefs(tabs)).toEqual(["/erp/dashboard"]);
    expect(tabs[0].label).toBe("Product Analytics");
  });
  it("manager y admin en Analítica: Product Analytics primero y las cuatro de siempre detrás", () => {
    for (const role of ["manager", "admin"] as AppRole[]) {
      expect(hrefs(pestanasDe("analytics", role, en)), role).toEqual([
        "/erp/dashboard", "/erp/analytics/stores", "/erp/analytics/vendors", "/erp/analytics/categories", "/erp/analytics/salespeople",
      ]);
    }
  });
  it("la unión barra + pestañas de cada rol es EXACTAMENTE la lista de entradas de D-553: nadie gana ni pierde nada", () => {
    for (const role of ["staff", "manager", "admin"] as const) {
      expect([...todoLoQueVe(role)].sort(), role).toEqual([...new Set(ANTES[role])].sort());
    }
  });
  it("la entrada de cada grupo apunta a su primera pestaña, la que ve todo el que ve el grupo", () => {
    for (const g of grupos(en)) {
      expect(g.href, g.grupo).toBe(g.tabs[0].href);
      expect(Boolean(g.tabs[0].managerPlus), g.grupo).toBe(Boolean(g.managerPlus));
    }
  });
});

describe("pestanaActiva / grupoDe / entradaActiva · qué se enciende", () => {
  const compras = pestanasDe("purchasing", "admin", en);
  const catalogo = pestanasDe("catalog", "admin", en);
  it("gana el href más largo que cubre la ruta: /purchasing/orders enciende OC ↔ Proforma, no Compras", () => {
    expect(pestanaActiva(compras, "/erp/purchasing/orders")).toBe("/erp/purchasing/orders");
    expect(pestanaActiva(compras, "/erp/purchasing/orders/17")).toBe("/erp/purchasing/orders");
    expect(pestanaActiva(compras, "/erp/purchasing")).toBe("/erp/purchasing");
    expect(pestanaActiva(compras, "/erp/purchasing/categories")).toBe("/erp/purchasing");
  });
  it("por segmento: /erp/request (solicitud) no enciende /erp/requests (aprobaciones), y fuera del grupo es null", () => {
    expect(pestanaActiva(catalogo, "/erp/request")).toBeNull();
    expect(pestanaActiva(catalogo, "/erp/requests")).toBe("/erp/requests");
    expect(pestanaActiva(catalogo, "/erp/review/merge")).toBe("/erp/review");
    expect(pestanaActiva(catalogo, "/erp/product/123")).toBeNull();
    // Con las pestañas reales ningún href es prefijo de texto de otra ruta real; la propiedad se mide con
    // una lista sintética (la función admite cualquiera): «/erp/requests» NO está bajo «/erp/request».
    expect(pestanaActiva([{ href: "/erp/request", label: "x" }], "/erp/requests")).toBeNull();
    expect(pestanaActiva([{ href: "/erp/request", label: "x" }], "/erp/request/7")).toBe("/erp/request");
  });
  it("grupoDe: las subrutas caen en su grupo; las escondidas y producto, en ninguno", () => {
    expect(grupoDe("/erp/inventory")).toBe("catalog");
    expect(grupoDe("/erp/review/daltile")).toBe("catalog");
    expect(grupoDe("/erp/purchasing/orders/new")).toBe("purchasing");
    expect(grupoDe("/erp/analytics/vendors")).toBe("analytics");
    expect(grupoDe("/erp/dashboard")).toBe("analytics");
    for (const p of ["/erp/po-upload", "/erp/decisions", "/erp/request", "/erp/product/1", "/erp/master"]) expect(grupoDe(p), p).toBeNull();
  });
  it("entradaActiva: Catálogo se enciende en /erp/inventory; Excel round-trip por su href; Clientes (sin grupo) por prefijo", () => {
    const main = erpNav("admin", en).main;
    expect(entradaActiva(main, "/erp/inventory")).toBe("/erp/catalog");
    expect(entradaActiva(main, "/erp/purchasing/receiving")).toBe("/erp/purchasing");
    expect(entradaActiva(main, "/erp/analytics/stores")).toBe("/erp/dashboard");
    expect(entradaActiva(main, "/erp/master")).toBe("/erp/master");
    expect(entradaActiva(main, "/erp/product/9")).toBeNull();
    const clientes = [{ href: "/customers", label: "Customers" }];
    expect(entradaActiva(clientes, "/customers/42")).toBe("/customers");
    expect(entradaActiva(clientes, "/erp/catalog")).toBeNull();
  });
});

describe("las etiquetas van en los dos idiomas", () => {
  it("grupos, pestañas y Analítica", () => {
    expect(navItems(es).map((i) => i.label)).toEqual(["Catálogo", "Compras", "Ida y vuelta Excel", "Analítica"]);
    expect(pestanasDe("catalog", "admin", es).map((i) => i.label)).toEqual(["Catálogo", "Inventario", "Revisión", "Aprobaciones"]);
    expect(pestanasDe("purchasing", "admin", es).map((i) => i.label)).toEqual(["Compras", "OC ↔ Proforma", "Recepción"]);
    expect(analyticsItems(es)[0].label).toBe("Analítica de productos");
  });
});

describe("las rutas siguen existiendo", () => {
  it("las que pasaron a pestaña conservan su página (marcadores viejos): la pestaña es un enlace a ella", () => {
    for (const p of [
      "src/app/erp/inventory/page.tsx", "src/app/erp/review/page.tsx", "src/app/erp/requests/page.tsx",
      "src/app/erp/purchasing/orders/page.tsx", "src/app/erp/purchasing/receiving/page.tsx",
      "src/app/erp/analytics/stores/page.tsx", "src/app/erp/analytics/vendors/page.tsx",
      "src/app/erp/analytics/categories/page.tsx", "src/app/erp/analytics/salespeople/page.tsx",
    ]) {
      expect(() => readFileSync(p, "utf8"), p).not.toThrow();
    }
  });
  it("/erp/request, /erp/po-upload y /erp/decisions (escondidas en D-553) conservan su página", () => {
    for (const p of ["src/app/erp/request/page.tsx", "src/app/erp/po-upload/page.tsx", "src/app/erp/decisions/page.tsx"]) {
      expect(() => readFileSync(p, "utf8"), p).not.toThrow();
    }
  });
  it("nav.ts deja escritas, comentadas, las dos líneas exactas para volver a enseñar PO upload y Bulk apply", () => {
    const src = readFileSync("src/lib/erp/nav.ts", "utf8");
    expect(src).toContain('//   { href: "/erp/po-upload", label: t("PO upload", "Subir OC"), managerPlus: true },');
    expect(src).toContain('//   { href: "/erp/decisions", label: t("Bulk apply", "Aplicar en lote"), managerPlus: true },');
  });
  it("cada página de un grupo pinta la fila de pestañas de SU grupo con el rol de la sesión", () => {
    const esperado: Record<string, string> = {
      "src/app/erp/catalog/page.tsx": "catalog", "src/app/erp/inventory/page.tsx": "catalog",
      "src/app/erp/review/page.tsx": "catalog", "src/app/erp/requests/page.tsx": "catalog",
      "src/app/erp/purchasing/page.tsx": "purchasing", "src/app/erp/purchasing/orders/page.tsx": "purchasing",
      "src/app/erp/purchasing/receiving/page.tsx": "purchasing",
      "src/app/erp/dashboard/page.tsx": "analytics", "src/app/erp/analytics/stores/page.tsx": "analytics",
      "src/app/erp/analytics/vendors/page.tsx": "analytics", "src/app/erp/analytics/categories/page.tsx": "analytics",
      "src/app/erp/analytics/salespeople/page.tsx": "analytics",
    };
    for (const [p, g] of Object.entries(esperado)) {
      expect(readFileSync(p, "utf8"), p).toContain(`<GroupTabs grupo="${g}" role={session.role} />`);
    }
  });
  it("la barra y la fila de pestañas leen nav.ts (no hay segunda copia de hrefs)", () => {
    const fila = readFileSync("src/components/erp/group-tabs.tsx", "utf8");
    expect(fila).toContain("pestanasDe(grupo, role, t)");
    expect(fila).not.toMatch(/href: "\/erp\//);
    const barra = readFileSync("src/components/erp/side-nav.tsx", "utf8");
    expect(barra).toContain("erpNav(role, t)");
    expect(barra).toContain("entradaActiva(");
    expect(barra).not.toMatch(/href: "\/erp\//);
  });
});
