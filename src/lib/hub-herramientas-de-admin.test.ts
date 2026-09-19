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
// «my-help» llegó después (ayuda-chat): «Mis solicitudes», para todos. No es de esta decisión, pero la
// lista se afirma entera para que ninguna herramienta aparezca o desaparezca sin que una prueba lo diga.
const VIEJAS = ["users", "directory", "tutorials", "my-help", "help-requests"] as const;

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

// D-306 sacó las DOS de la barra de Entregas. D-NEXT devuelve UNA, a petición del dueño: «add the switch user also in
// the deliveries app as a duplicate». Estas pruebas decían «la barra se queda sin las dos»; se reescriben en positivo,
// no se borran: ahora fijan para quién está el switch, para quién no, y que la vista móvil sigue fuera.
describe("la barra de Entregas: el switch vuelve como duplicado, la vista móvil sigue fuera", () => {
  const barra = sinComentarios(leer("src/components/TopBar.tsx"));
  const plana = barra.replace(/\s+/g, " ");

  it("la vista móvil NO vuelve: ni en el menú del nombre ni en la barra", () => {
    expect(OPCIONES_DEL_MENU as readonly string[]).not.toContain("vistamovil");
    expect(barra).not.toContain('case "vistamovil":');
    expect(barra).not.toContain("enlaceAVistaMovil");
    expect(barra).not.toMatch(/vista-movil|MobilePreview/);
  });

  it("el botón «⇄ Switch user» está, y SOLO para el admin real con la función encendida", () => {
    expect(plana).toContain('{realRole === "admin" && puedeSwitch && ( <div style={{ position: "relative" }}> <button className="tab"');
    expect(plana).toContain('⇄ {t("Switch user", "Cambiar usuario")}');
    expect(plana).toContain("{switchAbierto && <SwitchUserPanel users={users} tiendas={settings.stores ?? []} onClose={() => setSwitchAbierto(false)} />}");
    // Un solo botón y un solo panel: no hay una segunda entrada escondida en otra rama de la barra.
    expect(barra.split("⇄").length - 1).toBe(1);
    expect(barra.split("<SwitchUserPanel").length - 1).toBe(1);
  });

  it("se lo pregunta al servidor UNA vez y solo si el rol es admin; para los demás roles ni pregunta ni botón", () => {
    expect(plana).toContain('useEffect(() => { if (realRole !== "admin") return; let vivo = true; fetch("/api/impersonate/state?ask=switch")');
    expect(plana).toContain("}, [realRole]);");
    expect(barra.split("impersonate/state").length - 1).toBe(1);
    // Por defecto NO: sin respuesta, o con error, el botón no aparece.
    expect(plana).toContain("const [puedeSwitch, setPuedeSwitch] = useState(false);");
    expect(plana).toContain("setPuedeSwitch(d.habilitado === true)");
  });

  it("SUPLANTANDO no sale —ahí manda el botón del banner—: con cookie de retorno el servidor contesta `habilitado: false`", () => {
    const estado = sinComentarios(leer("src/app/api/impersonate/state/route.ts")).replace(/\s+/g, " ");
    // `habilitado` solo se devuelve en la rama SIN cookie de retorno, y solo a un admin leído de la base.
    expect(estado).toContain("if (!guardado) { return NextResponse.json({ habilitado: activa && esAdmin(perfil?.role) }); }");
    // Y en la rama CON cookie —dentro de una suplantación— lo dice en negativo, a las claras.
    expect(estado.slice(estado.indexOf("if (!guardado) {") + 20)).toContain("habilitado: false,");
    expect(estado.split("habilitado").length - 1).toBe(2);
    // La barra exige `true` exacto, y nunca lo da por hecho.
    expect(plana).not.toContain("setPuedeSwitch(true)");
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
    // Con `modo` desde el encargo siguiente (saltar de usuario): las props de D-306 siguen ahí.
    expect(panel).toContain('export function SwitchUserPanel({ users, tiendas, onClose, enPagina = false, modo = "entrar" }');
    expect(panel).toContain("agruparPorTienda(users, tiendas, filtro)");
    expect(pagina).toContain("<SwitchUserPanel users={users} tiendas={settings.stores ?? []} enPagina");
  });

  it("y el camino al servidor no cambia: el mismo POST a /api/impersonate con el id", () => {
    // La ruta la elige `modo`; en el modo de siempre sigue siendo /api/impersonate con el id.
    expect(panel).toContain('const ruta = modo === "saltar" ? "/api/impersonate/switch" : "/api/impersonate";');
    expect(panel).toContain("const r = await fetch(ruta, {");
    expect(panel).toContain("body: JSON.stringify({ targetId: id }),");
  });
});

describe("el rol como tipo cerrado (control)", () => {
  it("ROLE_ORDER cubre los siete roles que conoce el tipo", () => {
    const roles: UserRole[] = ["admin", "manager", "accounting", "logistics", "sales", "warehouse", "driver"];
    expect([...ROLE_ORDER].sort()).toEqual([...roles].sort());
  });
});
