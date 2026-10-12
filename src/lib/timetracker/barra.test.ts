import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MANAGER_TABS, TABS } from "@/lib/timetracker/constants";
import { DICT } from "@/lib/timetracker/i18n";
import { MenuDeAcciones, OpcionesDelMenu } from "@/components/MenuDeAcciones";
import { MenuDeCuenta } from "@/components/MenuDeCuenta";
import { PESTANAS_DEL_MENU_MIO, barraDeTt, claveCorta, claveDelRotulo, esPestanaActiva, opcionesDelMenuMio } from "./barra";

// D-NEXT. El dueño, el 2026-10-11: «en el clock in app, ajustes, tegistrar tiempo mi semana mi solicitus y mi diaro
// que vayan en un solo boton dropdwow». La barra del ADMIN: las ocho de gestión en fila, y Ajustes y sus cuatro
// personales dentro de «👤 Mío ▾». Lógica pura, lo que pinta el menú, y leyendo el fuente, que la barra la USA.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

const GESTION = ["insights", "live", "payroll", "team-requests", "projects", "assignments", "people", "audit"];
const MIO = ["track", "week", "requests", "diary", "settings"];

describe("qué va en la fila y qué en «👤 Mío ▾»", () => {
  it("admin: las ocho de gestión en fila, en su orden; Registrar tiempo, Mi semana, Mis solicitudes, Mi diario y Ajustes en el menú", () => {
    const b = barraDeTt("admin", "/timetracker/insights");
    expect(ids(b.fila)).toEqual(GESTION);
    expect(ids(b.menu)).toEqual(MIO);
    expect([...PESTANAS_DEL_MENU_MIO]).toEqual(MIO);
  });

  it("admin: no se pierde ni se repite ninguna pantalla, y cada una lleva a la misma ruta que su pestaña", () => {
    const b = barraDeTt("admin", "/timetracker");
    expect([...b.fila, ...b.menu].sort((x, y) => x.id.localeCompare(y.id))).toEqual([...MANAGER_TABS].sort((x, y) => x.id.localeCompare(y.id)));
    for (const p of b.menu) expect(p).toBe(MANAGER_TABS.find((m) => m.id === p.id));
  });

  it("el empleado no cambia: sus tres pestañas en fila y sin menú", () => {
    const b = barraDeTt("employee", "/timetracker/week");
    expect(b.fila).toBe(TABS);
    expect(ids(b.fila)).toEqual(["track", "week", "requests"]);
    expect(b.menu).toEqual([]);
    expect(b.activaDelMenu).toBeNull();
  });

  it("el gerente y un rol vacío ven lo del empleado (no tienen Ajustes ni Mi diario que recoger)", () => {
    for (const rol of ["manager", null, undefined, ""]) {
      const b = barraDeTt(rol, "/timetracker");
      expect(b.fila, String(rol)).toBe(TABS);
      expect(b.menu, String(rol)).toEqual([]);
    }
  });
});

describe("cuál está activa", () => {
  it("en cada pantalla del menú, el menú sabe que es esa (y el botón la nombra)", () => {
    const rutas: Record<string, string> = {
      track: "/timetracker", week: "/timetracker/week", requests: "/timetracker/requests",
      diary: "/timetracker/diary", settings: "/timetracker/settings",
    };
    for (const [id, ruta] of Object.entries(rutas)) {
      const b = barraDeTt("admin", ruta);
      expect(b.activaDelMenu?.id, ruta).toBe(id);
      expect(claveDelRotulo(b), ruta).toBe("tab." + id);
    }
  });

  it("en una pantalla de gestión (o en Mi cuenta) ninguna del menú está activa y el botón dice «👤 Mío»", () => {
    for (const ruta of ["/timetracker/insights", "/timetracker/payroll", "/timetracker/team-requests", "/timetracker/account"]) {
      const b = barraDeTt("admin", ruta);
      expect(b.activaDelMenu, ruta).toBeNull();
      expect(claveDelRotulo(b), ruta).toBe("tab.mine");
    }
  });

  it("«Pendientes» (/team-requests) no enciende «Mis solicitudes» (/requests), ni al revés", () => {
    expect(barraDeTt("admin", "/timetracker/team-requests").activaDelMenu).toBeNull();
    expect(esPestanaActiva("/timetracker/team-requests", "/timetracker/requests")).toBe(false);
  });

  it("«Registrar tiempo» es la raíz: solo exacta; las demás también en sus subrutas, y por tramos enteros", () => {
    expect(esPestanaActiva("/timetracker", "/timetracker")).toBe(true);
    expect(esPestanaActiva("/timetracker", "/timetracker/week")).toBe(false);
    expect(esPestanaActiva("/timetracker/people", "/timetracker/people")).toBe(true);
    expect(esPestanaActiva("/timetracker/people", "/timetracker/people/123")).toBe(true);
    expect(esPestanaActiva("/timetracker/requests", "/timetracker/requests-viejo")).toBe(false);
    expect(esPestanaActiva("/timetracker/week", "/timetracker/insights")).toBe(false);
  });
});

