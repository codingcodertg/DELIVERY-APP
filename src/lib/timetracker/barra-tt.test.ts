import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OPCIONES_DEL_MENU_TT } from "@/lib/account-menu";
import { DICT } from "./i18n";

/**
 * La barra de Time Tracker como la de Entregas, y el modo capacitación en ella (D-490).
 *
 * El dueño: «hay demasiados botones […] si aprietas el nombre […] te sale Sign Out. Y teaching mode […]
 * Eso que sale employee, tampoco quiero que se mire. Y las notificaciones, eso sí, se queda. Pero el botón
 * para español y dark mode […] se elige desde su personalizar». Se lee el código que se ejecuta.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

const barra = sinComentarios(leer("src/components/timetracker/TopBar.tsx"));
const cap = sinComentarios(leer("src/components/timetracker/Capacitacion.tsx"));

describe("lo que se fue de la barra", () => {
  it("sin la pastilla del rol («Employee»/«Manager»)", () => {
    expect(barra).not.toMatch(/shell\.employee|shell\.manager|className="chip"/);
  });
  it("sin ES/EN, sin 🌙 y sin el «Sign out» suelto", () => {
    expect(barra).not.toMatch(/toggleLang|toggleTheme|usePrefs|🌙|☀️|shell\.signOut|<form action="\/auth\/signout"/);
  });
  it("sin el selector de módulos: la casa sola, junto al nombre de la app, como en Entregas", () => {
    expect(barra).not.toContain("ModuleSwitcher");
    expect(barra).toMatch(/<div className="brand">\{settings\.appName \|\| "TimeTracker"\}<\/div>\n\s*<HubHomeLink deliveriesRole=\{deliveriesRole\} moduleAccess=\{moduleAccess\} \/>/);
  });
});

describe("lo que se queda", () => {
  it("las pestañas, recargar, la campana y el ⟳ del escritorio", () => {
    expect(barra).toContain("const tabs = pestanasPara(me.role);");
    expect(barra).toContain('<BotonRecargar titulo={t("shell.reload")} className="btn-ghost btn-sm tt-recargar" />');
    expect(barra).toContain("<NotificationBell />");
    expect(barra).toContain("<TtCheckUpdateLink />");
  });
});

describe("el nombre abre el menú de Entregas", () => {
  it("el mismo componente, con el nombre de quien entra", () => {
    expect(barra).toContain('import { MenuDeCuenta, OpcionPersonalizar, OpcionSalir } from "@/components/MenuDeCuenta";');
    expect(barra).toContain("<MenuDeCuenta nombre={me.fullName}>");
  });

  it("igual para todos: capacitación, mi cuenta, personalizar y cerrar sesión, el último", () => {
    expect([...OPCIONES_DEL_MENU_TT]).toEqual(["capacitacion", "cuenta", "personalizar", "salir"]);
    expect(barra).toContain("{(cierraMenu) => OPCIONES_DEL_MENU_TT.map((o) => {");
    for (const o of OPCIONES_DEL_MENU_TT) expect(barra, o).toContain(`case "${o}":`);
    // No depende del rol: nada en el menú pregunta por él.
    const menu = barra.slice(barra.indexOf("<MenuDeCuenta"), barra.indexOf("</MenuDeCuenta>"));
    expect(menu).not.toMatch(/me\.role|isAdmin/);
  });

  it("«Mi cuenta» sigue llevando a la cuenta de Time Tracker (era adonde iba el nombre, D-160)", () => {
    const cuenta = barra.slice(barra.indexOf('case "cuenta":'), barra.indexOf('case "personalizar":'));
    expect(cuenta).toContain('href="/timetracker/account"');
  });

  it("cerrar sesión es el formulario compartido", () => {
    expect(barra.slice(barra.indexOf('case "salir":'))).toMatch(/^case "salir":\n\s*return <OpcionSalir key=\{o\} \/>;/);
  });

  it("el modo capacitación se enciende y se apaga desde ahí, y dice en qué estado está", () => {
    const opcion = barra.slice(barra.indexOf('case "capacitacion":'), barra.indexOf('case "cuenta":'));
    expect(opcion).toContain("onClick={() => { cierraMenu(); void alternaCapacitacion(); }}");
    expect(opcion).toContain("aria-checked={!!capacitacion.activa}");
    expect(opcion).toContain('{capacitacion.activa ? t("training.menuOff") : t("training.menu")}');
  });

  it("no se enciende con un cronómetro real en marcha, ni si no se puede comprobar", () => {
    const f = barra.slice(barra.indexOf("const alternaCapacitacion = async () => {"), barra.indexOf("return (", barra.indexOf("const alternaCapacitacion")));
    expect(f).toContain("if (capacitacion.activa) { capacitacion.apagar(); return; }");
    expect(f).toContain('if ((await listLiveSessions()).length > 0) { notify(t("training.timerRunning")); return; }');
    expect(f).toMatch(/catch \{\n\s*notify\(t\("training\.checkFail"\)\);\n\s*return;\n\s*\}/);
    expect(f.indexOf("listLiveSessions()")).toBeLessThan(f.indexOf("capacitacion.encender();"));
  });

  it("los textos nuevos existen en los dos idiomas, distintos", () => {
    for (const k of ["training.menu", "training.menuOff", "training.menuHint", "training.banner", "training.exit", "training.timerRunning", "training.checkFail", "menu.account"]) {
      expect(DICT.en[k], k).toBeTruthy();
      expect(DICT.es[k], k).toBeTruthy();
      expect(DICT.en[k], k).not.toBe(DICT.es[k]);
    }
    expect(DICT.es["training.menu"]).toBe("🎓 Modo capacitación");
    expect(DICT.en["training.menu"]).toBe("🎓 Training mode");
  });
});

describe("el aviso fijo", () => {
  it("va encima de la barra, en la misma cabecera pegada arriba", () => {
    expect(barra).toMatch(/<div className="tt-cabecera">\n\s*<AvisoDeCapacitacion \/>\n\s*<div className="topbar">/);
    const css = leer("src/app/timetracker/timetracker.css");
    expect(css).toContain(".timetracker-module .tt-cabecera{position:sticky;top:var(--banner-impersonacion, 0px);z-index:20;margin-bottom:6px}");
    expect(css).toContain(".timetracker-module .tt-cabecera .topbar{position:static;margin-bottom:0}");
  });
  it("solo se ve encendida, dice que nada se guarda y deja salir", () => {
    const aviso = cap.slice(cap.indexOf("export function AvisoDeCapacitacion()"));
    expect(aviso).toContain("if (!activa) return null;");
    expect(aviso).toContain('{t("training.banner")}');
    expect(aviso).toContain('<button type="button" onClick={apagar}>{t("training.exit")}</button>');
    expect(DICT.es["training.banner"]).toContain("nada se guarda");
    expect(DICT.en["training.banner"]).toContain("nothing is saved");
  });
});

describe("encender y apagar", () => {
  it("la cookie es la fuente de verdad: encender la pone con el idioma, apagar la quita", () => {
    const encender = cap.slice(cap.indexOf("const encender = useCallback("), cap.indexOf("const apagar = useCallback("));
    expect(encender).toContain("document.cookie = cookieDeCapacitacion(lang);");
    expect(encender).toContain("setActiva(lang);");
    const apagar = cap.slice(cap.indexOf("const apagar = useCallback("), cap.indexOf("}, [olvida]);") + 1);
    expect(apagar).toContain("document.cookie = cookieDeCapacitacion(null);");
    expect(apagar).toContain("setActiva(null);");
  });

  it("al encender y al apagar se tira lo practicado: se empieza de cero, y apagado todo vuelve a lo real", () => {
    expect(cap).toMatch(/const encender = useCallback\(\(\) => \{\n\s*document\.cookie = cookieDeCapacitacion\(lang\);\n\s*olvida\(\);/);
    expect(cap).toMatch(/const apagar = useCallback\(\(\) => \{\n\s*document\.cookie = cookieDeCapacitacion\(null\);\n\s*olvida\(\);/);
    const olvida = cap.slice(cap.indexOf("const olvida = useCallback("), cap.indexOf("const encender = useCallback("));
    expect(olvida).toContain("pon(practicaVacia());");
    expect(olvida).toContain("localStorage.removeItem(clave);");
  });

  it("cambiar de modo vuelve a montar todo Time Tracker (proveedor, cronómetro, pantallas)", () => {
    expect(cap).toContain('<Fragment key={activa ? "practica" : "real"}>{children}</Fragment>');
  });

  it("el layout lee la cookie en el servidor y envuelve al proveedor de datos", () => {
    const layout = sinComentarios(leer("src/app/timetracker/(timetracker)/layout.tsx"));
    expect(layout).toContain("const capacitacion = await capacitacionDeLaPeticion();");
    expect(layout).toMatch(/<CapacitacionProvider inicial=\{capacitacion\} uid=\{me\.id\}>\n\s*<DataProvider me=\{me\}>/);
  });

  it("si otra pestaña la cambió, al volver a esta manda la cookie", () => {
    expect(cap).toContain("const c = capacitacionDelNavegador();");
    expect(cap).toContain('window.addEventListener("focus", mira);');
  });
});

describe("el menú compartido (`MenuDeCuenta`), el de Entregas sacado a su sitio", () => {
  const menu = sinComentarios(leer("src/components/MenuDeCuenta.tsx"));

  it("se cierra al navegar y al pulsar fuera", () => {
    expect(menu).toContain("useEffect(() => { setAbierto(false); }, [pathname]);");
    expect(menu).toContain('<div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={cerrar} />');
  });

  it("se voltea hacia la derecha si no cabe a la izquierda, como el de D-274", () => {
    expect(menu).toContain("if (el.getBoundingClientRect().left < 8) setVolteado(true);");
    expect(menu).toContain('...(volteado ? { left: 0, right: "auto" } : { right: 0, left: "auto" })');
  });

  it("dentro de Time Tracker y de RR. HH. sus opciones se leen: color y relleno de la tarjeta, no de la barra", () => {
    // Visto en el navegador: en RR. HH. «Personalizar» salía blanco sobre blanco y sin relleno (su `* { padding: 0 }` y su
    // `a { color: inherit }` bajo la barra blanca); en Time Tracker las opciones salían como botones azules.
    expect(leer("src/app/recruiting/recruiting.css")).toContain(".recruiting-module .col-menu .col-opt { color: var(--text); padding: 6px 8px; }");
    expect(leer("src/app/recruiting/recruiting.css")).toContain(".recruiting-module .col-menu { padding: 6px; }");
    expect(leer("src/app/timetracker/timetracker.css")).toContain(".timetracker-module .col-menu .col-opt{background:transparent;color:var(--text);");
    expect(leer("src/app/timetracker/timetracker.css")).toContain(".timetracker-module .topbar .account-link{background:transparent;color:#fff;");
  });

  it("Entregas, Time Tracker y RR. HH. lo usan, y ninguna conserva su copia del armazón", () => {
    for (const f of ["src/components/TopBar.tsx", "src/components/timetracker/TopBar.tsx", "src/components/recruiting/TopBar.tsx"]) {
      const src = sinComentarios(leer(f));
      expect(src, f).toMatch(/<MenuDeCuenta nombre=\{/);
      expect(src, f).not.toContain("menuCuentaAbierto");
    }
  });
});

describe("lo practicado se guarda mientras dura, y sigue al idioma", () => {
  it("cada cambio se guarda en el navegador, por persona", () => {
    const cambia = cap.slice(cap.indexOf("const cambia = useCallback("), cap.indexOf("const olvida = useCallback("));
    expect(cambia).toContain("localStorage.setItem(clave, JSON.stringify(n));");
    expect(cap).toContain("const clave = claveDePractica(uid);");
  });

  it("encendida, al cargar se recupera lo practicado (sobrevive a recargar la página)", () => {
    expect(cap).toMatch(/if \(!activa\) return;\n\s*try \{ pon\(practicaGuardada\(localStorage\.getItem\(clave\)\)\); \}/);
  });

  it("si cambia el idioma con la práctica encendida, la cookie lo sigue (el servidor contesta en ese idioma)", () => {
    expect(cap).toMatch(/if \(activa && activa !== lang\) \{\n\s*document\.cookie = cookieDeCapacitacion\(lang\);\n\s*setActiva\(lang\);/);
  });
});
