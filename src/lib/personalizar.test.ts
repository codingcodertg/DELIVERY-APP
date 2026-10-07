import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { OPCIONES_DE_IDIOMA, OPCIONES_DE_TEMA, RUTA_PERSONALIZAR } from "./personalizar";
import { PREFERENCIAS_DE_TEMA } from "./tema";
import { OPCIONES_DEL_MENU, OPCIONES_DEL_MENU_RRHH, OPCIONES_DEL_MENU_TT, opcionesDelMenuDeCuenta } from "./account-menu";

/**
 * El personalizador del hub (D-NEXT): el idioma y el tema se eligen ahí y en ningún otro sitio de las
 * apps; cada barra que tenía un botón deja en su lugar un enlace hasta él.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

function tsxDeSrc(): string[] {
  const out: string[] = [];
  const recorre = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) recorre(p);
      else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p.split("\\").join("/"));
    }
  };
  recorre("src");
  return out;
}

describe("las opciones", () => {
  it("los dos idiomas, cada uno con su nombre en su idioma", () => {
    expect(OPCIONES_DE_IDIOMA.map((o) => o.valor).sort()).toEqual(["en", "es"]);
    expect(OPCIONES_DE_IDIOMA.find((o) => o.valor === "es")?.es).toBe("Español");
    expect(OPCIONES_DE_IDIOMA.find((o) => o.valor === "en")?.en).toBe("English");
  });
  it("los tres temas, los mismos que entiende el proveedor, con texto distinto en cada idioma", () => {
    expect(OPCIONES_DE_TEMA.map((o) => o.valor)).toEqual([...PREFERENCIAS_DE_TEMA]);
    for (const o of OPCIONES_DE_TEMA) expect(o.en, o.valor).not.toBe(o.es);
  });
});

describe("la pantalla", () => {
  const pers = sinComentarios(leer("src/components/profile/Personalizador.tsx"));

  it("pinta las opciones de la librería y guarda con el proveedor de siempre", () => {
    expect(pers).toContain("{OPCIONES_DE_IDIOMA.map((o) => (");
    expect(pers).toContain("onClick={() => setLang(o.valor)}");
    expect(pers).toContain("{OPCIONES_DE_TEMA.map((o) => (");
    expect(pers).toContain("onClick={() => setTheme(o.valor)}");
  });

  it("marca lo puesto: el idioma, y el tema ELEGIDO (también «como mi equipo»), no el resuelto", () => {
    expect(pers).toContain("aria-checked={lang === o.valor}");
    expect(pers).toContain("aria-checked={themePref === o.valor}");
    expect(pers).not.toContain("aria-checked={theme ===");
  });

  it("vive en /home/personalizar y solo pide sesión, como Mi perfil: el chofer también entra", () => {
    expect(RUTA_PERSONALIZAR).toBe("/home/personalizar");
    expect(leer("src/app/home/personalizar/page.tsx")).toContain("<Personalizador />");
    const layout = sinComentarios(leer("src/app/home/personalizar/layout.tsx"));
    expect(layout).toContain("if (!user) redirect(`/login?next=${RUTA_PERSONALIZAR}`);");
    expect(layout).not.toContain("canReachHub");
  });

  it("el lobby lo enlaza junto a Mi perfil", () => {
    const hub = sinComentarios(leer("src/components/HomeSelector.tsx"));
    expect(hub).toContain("<Link href={RUTA_PERSONALIZAR} className=\"hub-profile-link\" data-hub-personalizar>");
  });

  it("Mi perfil ya no elige idioma ni tema: enlaza aquí", () => {
    const perfil = sinComentarios(leer("src/components/profile/ProfileView.tsx"));
    expect(perfil).not.toMatch(/setLang|setTheme/);
    expect(perfil).toContain("<Link href={RUTA_PERSONALIZAR} className=\"btn btn-primary\">");
  });
});

describe("ninguna barra elige idioma ni tema; todas llevan a Personalizar", () => {
  const barras = {
    entregas: "src/components/TopBar.tsx",
    timetracker: "src/components/timetracker/TopBar.tsx",
    rrhh: "src/components/recruiting/TopBar.tsx",
    erp: "src/components/erp/side-nav.tsx",
  };

  it("sin conmutadores: ni setLang, ni toggleLang, ni setTheme, ni 🌙, ni ES/EN", () => {
    for (const [app, f] of Object.entries(barras)) {
      const src = sinComentarios(leer(f));
      expect(src, app).not.toMatch(/\bsetLang\(|\btoggleLang\b|\bsetTheme\(|\btoggleTheme\b|🌙|🇪🇸 ES|🇬🇧 EN/);
    }
  });

  it("Entregas, Time Tracker y RR. HH. lo tienen en el menú del nombre; el ERP, junto a Salir", () => {
    expect(OPCIONES_DEL_MENU).toContain("personalizar");
    expect(OPCIONES_DEL_MENU_TT).toContain("personalizar");
    expect(OPCIONES_DEL_MENU_RRHH).toContain("personalizar");
    for (const f of [barras.entregas, barras.timetracker, barras.rrhh]) {
      expect(sinComentarios(leer(f)), f).toMatch(/case "personalizar":\n\s*(\/\/[^\n]*\n\s*)?return <OpcionPersonalizar key=\{o\} alPulsar=\{cierraMenu\} \/>;/);
    }
    const erp = sinComentarios(leer(barras.erp));
    expect(erp).toContain("href={RUTA_PERSONALIZAR}");
    // En la barra lateral con su nombre; en la cabecera del teléfono, solo el 🎨 (no cabía a 390 px).
    expect(erp).toContain("{personalizar(false)}{signout}");
    expect(erp).toMatch(/\{personalizar\(true\)\}\n\s*\{signout\}/);
  });

  it("la opción compartida lleva a la ruta del personalizador", () => {
    const menu = sinComentarios(leer("src/components/MenuDeCuenta.tsx"));
    const opcion = menu.slice(menu.indexOf("export function OpcionPersonalizar("), menu.indexOf("export function OpcionSalir("));
    expect(opcion).toContain("<Link href={RUTA_PERSONALIZAR} role=\"menuitem\"");
  });

  it("en Entregas sale para todos los roles, justo antes de Salir", () => {
    for (const rol of ["admin", "manager", "sales", "logistics", "accounting", "warehouse", "driver"] as const) {
      const o = opcionesDelMenuDeCuenta({ realRole: rol, me: { role: rol, module_access: ["deliveries"] } });
      expect(o.slice(-2), rol).toEqual(["personalizar", "salir"]);
    }
  });

  it("en todo el código, solo el personalizador y la contraseña obligatoria piden al proveedor cambiar el idioma o el tema", () => {
    // La contraseña obligatoria (D-486) se ve ANTES de poder entrar a ninguna app, como el login: sin
    // su botón, quien no lee inglés no podría pasar de ahí. El resumen de RR. HH. tiene un `setLang`
    // propio, de su `useState`: elige el idioma del texto que se copia, no el de la app.
    const piden = tsxDeSrc()
      .filter((f) => /\{[^}]*\b(setLang|setTheme|toggleLang|toggleTheme)\b[^}]*\}\s*=\s*usePrefs\(\)/.test(sinComentarios(readFileSync(f, "utf8"))))
      .sort();
    expect(piden).toEqual(["src/components/CambioObligatorioForm.tsx", "src/components/profile/Personalizador.tsx"]);
  });
});

describe("Time Tracker lee la misma preferencia", () => {
  it("el tema: su CSS cuelga del mismo data-theme que pone el proveedor", () => {
    expect(leer("src/app/timetracker/timetracker.css")).toContain(':root[data-theme="light"] .timetracker-module{');
    expect(leer("src/lib/prefs.tsx")).toContain('document.documentElement.setAttribute("data-theme", theme);');
  });
  it("el idioma: su diccionario sigue el aviso que manda el proveedor al elegir", () => {
    const i18n = leer("src/lib/timetracker/i18n.ts");
    expect(i18n).toContain("window.addEventListener(EVENTO_IDIOMA, (e) => {");
    const prefs = leer("src/lib/prefs.tsx");
    expect(prefs).toContain("window.dispatchEvent(new CustomEvent(EVENTO_IDIOMA, { detail: l }));");
  });
  it("su cuenta enlaza al personalizador, no a Mi perfil, para el idioma", () => {
    const cuenta = leer("src/app/timetracker/(timetracker)/account/page.tsx");
    expect(cuenta).toContain('<Link href={RUTA_PERSONALIZAR} className="btn">{t("emp.acc.langMoved")}</Link>');
  });
});