describe("las opciones del menú", () => {
  const t = (k: string) => "«" + k + "»";

  it("cada una con el texto de su pestaña, en el orden del menú, y la actual marcada (solo esa)", () => {
    const b = barraDeTt("admin", "/timetracker/week");
    const o = opcionesDelMenuMio(b, t, () => {});
    expect(o.map((x) => x.texto)).toEqual(MIO.map((id) => "«tab." + id + "»"));
    expect(o.map((x) => x.id)).toEqual(MIO);
    expect(o.filter((x) => x.actual).map((x) => x.id)).toEqual(["week"]);
    expect(o.some((x) => x.peligro || x.deshabilitada)).toBe(false);
  });

  it("fuera de esas pantallas no hay ninguna actual", () => {
    expect(opcionesDelMenuMio(barraDeTt("admin", "/timetracker/audit"), t, () => {}).some((x) => x.actual)).toBe(false);
  });

  it("pulsar una lleva a SU pantalla", () => {
    const fue: string[] = [];
    for (const o of opcionesDelMenuMio(barraDeTt("admin", "/timetracker/insights"), t, (h) => fue.push(h))) o.alPulsar();
    expect(fue).toEqual(["/timetracker", "/timetracker/week", "/timetracker/requests", "/timetracker/diary", "/timetracker/settings"]);
  });

  it("el empleado no tiene opciones, así que `MenuDeAcciones` no pinta botón", () => {
    const o = opcionesDelMenuMio(barraDeTt("employee", "/timetracker"), t, () => {});
    expect(o).toEqual([]);
    expect(renderToStaticMarkup(createElement(MenuDeAcciones, { rotulo: "x", opciones: o }))).toBe("");
  });

  it("pintadas: cinco `menuitem`, la actual con `aria-current=\"page\"` y resaltada, sin raya (no hay nada destructivo)", () => {
    const html = renderToStaticMarkup(createElement(OpcionesDelMenu, {
      opciones: opcionesDelMenuMio(barraDeTt("admin", "/timetracker/diary"), (k) => DICT.es[k], () => {}),
      onElegir: () => {},
    }));
    expect((html.match(/role="menuitem"/g) ?? []).length).toBe(5);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect((html.match(/menu-accion-actual/g) ?? []).length).toBe(1);
    expect(html).toMatch(/class="col-opt menu-accion menu-accion-actual" aria-current="page"[^>]*>🗂 Mi diario</);
    expect(html).not.toContain('role="separator"');
  });

  it("el botón cerrado: abre un menú, dice que está cerrado, y lleva el nombre de la pantalla abierta", () => {
    const b = barraDeTt("admin", "/timetracker/week");
    const html = renderToStaticMarkup(createElement(MenuDeAcciones, {
      rotulo: DICT.en[claveDelRotulo(b)], className: "tt-menu-mio active", opciones: opcionesDelMenuMio(b, (k) => DICT.en[k], () => {}),
    }));
    expect(html).toContain('class="tt-menu-mio active"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('📅 My Week <span aria-hidden="true">▾</span>');
  });
});

describe("los textos, en los dos idiomas", () => {
  it("«👤 Mine» / «👤 Mío»", () => {
    expect(DICT.en["tab.mine"]).toBe("👤 Mine");
    expect(DICT.es["tab.mine"]).toBe("👤 Mío");
  });
  it("todas las opciones del menú tienen su texto en inglés y en español, distintos", () => {
    for (const id of MIO) {
      expect(DICT.en["tab." + id], id).toBeTruthy();
      expect(DICT.es["tab." + id], id).toBeTruthy();
      expect(DICT.en["tab." + id], id).not.toBe(DICT.es["tab." + id]);
    }
  });
});

describe("la barra lo usa (se lee el código que se ejecuta)", () => {
  const barra = plano(sinComentarios(leer("src/components/timetracker/TopBar.tsx")));

  it("la fila y el menú salen de `barraDeTt`, con el rol y la ruta", () => {
    expect(barra).toContain("const barra = barraDeTt(me.role, pathname);");
    expect(barra).toContain("{barra.fila.map((tb) => (");
    expect(barra).not.toMatch(/pestanasPara|MANAGER_TABS|startsWith\(tb\.href\)/);
  });

  it("cada pestaña de la fila se enciende con `esPestanaActiva`", () => {
    expect(barra).toContain('<Link key={tb.id} href={tb.href} className={esPestanaActiva(tb.href, pathname) ? "active" : ""}>');
  });

  it("el desplegable es `MenuDeAcciones`, dentro de la fila, con su texto, su resalte y sus opciones de la lógica", () => {
    expect(barra).toContain('import { MenuDeAcciones } from "@/components/MenuDeAcciones";');
    const menu = barra.slice(barra.indexOf("<MenuDeAcciones"), barra.indexOf("/>", barra.indexOf("<MenuDeAcciones")));
    expect(menu).toContain("rotulo={t(claveDelRotulo(barra))}");
    expect(menu).toContain('className={"tt-menu-mio" + (barra.activaDelMenu ? " active" : "")}');
    expect(menu).toContain("opciones={opcionesDelMenuMio(barra, t, (href) => router.push(href))}");
    // Dentro de `.tabs`, después de las pestañas: va donde iba la raya, y se parte de línea con ellas.
    const tabs = barra.slice(barra.indexOf('<div className={"tabs"'), barra.indexOf("</div>", barra.indexOf('<div className={"tabs"')));
    expect(tabs.indexOf("barra.fila.map")).toBeGreaterThan(-1);
    expect(tabs.indexOf("<MenuDeAcciones")).toBeGreaterThan(tabs.indexOf("barra.fila.map"));
  });

  it("sin la raya que separaba las de gestión de las personales: ya no hay personales sueltas", () => {
    expect(barra).not.toContain("startsPersonal");
  });

  it("los estilos: el botón como una pestaña de la barra, resaltado cuando su pantalla está abierta; la opción actual, marcada", () => {
    const css = leer("src/app/timetracker/timetracker.css");
    expect(css).toContain(".timetracker-module .topbar .tabs button.tt-menu-mio{color:#c6cede;box-shadow:none}");
    expect(css).toContain(".timetracker-module .topbar .tabs button.tt-menu-mio.active{background:var(--tt-accent);color:#fff}");
    expect(css).toContain('.timetracker-module .topbar .tabs button.tt-menu-mio[aria-expanded="true"]{background:rgba(255,255,255,.14);color:#fff}');
    expect(leer("src/app/globals.css")).toContain(".menu-accion-actual { font-weight: 700; box-shadow: inset 3px 0 0 var(--accent); }");
  });
});

// D-NEXT, segunda y tercera parte. El dueño, el 2026-10-11, mirando la barra de Carlos Fuentes (empleado) en la vista
// móvil: «those 3 things should be in the same row make it fit» y «besited timetracker rtg house notifications and just
// CF bubble in the same row make it efficiently». En el teléfono la barra pasa de cuatro filas a dos.

/** El bloque del teléfono de timetracker.css: lo de dentro de `@media(max-width:520px){ … }` de la barra. */
function bloqueDelTelefono(css: string): string {
  const i = css.indexOf("@media(max-width:520px){\n  .timetracker-module .topbar{");
  expect(i, "falta el bloque del teléfono de la barra").toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("\n}", i));
}

