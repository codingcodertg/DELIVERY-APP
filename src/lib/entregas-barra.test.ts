import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { canReachHub } from "./constants";
import { OPCIONES_DEL_MENU, opcionesDelMenuDeCuenta } from "./account-menu";

/**
 * La barra de Entregas sin selector de módulos, sin etiqueta de rol y con el menú en el nombre (D-274).
 *
 * Dos clases de prueba:
 *   1. Qué opciones tiene el menú, con la misma entrada que le da la barra (rol real, y rol y módulos
 *      efectivos) y pasando por `canReachHub` de verdad.
 *   2. La barra, la casa, la Cuenta y Ajustes, leyendo el código que ejecuta.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

describe("el menú del nombre, con la entrada de la barra", () => {
  const soloEntregas = ["deliveries"];

  it("las entradas significan lo que dicen (control): el chofer no llega al hub, un vendedor sí", () => {
    expect(canReachHub({ role: "driver", module_access: soloEntregas })).toBe(false);
    expect(canReachHub({ role: "sales", module_access: soloEntregas })).toBe(true);
  });

  it("un vendedor: modo enseñanza y salir, nada más", () => {
    expect(opcionesDelMenuDeCuenta({ realRole: "sales", me: { role: "sales", module_access: soloEntregas } }))
      .toEqual(["ensenanza", "salir"]);
  });

  it("el chofer, que no ve la casa, tiene aquí Mi perfil y Tutoriales", () => {
    expect(opcionesDelMenuDeCuenta({ realRole: "driver", me: { role: "driver", module_access: soloEntregas } }))
      .toEqual(["ensenanza", "perfil", "tutoriales", "salir"]);
  });

  it("el admin: ver como, vista móvil y ajustes, y salir el último", () => {
    // Sin «vistamovil» desde D-306: se fue al hub con «Cambiar de usuario».
    expect(opcionesDelMenuDeCuenta({ realRole: "admin", me: { role: "admin", module_access: soloEntregas } }))
      .toEqual(["ensenanza", "vercomo", "ajustes", "salir"]);
  });

  it("el admin viendo como vendedor: conserva «ver como» para volver, y pierde Ajustes como un vendedor", () => {
    expect(opcionesDelMenuDeCuenta({ realRole: "admin", me: { role: "sales", module_access: soloEntregas } }))
      .toEqual(["ensenanza", "vercomo", "salir"]);
  });

  it("el admin viendo como chofer ve lo que ve el chofer, más «ver como»", () => {
    expect(opcionesDelMenuDeCuenta({ realRole: "admin", me: { role: "driver", module_access: soloEntregas } }))
      .toEqual(["ensenanza", "vercomo", "perfil", "tutoriales", "salir"]);
  });

  it("la vista móvil ya no está en este menú para nadie: es una herramienta del hub (D-306)", () => {
    for (const rol of ["admin", "manager", "sales", "logistics", "accounting", "warehouse", "driver"] as const) {
      const opciones: string[] = opcionesDelMenuDeCuenta({ realRole: rol, me: { role: rol, module_access: soloEntregas } });
      expect(opciones, rol).not.toContain("vistamovil");
    }
    expect(OPCIONES_DEL_MENU as readonly string[]).not.toContain("vistamovil");
  });
});

describe("la barra de Entregas", () => {
  const barra = sinComentarios(leer("src/components/TopBar.tsx"));

  it("no monta el selector de módulos; las barras de RR. HH. y Time Tracker, sí", () => {
    expect(barra).not.toContain("ModuleSwitcher");
    for (const f of ["src/components/recruiting/TopBar.tsx", "src/components/timetracker/TopBar.tsx"]) {
      expect(sinComentarios(leer(f)), f).toContain("<ModuleSwitcher");
    }
  });

  it("la casa va justo después del nombre de la app, con el rol y los módulos efectivos", () => {
    expect(barra).toMatch(/<h1>[^\n]*<\/h1>\n\s*<HubHomeLink deliveriesRole=\{me\.role\} moduleAccess=\{me\.module_access\} \/>/);
  });

  it("la casa se esconde con la misma condición que tenía dentro del selector", () => {
    const condicion = (f: string) => {
      const m = sinComentarios(leer(f)).match(/if \(!canReachHub\([^\n]*\) return null;/g) ?? [];
      expect(m, f).toHaveLength(1);
      return m[0];
    };
    expect(condicion("src/components/HubHomeLink.tsx")).toBe(condicion("src/components/ModuleSwitcher.tsx"));
  });

  it("sin etiqueta de rol y sin enlace a la Cuenta", () => {
    expect(barra).not.toContain('className="sema"');
    expect(barra).not.toContain('href="/account"');
  });

  it("el menú sale de `opcionesDelMenuDeCuenta` con lo que tiene la barra, y pinta cada opción", () => {
    expect(barra).toContain("opcionesDelMenuDeCuenta({ realRole, me })");
    // `enMarco` se fue con la vista móvil (D-306): la barra ya no mira si está en un iframe.
    expect(barra).not.toContain("estaEnUnMarco(");
    for (const o of OPCIONES_DEL_MENU) expect(barra, o).toContain(`case "${o}":`);
  });

  it("Salir es un solo formulario, dentro del menú", () => {
    const formularios = barra.match(/<form action="\/auth\/signout" method="post"[^>]*>/g) ?? [];
    expect(formularios).toHaveLength(1);
    const salir = barra.slice(barra.indexOf('case "salir":'));
    expect(salir.indexOf('<form action="/auth/signout"')).toBeGreaterThan(0);
    expect(salir.indexOf('<form action="/auth/signout"')).toBeLessThan(200);
  });

  it("Mi perfil, Tutoriales y Ajustes llevan a sus rutas", () => {
    const tramo = (o: string) => barra.slice(barra.indexOf(`case "${o}":`), barra.indexOf(`case "${o}":`) + 250);
    expect(tramo("perfil")).toContain('href="/home/profile"');
    expect(tramo("tutoriales")).toContain('href="/home/tutorials"');
    expect(tramo("ajustes")).toContain('href="/settings"');
  });

  it("modo enseñanza lo enciende y lo apaga; «ver como» cambia la vista", () => {
    const entre = (a: string, b: string) => barra.slice(barra.indexOf(a), barra.indexOf(b));
    expect(entre('case "ensenanza":', 'case "vercomo":')).toContain("onClick={() => { setTeaching(!teaching); cierraMenu(); }}");
    expect(entre('case "vercomo":', 'case "ajustes":')).toContain("onChange={(e) => cambiaVista(e.target.value)}");
    expect(barra).toMatch(/const cambiaVista = \(valor: string\) => \{\n\s*const next = valor === "admin" \? null : \(valor as UserRole\);\n\s*setViewAs\(next\);/);
  });

  it("el aviso de «ver como» solo existe mientras dura, y solo para el admin real", () => {
    expect(barra).toMatch(/\{realRole === "admin" && viewAs && \(\n\s*<label\n\s*className="role-switch"/);
    // Es el único sitio de la barra con esa píldora.
    expect(barra.split('className="role-switch"').length - 1).toBe(1);
  });

  it("reiniciar la práctica vive en el aviso del modo enseñanza, con confirmación", () => {
    const aviso = barra.slice(barra.indexOf("{teaching && ("), barra.indexOf('<div className="topbar">'));
    expect(aviso).toContain("onClick={reiniciaPractica}");
    expect(barra).toMatch(/const reiniciaPractica = async \(\) => \{\n\s*if \(confirm\([\s\S]{0,300}?\)\) \{\n\s*await clearTrainingData\(\);/);
  });
});

describe("la Cuenta de Entregas redirige a Mi perfil", () => {
  it("la página es solo la redirección", () => {
    const cuenta = sinComentarios(leer("src/app/(app)/account/page.tsx"));
    expect(cuenta).toContain('redirect("/home/profile")');
    expect(cuenta).not.toContain("useData");
  });

  it("nadie en la app enlaza ya a `/account`", () => {
    const tsx: string[] = [];
    const recorre = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) recorre(p);
        else if (f.endsWith(".tsx")) tsx.push(p.split("\\").join("/"));
      }
    };
    recorre("src");
    const detector = /href=(\{\s*)?["']\/account["']/;
    expect(detector.test('<Link href="/account">')).toBe(true); // control
    expect(detector.test('<Link href="/timetracker/account">')).toBe(false); // control: la de Time Tracker sigue
    expect(tsx.length).toBeGreaterThanOrEqual(200);
    expect(tsx.filter((p) => detector.test(sinComentarios(readFileSync(p, "utf8"))))).toEqual([]);
  });

  it("la vuelta de Ajustes lleva a la pantalla del rol", () => {
    const ajustes = sinComentarios(leer("src/app/(app)/settings/page.tsx"));
    expect(ajustes.split("href={roleHome(me.role)}").length - 1).toBe(2);
  });
});
