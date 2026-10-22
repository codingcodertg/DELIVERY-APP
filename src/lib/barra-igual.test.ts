import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DELIVERIES_CARD, MODULES } from "./constants";

// D-643 (2026-10-22). El dueño, con la barra de Entregas delante: «Quiero que así sea el header de todas. Todos. De
// ERP, de HR. Todo con su casita del lado izquierdo, del mismo tamaño. […] Porque HR tiene la casa por acá, ERP tiene
// por acá. Entonces quiero que todo sea igual.»
//
// La prueba de puerta: RECORRE las apps del registro y los ficheros, en vez de fiarse de una lista que alguien olvide
// ampliar. Cada app del hub monta `BarraDeApp` (o `BarraSencilla`, que la monta), nadie más pinta `.topbar` ni la casa,
// y ninguna hoja de módulo redefine los tamaños de la marca.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const codigo = (r: string) => sinComentarios(leer(r));
const recorre = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = `${dir}/${n}`;
    return statSync(p).isDirectory() ? recorre(p, ext) : ext.test(n) ? [p] : [];
  });

const PIEZA = "src/components/BarraDeApp.tsx";

/** Cada app del registro: dónde se monta su barra y qué componente la pinta. */
const BARRAS: Record<string, { carpeta: string; barra: string; monta: string[] | "cada-pagina"; etiqueta: string }> = {
  deliveries: { carpeta: "src/app/(app)", barra: "src/components/TopBar.tsx", monta: ["src/app/(app)/layout.tsx"], etiqueta: "<TopBar " },
  recruiting: { carpeta: "src/app/recruiting", barra: "src/components/recruiting/TopBar.tsx", monta: ["src/app/recruiting/(recruiting)/layout.tsx"], etiqueta: "<TopBar " },
  timetracker: { carpeta: "src/app/timetracker", barra: "src/components/timetracker/TopBar.tsx", monta: ["src/app/timetracker/(timetracker)/layout.tsx"], etiqueta: "<TopBar " },
  erp: { carpeta: "src/app/erp", barra: "src/components/erp/side-nav.tsx", monta: "cada-pagina", etiqueta: "<Header />" },
  customers: { carpeta: "src/app/customers", barra: "src/components/erp/side-nav.tsx", monta: "cada-pagina", etiqueta: "<BarraDeClientes " },
  estimator: { carpeta: "src/app/estimator", barra: PIEZA, monta: ["src/app/estimator/layout.tsx"], etiqueta: "<BarraSencilla " },
  leads: { carpeta: "src/app/leads", barra: PIEZA, monta: ["src/app/leads/layout.tsx"], etiqueta: "<BarraSencilla " },
  surveys: { carpeta: "src/app/surveys", barra: PIEZA, monta: ["src/app/surveys/layout.tsx"], etiqueta: "<BarraSencilla " },
  promos: { carpeta: "src/app/promos", barra: PIEZA, monta: ["src/app/promos/layout.tsx"], etiqueta: "<BarraSencilla " },
};

/** Lo que hay en `src/app` y NO es una app con barra, con el porqué. */
const NO_SON_APPS: Record<string, string> = {
  home: "el hub: es adonde lleva la casa, así que no lleva casa hacia sí mismo (ni barra: es el selector de apps)",
  api: "rutas de servidor",
  auth: "rutas de servidor (salir, callback)",
  login: "antes de entrar no hay hub al que volver",
  "change-password": "pantalla de cuenta fuera de las apps",
  "reset-password": "pantalla de cuenta fuera de las apps",
  "no-access": "quien llega aquí no tiene ninguna app",
  track: "el seguimiento público del cliente: no es del equipo",
  unsubscribe: "el enlace público de baja de correos",
};

