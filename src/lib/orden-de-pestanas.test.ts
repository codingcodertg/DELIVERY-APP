import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pestanasEnOrden, PESTANAS_DE_OFICINA_POR_AHORA } from "./orden-de-pestanas";
import { canOpenTab, ROLE_INFO, TABS, vaEnGeneral } from "./constants";
import type { UserRole } from "./types";

/**
 * Lo que ve cada rol en la barra de Entregas (D-480). El dueño, 2026-10-06:
 *   «when in office just to oredr and today route office for now»
 *   «orders before todays routes for warehouse»
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ROLES = Object.keys(ROLE_INFO) as UserRole[];
/** Lo que hace la barra: filtra `TABS` con `canOpenTab` y lo ordena con `pestanasEnOrden`. */
const barraDe = (role: UserRole) => pestanasEnOrden(TABS.filter((tb) => canOpenTab(tb.id, { role, permissions: [] })), role);

describe("oficina: Órdenes y Ruta de hoy, y nada más, por ahora", () => {
  it("TABS le da exactamente esas dos, en ese orden, y ninguna en «General»", () => {
    const barra = barraDe("accounting");
    expect(barra.map((tb) => tb.id)).toEqual([...PESTANAS_DE_OFICINA_POR_AHORA]);
    expect(barra.filter((tb) => vaEnGeneral(tb, "accounting"))).toEqual([]);
    expect(barra.map((tb) => tb.label_es)).toEqual(["📋 Órdenes", "🗺 Ruta de hoy"]);
  });

  it("y por eso la guarda de pantalla (TabGate, D-240) la deja fuera de todo lo demás, también por URL", () => {
    const fuera = TABS.filter((tb) => !PESTANAS_DE_OFICINA_POR_AHORA.includes(tb.id));
    expect(fuera.length).toBeGreaterThan(5);
    for (const tb of fuera) expect([tb.id, canOpenTab(tb.id, { role: "accounting", permissions: [] })]).toEqual([tb.id, false]);
  });
});

describe("almacén: Órdenes antes que Ruta de hoy", () => {
  it("su cola (la pestaña que para él se lee «Órdenes») va primero", () => {
    expect(barraDe("warehouse").map((tb) => tb.id)).toEqual(["warehouse", "map"]);
  });

  it("sin reordenar, TABS la pondría detrás: por eso existe pestanasEnOrden", () => {
    expect(TABS.filter((tb) => canOpenTab(tb.id, { role: "warehouse", permissions: [] })).map((tb) => tb.id)).toEqual(["map", "warehouse"]);
  });

  it("solo mueve la suya; lo que le concedan de más queda en el orden de TABS", () => {
    const con = pestanasEnOrden(TABS.filter((tb) => canOpenTab(tb.id, { role: "warehouse", permissions: ["route_plan"] })), "warehouse");
    expect(con.map((tb) => tb.id)).toEqual(["warehouse", "map", "routes"]);
  });

  it("a los demás roles no les cambia el orden ni les quita nada", () => {
    for (const role of ROLES.filter((r) => r !== "warehouse")) {
      const sinOrdenar = TABS.filter((tb) => canOpenTab(tb.id, { role, permissions: [] }));
      expect([role, barraDe(role).map((tb) => tb.id)]).toEqual([role, sinOrdenar.map((tb) => tb.id)]);
    }
    // El admin sigue con el orden de TABS (todo menos «Mi ruta», que es solo del chofer).
    expect(barraDe("admin").map((tb) => tb.id)).toEqual(TABS.filter((tb) => tb.id !== "myroute").map((tb) => tb.id));
  });

  it("no devuelve el mismo arreglo ni lo muta", () => {
    const entrada = [{ id: "map" }, { id: "warehouse" }];
    const salida = pestanasEnOrden(entrada, "warehouse");
    expect(salida).not.toBe(entrada);
    expect(entrada.map((t) => t.id)).toEqual(["map", "warehouse"]);
  });
});

describe("la barra usa la regla", () => {
  it("TopBar ordena las pestañas visibles con pestanasEnOrden antes de repartirlas", () => {
    const barra = sinComentarios(leer("src/components/TopBar.tsx"));
    expect(barra).toContain('import { pestanasEnOrden } from "@/lib/orden-de-pestanas";');
    expect(barra).toContain("const visibleTabs = pestanasEnOrden(TABS.filter((tb) => canOpenTab(tb.id, me)), me.role);");
  });
});

describe("el demo pasa por la misma guarda que producción", () => {
  it("LocalApp envuelve las páginas con TabGate, como el layout de (app)", () => {
    const demo = sinComentarios(leer("src/components/LocalApp.tsx"));
    expect(demo).toContain('import { TabGate } from "@/components/TabGate";');
    expect(demo).toContain("<TabGate>{children}</TabGate>");
  });
});

describe("oficina: un permiso suelto no le abre otra pestaña, por ahora", () => {
  // Los juegos de permisos que tenían de verdad las personas de oficina el 2026-10-06 (medido, sin nombres), más
  // `route_plan` por si alguien se lo concede.
  const JUEGOS = [["create"], ["create", "fulfill", "deliver"], ["leads_all_stores", "fulfill", "settings", "dashboard"], ["create", "fulfill"], ["route_plan"]];

  it("con cualquiera de esos permisos, la barra sigue siendo Órdenes y Ruta de hoy", () => {
    for (const permissions of JUEGOS) {
      const barra = pestanasEnOrden(TABS.filter((tb) => canOpenTab(tb.id, { role: "accounting", permissions })), "accounting");
      expect([permissions.join(","), barra.map((tb) => tb.id)]).toEqual([permissions.join(","), [...PESTANAS_DE_OFICINA_POR_AHORA]]);
    }
  });

  it("y la guarda de pantalla dice que no a Almacén, Chofer, Datos, Panel y Gestor aunque tenga el permiso", () => {
    const todo = { role: "accounting" as UserRole, permissions: ["fulfill", "deliver", "settings", "dashboard", "route_plan"] };
    for (const id of ["warehouse", "driver", "myroute", "data", "dashboard", "routes"]) expect([id, canOpenTab(id, todo)]).toEqual([id, false]);
    expect(canOpenTab("board", todo)).toBe(true);
    expect(canOpenTab("map", todo)).toBe(true);
  });

  it("a los demás roles un permiso suelto les sigue abriendo la pestaña (D-240 no cambia para ellos)", () => {
    expect(canOpenTab("warehouse", { role: "manager", permissions: ["fulfill"] })).toBe(true);
    expect(canOpenTab("routes", { role: "sales", permissions: ["route_plan"] })).toBe(true);
    expect(canOpenTab("data", { role: "manager", permissions: ["settings"] })).toBe(true);
  });

  it("TabGate no le abre «Mi ruta» por la exención de D-240", () => {
    const guarda = sinComentarios(leer("src/components/TabGate.tsx"));
    expect(guarda).toContain("if (TAB_GATE_EXEMPT.includes(tab.id) && !(me && ROLES_CON_PESTANAS_FIJAS.includes(me.role))) return <>{children}</>;");
  });
});
