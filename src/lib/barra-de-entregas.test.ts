import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canOpenTab, ROLE_INFO, TABS } from "./constants";
import { pestanasEnOrden } from "./orden-de-pestanas";
import { opcionesDelMenuDeCuenta } from "./account-menu";
import { muestraElPlanEnMiRuta, PESTANAS_DEL_MENU_DEL_NOMBRE, pestanasDeLaFila, vaEnElMenuDelNombre } from "./barra-de-entregas";
import type { UserRole } from "./types";

// ============================================================
// D-545 · La barra del chofer en Entregas. El dueño, 2026-10-13, con dos capturas del teléfono de Ernesto Castillo:
//   «pretrip inspection goes into the dropdown del name donde esta teaching mode»
//   «el notification icon que vaya arriba al lado de rdz deliveries y el name ya no sera el name solo el bubbl eocn las
//    iniciales ya ete habia pedido eso»
//   «remove that yellow message is not require for the driver» · «also take plan order of the day for driver»
// Lo que decide se importa; el fuente solo se lee para probar que la barra, la página y el CSS usan cada pieza.
// ============================================================

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ROLES = Object.keys(ROLE_INFO) as UserRole[];
const soloEntregas = ["deliveries"];
/** Lo que hace la barra: filtra con `canOpenTab`, ordena con `pestanasEnOrden` y quita lo del menú del nombre. */
const filaDe = (role: UserRole, permissions: string[] = []) =>
  pestanasDeLaFila(pestanasEnOrden(TABS.filter((tb) => canOpenTab(tb.id, { role, permissions })), role)).map((tb) => tb.id);
const menuDe = (role: UserRole, permissions: string[] = []) =>
  opcionesDelMenuDeCuenta({ realRole: role, me: { role, module_access: soloEntregas, permissions } });

describe("la inspección pre-viaje, del renglón de pestañas al menú del nombre", () => {
  it("la lista del menú del nombre es solo la inspección, y la pregunta la reconoce", () => {
    expect([...PESTANAS_DEL_MENU_DEL_NOMBRE]).toEqual(["inspection"]);
    expect(vaEnElMenuDelNombre("inspection")).toBe(true);
    expect(vaEnElMenuDelNombre("myroute")).toBe(false);
    expect(vaEnElMenuDelNombre("driver")).toBe(false);
  });

  it("el chofer: en la fila, Mi ruta y Órdenes; la inspección, la primera del menú, encima de «Modo enseñanza»", () => {
    expect(filaDe("driver")).toEqual(["myroute", "driver"]);
    const menu = menuDe("driver");
    expect(menu.indexOf("inspeccion")).toBe(0);
    expect(menu.indexOf("ensenanza")).toBe(1);
  });

  it("el admin: la inspección tampoco está en su fila, y sí en su menú", () => {
    expect(filaDe("admin")).not.toContain("inspection");
    expect(filaDe("admin").length).toBeGreaterThan(3);
    expect(menuDe("admin")[0]).toBe("inspeccion");
  });

  it("para cada rol, con y sin permisos sueltos: en el menú justo cuando puede abrirla, y nunca en la fila", () => {
    let enMenu = 0;
    for (const role of ROLES) {
      for (const permissions of [[], ["deliver", "fulfill", "route_plan"]]) {
        const puede = canOpenTab("inspection", { role, permissions });
        const menu: string[] = menuDe(role, permissions);
        expect([role, permissions.length, filaDe(role, permissions).includes("inspection")]).toEqual([role, permissions.length, false]);
        expect([role, permissions.length, menu.includes("inspeccion")]).toEqual([role, permissions.length, puede]);
        if (puede) enMenu++;
      }
    }
    // Control: la regla de D-521 sigue (chofer y admin; el permiso suelto no la abre), y la prueba vio los dos casos.
    expect(enMenu).toBe(4);
    expect(menuDe("sales")).not.toContain("inspeccion");
    expect(menuDe("logistics", ["deliver"])).not.toContain("inspeccion");
  });

  it("pestanasDeLaFila conserva el orden, no muta la entrada y no quita nada más", () => {
    const entrada = [{ id: "myroute" }, { id: "inspection" }, { id: "warehouse" }, { id: "driver" }];
    const salida = pestanasDeLaFila(entrada);
    expect(salida.map((t) => t.id)).toEqual(["myroute", "warehouse", "driver"]);
    expect(entrada.map((t) => t.id)).toEqual(["myroute", "inspection", "warehouse", "driver"]);
  });

  it("la ruta /inspection sigue siendo una pestaña de TABS (TabGate la abre igual) para chofer y admin", () => {
    const tb = TABS.find((t) => t.id === "inspection");
    expect(tb?.href).toBe("/inspection");
    expect(canOpenTab("inspection", { role: "driver", permissions: [] })).toBe(true);
    expect(canOpenTab("inspection", { role: "admin", permissions: [] })).toBe(true);
  });
});

