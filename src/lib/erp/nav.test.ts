import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { erpNav, navItems, analyticsItems } from "./nav";
import type { AppRole } from "./domain/roles";

// D-NEXT: el menú del ERP tras el traspaso de los cambios de BH (9b906e7, 7ec9380, 99de2dd).
// Se IMPORTA la función que decide; la barra solo la pinta.
const en = (e: string) => e;
const es = (_e: string, s: string) => s;
const hrefs = (xs: { href: string }[]) => xs.map((x) => x.href);

describe("erpNav · quién ve qué", () => {
  it("staff: Catálogo arriba y, en Analítica, SOLO Product Analytics (antes «Dashboard», ya lo veía)", () => {
    const n = erpNav("staff", en);
    expect(hrefs(n.main)).toEqual(["/erp/catalog"]);
    expect(hrefs(n.analytics)).toEqual(["/erp/dashboard"]);
    expect(n.analytics[0].label).toBe("Product Analytics");
  });

  it("manager y admin: Product Analytics primero en Analítica, y las cuatro de siempre detrás", () => {
    for (const role of ["manager", "admin"] as AppRole[]) {
      const n = erpNav(role, en);
      expect(hrefs(n.analytics), role).toEqual([
        "/erp/dashboard", "/erp/analytics/stores", "/erp/analytics/vendors", "/erp/analytics/categories", "/erp/analytics/salespeople",
      ]);
      expect(n.main[0].href, role).toBe("/erp/catalog");
    }
  });

  it("sin catálogo (chofer, almacén: ADR 0010) no hay menú, tampoco Analítica", () => {
    for (const role of ["driver", "warehouse"] as AppRole[]) {
      expect(erpNav(role, en), role).toEqual({ main: [], analytics: [] });
    }
  });

  it("«Dashboard» ya no está en la lista principal, para nadie", () => {
    for (const role of ["staff", "manager", "admin"] as AppRole[]) {
      expect(hrefs(erpNav(role, en).main), role).not.toContain("/erp/dashboard");
    }
  });

  it("Request, PO upload y Bulk apply salen del menú; el resto de manager+ sigue", () => {
    const todo = [...hrefs(erpNav("admin", en).main), ...hrefs(erpNav("admin", en).analytics)];
    for (const fuera of ["/erp/request", "/erp/po-upload", "/erp/decisions"]) expect(todo).not.toContain(fuera);
    expect(hrefs(erpNav("admin", en).main)).toEqual([
      "/erp/catalog", "/erp/purchasing", "/erp/purchasing/orders", "/erp/purchasing/receiving",
      "/erp/inventory", "/erp/review", "/erp/requests", "/erp/master",
    ]);
  });

  it("las etiquetas van en los dos idiomas", () => {
    expect(analyticsItems(es)[0].label).toBe("Analítica de productos");
    expect(navItems(es)[0].label).toBe("Catálogo");
  });
});

describe("las rutas escondidas siguen existiendo y se pueden restaurar", () => {
  it("/erp/request, /erp/po-upload y /erp/decisions conservan su página", () => {
    for (const p of ["src/app/erp/request/page.tsx", "src/app/erp/po-upload/page.tsx", "src/app/erp/decisions/page.tsx"]) {
      expect(() => readFileSync(p, "utf8"), p).not.toThrow();
    }
  });
  it("nav.ts deja escritas, comentadas, las dos líneas exactas para volver a enseñar PO upload y Bulk apply", () => {
    const src = readFileSync("src/lib/erp/nav.ts", "utf8");
    expect(src).toContain('//   { href: "/erp/po-upload", label: t("PO upload", "Subir OC"), managerPlus: true },');
    expect(src).toContain('//   { href: "/erp/decisions", label: t("Bulk apply", "Aplicar en lote"), managerPlus: true },');
  });
  it("la barra lateral y la fila de pastillas de Analítica leen la MISMA lista (no hay segunda copia)", () => {
    const fila = readFileSync("src/components/erp/analytics-nav.tsx", "utf8");
    expect(fila).toContain("analyticsItems(t).map(");
    expect(fila).not.toMatch(/href: "\/erp\/analytics/);
    const barra = readFileSync("src/components/erp/side-nav.tsx", "utf8");
    expect(barra).toContain("erpNav(role, t)");
    expect(barra).not.toMatch(/href: "\/erp\//);
  });
});
