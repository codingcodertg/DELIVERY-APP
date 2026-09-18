import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canReachHub, HUB_TOOLS, ROLE_ORDER, soloAdminReal } from "./constants";
import { OPCIONES_DEL_MENU } from "./account-menu";
import type { UserRole } from "./types";

/**
 * «Vista móvil» y «Cambiar de usuario» son herramientas del hub, solo para el admin real (D-306).
 *
 * El dueño: «la vista móvil y el switch usuario, pásalos al hub, porque eso es general del hub… no
 * solo delivery app». Vivían en la barra de Entregas (D-278 y D-247).
 *
 * «Admin real» son dos cosas y las dos se prueban: el rol de la sesión es admin, y **no está dentro
 * de la sesión de otra persona** (D-243). Lo segundo no lo sabe `role` —dentro de una impersonación
 * la sesión ES la del suplantado— y por eso `visible` recibe `suplantando`, que el lobby lee de la
 * cookie de retorno en el servidor, una vez.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NUEVAS = ["vista-movil", "switch-user"] as const;
const VIEJAS = ["users", "directory", "tutorials", "help-requests"] as const;

describe("las dos herramientas nuevas del hub", () => {
  it("existen, con su ruta, y son las únicas nuevas", () => {
    expect(HUB_TOOLS.map((t) => t.key)).toEqual([...VIEJAS, ...NUEVAS]);
    expect(HUB_TOOLS.find((t) => t.key === "vista-movil")?.href).toBe("/home/vista-movil");
    expect(HUB_TOOLS.find((t) => t.key === "switch-user")?.href).toBe("/home/switch-user");
  });

  it("las ve el admin real, rol por rol", () => {
    for (const key of NUEVAS) {
      const tool = HUB_TOOLS.find((t) => t.key === key)!;
      for (const role of ROLE_ORDER) {
        expect([key, role, tool.visible({ role })]).toEqual([key, role, role === "admin"]);
      }
    }
  });

  it("y NO las ve un admin que está dentro de la sesión de otra persona", () => {
    for (const key of NUEVAS) {
      const tool = HUB_TOOLS.find((t) => t.key === key)!;
      expect([key, tool.visible({ role: "admin", suplantando: true })]).toEqual([key, false]);
      expect([key, tool.visible({ role: "admin", suplantando: false })]).toEqual([key, true]);
      expect([key, tool.visible({ role: "admin" })]).toEqual([key, true]);
    }
    expect(soloAdminReal({ role: "admin", suplantando: true })).toBe(false);
    expect(soloAdminReal({ role: "manager", suplantando: false })).toBe(false);
  });

  it("las cuatro herramientas de antes ignoran `suplantando`: no cambian", () => {
    for (const key of VIEJAS) {
      const tool = HUB_TOOLS.find((t) => t.key === key)!;
      for (const role of ROLE_ORDER) {
        expect([key, role, tool.visible({ role, suplantando: true })]).toEqual([key, role, tool.visible({ role, suplantando: false })]);
        expect([key, role, tool.visible({ role, suplantando: true })]).toEqual([key, role, tool.visible({ role })]);
      }
    }
  });

  it("no cambian quién llega al lobby: el admin ya llegaba por Usuarios", () => {
    expect(canReachHub({ role: "admin", module_access: ["deliveries"] })).toBe(true);
    for (const role of ROLE_ORDER.filter((r) => r !== "admin" && r !== "driver")) {
      expect([role, canReachHub({ role, module_access: ["deliveries"] })]).toEqual([role, true]);
    }
    expect(canReachHub({ role: "driver", module_access: ["deliveries"] })).toBe(false);
  });
});

describe("el lobby sabe si se está suplantando, una vez y en el servidor", () => {
  const lobby = sinComentarios(leer("src/app/home/page.tsx"));
  const selector = sinComentarios(leer("src/components/HomeSelector.tsx"));

  it("lee la cookie de retorno con el mismo lector que las rutas de impersonación", () => {
    expect(lobby).toContain('import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";');
    expect(lobby).toContain("const suplantando = desempaquetar((await cookies()).get(COOKIE_RETORNO)?.value ?? null) !== null;");
    expect(lobby).toContain("<HomeSelector me={me} suplantando={suplantando} />");
    // Y ninguna petición nueva: no se llama a /api/impersonate/state desde el lobby.
    expect(lobby).not.toContain("impersonate/state");
  });

  it("y el selector se lo pasa a cada herramienta", () => {
    expect(selector).toContain("const tools = HUB_TOOLS.filter((tool) => tool.visible({ ...me, suplantando }));");
  });
});

describe("la barra de Entregas se queda sin las dos", () => {
  const barra = sinComentarios(leer("src/components/TopBar.tsx"));

  it("ni vista móvil en el menú del nombre, ni botón de switch, ni la pregunta al servidor", () => {
    expect(OPCIONES_DEL_MENU as readonly string[]).not.toContain("vistamovil");
    expect(barra).not.toContain('case "vistamovil":');
    expect(barra).not.toContain("SwitchUserPanel");
    expect(barra).not.toContain("puedeSwitch");
    expect(barra).not.toContain("impersonate/state");
    expect(barra).not.toContain("enlaceAVistaMovil");
    // Y el botón en sí, no solo el panel que abría: devolver un botón pelado con el texto de antes
    // dejaba esta prueba en verde (lo cazó un mutante). Se mira el texto y el símbolo, sin comentarios.
    expect(barra).not.toContain('"Switch user"');
    expect(barra).not.toContain("⇄");
  });

  it("y ninguna otra app las tenía: no hay copia que unificar", () => {
    for (const f of ["src/components/recruiting/TopBar.tsx", "src/components/timetracker/TopBar.tsx"]) {
      const src = sinComentarios(leer(f));
      expect(src, f).not.toContain("SwitchUserPanel");
      expect(src, f).not.toContain("vista-movil");
    }
  });

  it("el aviso de suplantación y «Volver a mi cuenta» siguen en la raíz, para todas las apps", () => {
    expect(leer("src/app/layout.tsx")).toContain("<ImpersonationBanner />");
    expect(leer("src/components/ImpersonationBanner.tsx")).toContain('fetch("/api/impersonate/return"');
  });

  it("desde Entregas, la casa lleva al lobby en un clic con la misma regla de siempre", () => {
    expect(barra).toMatch(/<HubHomeLink deliveriesRole=\{me\.role\} moduleAccess=\{me\.module_access\} \/>/);
    expect(sinComentarios(leer("src/components/HubHomeLink.tsx"))).toMatch(/if \(!canReachHub\([^\n]*\) return null;/);
  });
});

describe("la página de cambiar de usuario", () => {
  const puerta = sinComentarios(leer("src/app/home/switch-user/layout.tsx"));
  const pagina = sinComentarios(leer("src/app/home/switch-user/page.tsx"));
  const panel = sinComentarios(leer("src/components/SwitchUserPanel.tsx"));

  it("la puerta es del servidor: admin por el rol de la sesión, y fuera si se está suplantando", () => {
    expect(puerta).toContain("auth.getUser()");
    expect(puerta).toContain('if (me.role !== "admin") redirect(landingRoute(me));');
    expect(puerta).toContain("const suplantando = desempaquetar((await cookies()).get(COOKIE_RETORNO)?.value ?? null) !== null;");
    expect(puerta).toContain('if (suplantando) redirect("/home");');
    // Las dos comprobaciones van antes de pintar nada.
    expect(puerta.indexOf('redirect("/home")')).toBeLessThan(puerta.indexOf("{children}"));
    // Y monta el proveedor aquí, como Usuarios, no en el lobby.
    expect(puerta).toContain("<DataProvider me={me}>");
    expect(sinComentarios(leer("src/app/home/layout.tsx"))).not.toContain("<DataProvider");
  });

  it("pregunta al servidor si la función está encendida antes de pintar la lista, como hacía la barra", () => {
    expect(pagina).toContain('fetch("/api/impersonate/state?ask=switch")');
    expect(pagina).toContain("{habilitado === true && (");
  });

  it("el panel recibe lo que pinta y ya no lee `useData`", () => {
    expect(panel).not.toContain("useData");
    expect(panel).toContain("export function SwitchUserPanel({ users, tiendas, onClose, enPagina = false }");
    expect(panel).toContain("agruparPorTienda(users, tiendas, filtro)");
    expect(pagina).toContain("<SwitchUserPanel users={users} tiendas={settings.stores ?? []} enPagina");
  });

  it("y el camino al servidor no cambia: el mismo POST a /api/impersonate con el id", () => {
    expect(panel).toContain('fetch("/api/impersonate", {');
    expect(panel).toContain("body: JSON.stringify({ targetId: id }),");
  });
});

describe("el rol como tipo cerrado (control)", () => {
  it("ROLE_ORDER cubre los siete roles que conoce el tipo", () => {
    const roles: UserRole[] = ["admin", "manager", "accounting", "logistics", "sales", "warehouse", "driver"];
    expect([...ROLE_ORDER].sort()).toEqual([...roles].sort());
  });
});