describe("la tarjeta del plan y el aviso amarillo de «Mi ruta», no para el chofer", () => {
  it("el chofer no los ve; quien no es chofer (el admin en su pestaña «Chofer», logística) sí; sin rol, no", () => {
    expect(muestraElPlanEnMiRuta("driver")).toBe(false);
    expect(muestraElPlanEnMiRuta("admin")).toBe(true);
    expect(muestraElPlanEnMiRuta("logistics")).toBe(true);
    expect(muestraElPlanEnMiRuta(null)).toBe(false);
    expect(muestraElPlanEnMiRuta(undefined)).toBe(false);
  });
});

describe("la barra y la página usan cada pieza", () => {
  const barra = sinComentarios(leer("src/components/TopBar.tsx"));
  const pagina = sinComentarios(leer("src/app/(app)/my-route/page.tsx"));

  it("TopBar reparte la fila sin lo del menú del nombre, y pinta la inspección como opción del menú", () => {
    expect(barra).toContain('import { pestanasDeLaFila } from "@/lib/barra-de-entregas";');
    expect(barra).toContain("const deLaFila = pestanasDeLaFila(visibleTabs);");
    expect(barra).toContain("{mainTabs.map((tb) => (");
    const caso = barra.slice(barra.indexOf('case "inspeccion":'), barra.indexOf('case "ensenanza":'));
    expect(caso.length).toBeGreaterThan(20);
    expect(caso).toContain('href={inspeccion.href} role="menuitem"');
    expect(caso).toContain("{tabLabel(inspeccion)}");
    expect(barra).toContain('const inspeccion = TABS.find((tb) => tb.id === "inspection");');
  });

  it("«Mi ruta» pinta la tarjeta del plan y el aviso solo con `vePlan`, que es `muestraElPlanEnMiRuta(me?.role)`", () => {
    expect(pagina).toContain("const vePlan = muestraElPlanEnMiRuta(me?.role);");
    expect(pagina).toContain("{vePlan && <MiPlanPublicado plan={planPublicado}");
    expect(pagina).toContain("{vePlan && lectura.cambios && (");
    expect(pagina.split("<MiPlanPublicado ").length - 1).toBe(1);
  });
});

describe("en el teléfono, arriba el nombre, la casa, la campana y solo la burbuja (como D-528 en Time Tracker)", () => {
  const css = leer("src/app/globals.css");
  const barra = sinComentarios(leer("src/components/TopBar.tsx"));
  const inicio = css.indexOf("@media (max-width: 520px) {\n  .topbar .entregas-marca");
  const bloque = inicio < 0 ? "" : css.slice(inicio, css.indexOf("\n}", inicio));

  it("el bloque existe, al mismo ancho que el de Time Tracker (≤ 520 px)", () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(leer("src/app/timetracker/timetracker.css")).toContain("@media(max-width:520px){");
  });

  it("la caja de pestañas, campana y cuenta deja de ser caja; las pestañas bajan a su fila y lo del admin detrás", () => {
    expect(bloque).toContain(".topbar .entregas-barra-resto { display: contents; }");
    expect(bloque).toContain(".topbar .entregas-barra-resto > .tabs { order: 2; flex: 1 1 100%; }");
    expect(bloque).toContain(".topbar .entregas-barra-resto > .entregas-tras-pestanas { order: 3; }");
    expect(bloque).toContain(".topbar .entregas-marca { flex: 1 1 0;");
  });

  it("de la cuenta, solo la burbuja: el nombre se esconde a la vista (no a un lector de pantalla) y el ▾ se quita", () => {
    const nombre = bloque.split("\n").find((l) => l.includes(".menu-cuenta-nombre")) ?? "";
    expect(nombre).toContain(".entregas-barra-resto .account-link .menu-cuenta-nombre");
    expect(nombre).toContain("position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)");
    expect(nombre).not.toContain("display: none");
    expect(nombre).not.toContain("visibility");
    expect(bloque).toContain(".entregas-barra-resto .account-link .menu-cuenta-flecha { display: none; }");
  });

  it("la barra lleva esas clases: el nombre de la app y la casa en la marca; campana y cuenta en el resto", () => {
    expect(barra).toMatch(/<div className="entregas-marca"[^\n]*>\n\s*<h1>[^\n]*<\/h1>\n\s*<HubHomeLink /);
    // Sin estilo en línea: un `display: "flex"` en línea gana a la hoja y el `display: contents` del teléfono no hace nada
    // (medido en la vista del demo: con él, la campana y la burbuja se quedaban en la caja, al lado de las pestañas).
    expect(barra).toContain('<div className="entregas-barra-resto">');
    expect(css).toContain(".entregas-barra-resto { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }");
    const resto = barra.slice(barra.indexOf('<div className="entregas-barra-resto"'));
    expect(resto.indexOf("<NotificationBell />")).toBeGreaterThan(-1);
    expect(resto.indexOf("<MenuDeCuenta nombre={me.full_name}>")).toBeGreaterThan(-1);
    expect(resto.indexOf('<div className="tabs">')).toBeGreaterThan(-1);
    expect(barra.split("entregas-tras-pestanas").length - 1).toBe(3);
  });
});
