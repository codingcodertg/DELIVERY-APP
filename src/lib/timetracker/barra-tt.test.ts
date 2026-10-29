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
    // El nombre y la casa los pone `BarraDeApp` (D-643), la barra de todas las apps.
    expect(barra).toContain('<BarraDeApp nombre={settings.appName || "TimeTracker"} deliveriesRole={deliveriesRole} moduleAccess={moduleAccess} claseDelResto="tt-barra-resto">');
  });
});

describe("lo que se queda (D-737, 2026-10-29: sin los dos botones de recargar)", () => {
  it("las pestañas y la campana; ni «Recargar la app» ni el ⟳ del escritorio", () => {
    // Nota D-528: las pestañas ya no salen directamente de `pestanasPara`, sino de `barraDeTt` (que la llama): el admin
    // lleva Ajustes y sus cuatro personales en «👤 Mío ▾». Lo prueba `barra.test.ts`.
    expect(barra).toContain("const barra = barraDeTt(me.role, pathname);");
    expect(barra).toContain("<NotificationBell />");
    expect(barra).not.toMatch(/BotonRecargar|TtCheckUpdateLink|tt-recargar|shell\.reload/);
    // El ⟳ ya no existe; el banner de actualización del escritorio sigue.
    const banner = sinComentarios(leer("src/components/timetracker/UpdateBanner.tsx"));
    expect(banner).not.toContain("export function TtCheckUpdateLink");
    expect(banner).toContain("export function TtUpdateBanner()");
    expect(leer("src/app/timetracker/timetracker.css")).not.toContain(".tt-recargar{");
  });
});

describe("el nombre abre el menú de Entregas", () => {
  it("el mismo componente, con el nombre de quien entra", () => {
    expect(barra).toContain('import { MenuDeCuenta, OpcionSalir } from "@/components/MenuDeCuenta";');
    expect(barra).toContain("<MenuDeCuenta nombre={me.fullName}>");
  });

  it("igual para todos y solo cerrar sesión (D-737): sin capacitación, sin Mi cuenta, sin Personalizar", () => {
    expect([...OPCIONES_DEL_MENU_TT]).toEqual(["salir"]);
    expect(barra).toContain("{() => OPCIONES_DEL_MENU_TT.map((o) => {");
    const menu = barra.slice(barra.indexOf("<MenuDeCuenta"), barra.indexOf("</MenuDeCuenta>"));
    expect(menu).not.toMatch(/me\.role|isAdmin|capacitacion|OpcionPersonalizar|timetracker\/account|menu\.account/);
    expect(barra).not.toMatch(/alternaCapacitacion|useCapacitacion|listLiveSessions/);
  });

  it("cerrar sesión es el formulario compartido", () => {
    expect(barra.slice(barra.indexOf('case "salir":'))).toMatch(/^case "salir":\n\s*return <OpcionSalir key=\{o\} \/>;/);
  });

  it("los textos del aviso existen en los dos idiomas, distintos", () => {
    for (const k of ["training.banner", "training.exit", "menu.account"]) {
      expect(DICT.en[k], k).toBeTruthy();
      expect(DICT.es[k], k).toBeTruthy();
      expect(DICT.en[k], k).not.toBe(DICT.es[k]);
    }
  });
});

describe("el aviso fijo", () => {
  it("va encima de la barra, en la misma cabecera pegada arriba", () => {
    expect(barra).toMatch(/<div className="tt-cabecera">\n\s*<AvisoDeCapacitacion \/>\n\s*<BarraDeApp /);
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