describe("las tres pestañas del empleado, en una fila en el teléfono", () => {
  it("el empleado y el gerente las llevan en una fila; el admin no (ocho y un botón se parten como siempre)", () => {
    expect(barraDeTt("employee", "/timetracker").enUnaFila).toBe(true);
    expect(barraDeTt("manager", "/timetracker").enUnaFila).toBe(true);
    expect(barraDeTt(null, "/timetracker").enUnaFila).toBe(true);
    expect(barraDeTt("admin", "/timetracker").enUnaFila).toBe(false);
  });

  it("el nombre corto: en inglés el mismo (cabe), en español se acortan los dos largos", () => {
    expect(claveCorta("week")).toBe("tab.corta.week");
    for (const p of TABS) {
      expect(DICT.en[claveCorta(p.id)], p.id).toBe(DICT.en["tab." + p.id]);
      expect(DICT.es[claveCorta(p.id)], p.id).toBeTruthy();
      expect(DICT.es[claveCorta(p.id)].length, p.id).toBeLessThanOrEqual(DICT.es["tab." + p.id].length);
    }
    expect(TABS.map((p) => DICT.es[claveCorta(p.id)])).toEqual(["⏱ Registrar", "📅 Mi semana", "📝 Solicitudes"]);
  });

  it("la barra marca la fila y pinta los dos nombres de cada pestaña (el CSS elige cuál se ve)", () => {
    const barra = plano(sinComentarios(leer("src/components/timetracker/TopBar.tsx")));
    expect(barra).toContain('<div className={"tabs" + (barra.enUnaFila ? " tt-una-fila" : "")}>');
    expect(barra).toContain('{barra.enUnaFila ? ( <> <span className="tt-nombre-largo">{t("tab." + tb.id)}</span> <span className="tt-nombre-corto">{t(claveCorta(tb.id))}</span> </> ) : t("tab." + tb.id)}');
  });

  it("en el teléfono: una sola fila que se reparte el ancho, letra de 12 px, el nombre corto, y «…» antes que salirse", () => {
    const css = leer("src/app/timetracker/timetracker.css");
    expect(css).toContain(".timetracker-module .tabs .tt-nombre-corto{display:none}");
    const tel = bloqueDelTelefono(css);
    expect(tel).toContain(".timetracker-module .topbar .tabs.tt-una-fila{flex-wrap:nowrap}");
    expect(tel).toContain(".timetracker-module .topbar .tabs.tt-una-fila a{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:12px;padding:8px 6px}");
    expect(tel).toContain(".timetracker-module .topbar .tabs.tt-una-fila .tt-nombre-largo{display:none}");
    expect(tel).toContain(".timetracker-module .topbar .tabs.tt-una-fila .tt-nombre-corto{display:inline}");
  });
});