/** Una página que solo redirige no pinta nada, así que no necesita barra (p. ej. `/erp` → `/erp/catalog`). */
const soloRedirige = (src: string) => /^\s*redirect\(/m.test(src) && !/return\s*[(<]/.test(src);

describe("cada app del hub lleva LA barra (D-643)", () => {
  it("el registro y esta tabla son el mismo conjunto: una app nueva no entra sin barra", () => {
    expect(Object.keys(BARRAS).sort()).toEqual([DELIVERIES_CARD.key, ...MODULES.map((m) => m.key)].sort());
  });

  it("todo lo que hay en src/app es una app de la tabla o está en la lista de lo que no lo es", () => {
    const carpetas = readdirSync("src/app").filter((n) => statSync(`src/app/${n}`).isDirectory());
    const conocidas = new Set([...Object.values(BARRAS).map((b) => b.carpeta.slice("src/app/".length)), ...Object.keys(NO_SON_APPS)]);
    expect(carpetas.filter((c) => !conocidas.has(c))).toEqual([]);
  });

  it("cada barra monta `BarraDeApp`, con la casa de los datos de la persona", () => {
    for (const [app, b] of Object.entries(BARRAS)) {
      if (b.barra === PIEZA) continue;
      const src = codigo(b.barra);
      expect(src, app).toContain('import { BarraDeApp } from "@/components/BarraDeApp";');
      expect(src.match(/<BarraDeApp /g) ?? [], app).toHaveLength(1);
      expect(src, app).toMatch(/<BarraDeApp nombre=\{[^\n]*\} deliveriesRole=\{[^}]+\} moduleAccess=\{[^}]+\}/);
    }
    // `BarraSencilla` (Leads, Encuestas, Cotizador, Promos) es la misma pieza con el menú del nombre dentro.
    expect(codigo(PIEZA)).toMatch(/export function BarraSencilla[\s\S]*<BarraDeApp nombre=\{t\(nombre\[0\], nombre\[1\]\)\} deliveriesRole=\{deliveriesRole\} moduleAccess=\{moduleAccess\}>/);
  });

  it("y cada app la monta: en su layout, o en cada página que pinta algo", () => {
    for (const [app, b] of Object.entries(BARRAS)) {
      const donde = b.monta === "cada-pagina"
        ? recorre(b.carpeta, /^page\.tsx$/).filter((p) => !soloRedirige(codigo(p)))
        : b.monta;
      expect(donde.length, app).toBeGreaterThan(0);
      for (const f of donde) expect(codigo(f), `${app}: ${f}`).toContain(b.etiqueta);
    }
    // Las de layout montan la barra en los dos caminos que pintan: el demo y la sesión de verdad.
    for (const app of ["estimator", "leads", "surveys", "promos"]) {
      expect(codigo(`src/app/${app}/layout.tsx`).match(/<BarraSencilla /g) ?? [], app).toHaveLength(2);
    }
  });
});

describe("una sola pieza: nadie más pinta la barra ni la casa", () => {
  const tsx = recorre("src", /\.tsx$/);

  it("`.topbar` solo la escribe `BarraDeApp`", () => {
    const conTopbar = tsx.filter((f) => /className=\{?["'`][^"'`]*\btopbar\b/.test(codigo(f)));
    expect(conTopbar).toEqual([PIEZA]);
  });

  it("la marca (`entregas-marca`) solo la escribe `BarraDeApp`, y la casa solo `HubHomeLink`", () => {
    expect(tsx.filter((f) => codigo(f).includes("entregas-marca"))).toEqual([PIEZA]);
    expect(tsx.filter((f) => codigo(f).includes("tab-casa"))).toEqual(["src/components/HubHomeLink.tsx"]);
    expect(tsx.filter((f) => codigo(f).includes("<HubHomeLink "))).toEqual([PIEZA]);
  });

  it("dentro de las apps no queda ningún «Volver al hub» propio: la vuelta es la casa", () => {
    const deLasApps = [
      ...Object.values(BARRAS).flatMap((b) => recorre(b.carpeta, /\.tsx$/)),
      "src/components/TopBar.tsx",
      "src/components/ModuleSwitcher.tsx",
      ...["recruiting", "timetracker", "erp", "customers"].flatMap((d) => recorre(`src/components/${d}`, /\.tsx$/)),
    ];
    expect(deLasApps.filter((f) => codigo(f).includes('href="/home"'))).toEqual([]);
  });
});

describe("los tamaños viven una vez, en globals.css", () => {
  const css = leer("src/app/globals.css");

  it("la marca: alineada, con 6 px entre nombre y casa; la casa de 26 px, más fuerte que la pestaña de cualquier módulo", () => {
    expect(css).toContain(".entregas-marca { display: flex; align-items: center; gap: 6px; min-width: 0; }");
    expect(css).toContain(".topbar .entregas-marca .tab-casa { font-size: 26px; line-height: 1; padding: 4px 12px; }");
    expect(css).toContain(".topbar .entregas-marca h1 { text-transform: uppercase; line-height: normal; }");
    expect(css).toContain(".topbar { line-height: normal; }");
    // Y la burbuja del nombre, que en RR. HH. medía 28 px y hacía su barra 2 px más alta.
    expect(css).toContain(".topbar .entregas-barra-resto .account-link .avatar.sm { width: 24px; height: 24px; flex: 0 0 24px; font-size: 10px; }");
  });

  it("ninguna hoja de módulo redefine el nombre, la casa ni la marca", () => {
    const hojas = recorre("src/app", /\.css$/).filter((f) => f !== "src/app/globals.css");
    expect(hojas.length).toBeGreaterThan(3);
    for (const f of hojas) {
      const h = leer(f).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(h, f).not.toMatch(/\.topbar\s+h1|tab-casa|entregas-marca|tt-marca|\.brand\b/);
    }
  });

  it("RR. HH. solo repite lo que su `* { padding: 0 }` le obliga: el fondo y los rellenos, con su versión de teléfono", () => {
    const rr = leer("src/app/recruiting/recruiting.css");
    const reglas = rr.match(/\.recruiting-module \.topbar \{[^}]*\}/g) ?? [];
    expect(reglas).toEqual([
      ".recruiting-module .topbar { background: var(--brand-surface); padding: 14px 20px; }",
      ".recruiting-module .topbar { padding: 10px 12px; }",
    ]);
    expect(rr.match(/\.recruiting-module \.tabs \{[^}]*\}/g) ?? []).toEqual([".recruiting-module .tabs { padding-bottom: 2px; }"]);
  });
});