describe("en el teléfono, arriba: el nombre de la app, la casa, la campana y solo la burbuja", () => {
  const tel = bloqueDelTelefono(leer("src/app/timetracker/timetracker.css"));

  it("la campana y la cuenta suben a la fila del nombre; las pestañas bajan a la suya", () => {
    const barra = plano(sinComentarios(leer("src/components/timetracker/TopBar.tsx")));
    expect(barra).toContain('<div className="tt-marca"> <div className="brand">');
    expect(barra).toContain('<div className="row tt-barra-resto" style={{ alignItems: "center", flexWrap: "wrap" }}>');
    expect(tel).toContain(".timetracker-module .topbar .tt-barra-resto{display:contents}");
    expect(tel).toContain(".timetracker-module .topbar .tt-marca{flex:1 1 0;gap:3px}");
    expect(tel).toContain(".timetracker-module .topbar .tabs{order:2;flex:1 1 100%;min-width:0}");
  });

  it("el nombre de la app se corta con «…» antes que empujar la campana a otra fila", () => {
    expect(tel).toContain(".timetracker-module .topbar .brand{font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}");
  });

  it("de la cuenta, solo la burbuja: el nombre se esconde a la vista (no a un lector de pantalla) y el ▾ se va", () => {
    expect(tel).toContain(".timetracker-module .topbar .account-link .menu-cuenta-nombre{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}");
    expect(tel).not.toMatch(/menu-cuenta-nombre\{display:none/);
    expect(tel).toContain(".timetracker-module .topbar .account-link .menu-cuenta-flecha{display:none}");
  });

  it("`MenuDeCuenta` pinta el nombre y el ▾ con su clase, y el botón sigue abriendo el menú", () => {
    // `children` va en las props porque en `MenuDeCuenta` es una FUNCIÓN obligatoria (recibe `cerrar`), no nodos que
    // `createElement` acepte como tercer argumento.
    // eslint-disable-next-line react/no-children-prop
    const html = renderToStaticMarkup(createElement(MenuDeCuenta, { nombre: "Carlos Fuentes", children: () => null }));
    expect(html).toContain('<span class="menu-cuenta-nombre">Carlos Fuentes</span>');
    expect(html).toContain('<span aria-hidden="true" class="menu-cuenta-flecha">▾</span>');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain(">CF</span>");
  });

  it("el panel de la campana: en el escritorio cuelga de la campana, como antes; en el teléfono, a lo ancho de la cabecera", () => {
    const css = leer("src/app/timetracker/timetracker.css");
    expect(css).toContain(".timetracker-module .tt-campana{position:relative}");
    expect(css).toContain(".timetracker-module .tt-campana-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:320px}");
    expect(tel).toContain(".timetracker-module .topbar .tt-campana{position:static}");
    expect(tel).toContain(".timetracker-module .topbar .tt-campana-panel{left:12px;right:12px;width:auto}");
    const campana = plano(sinComentarios(leer("src/components/timetracker/NotificationBell.tsx")));
    expect(campana).toContain('<div ref={caja} className="tt-campana">');
    expect(campana).toContain('<div className="tt-campana-panel" style={{ maxHeight: 380, overflowY: "auto",');
    expect(campana).not.toMatch(/position: "absolute"|width: 320/);
  });
});
