import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { bloquesStyle, coloresAPelo, coloresSueltosCss } from "./inline-colors";

// G-13 / G-14 (HR). La tabla de abajo es la de la decisión: colores a pelo por fichero DESPUÉS
// del encargo. La prueba cae si un fichero SUBE, o si aparece uno nuevo con colores (sube desde
// 0). No exige cero: los que quedan están dichos, uno a uno, en la decisión.

describe("el guardián se prueba a sí mismo", () => {
  const FIXTURE = `
export function Demo({ on }: { on: boolean }) {
  return (
    <div className="card" style={{ background: "#fff", color: on ? "var(--green)" : "#d64545" }}>
      <span style={{
        border: "1px solid rgba(0,0,0,.08)",
        boxShadow: "0 1px 2px rgba(21,34,56,.05)",
        background: "var(--card, #ffffff)",
      }}>x</span>
      <svg fill="#123456" />
      <i className="text-[#abcdef]" style={{ color: "hsl(210 10% 50%)" }} />
    </div>
  );
}`;
  it("cuenta hex, rgb/rgba y hsl dentro de style={{}}, y nada fuera", () => {
    const h = coloresAPelo(FIXTURE);
    expect(h.map((x) => x.texto)).toEqual(["#fff", "#d64545", "rgba(0,0,0,.08)", "rgba(21,34,56,.05)", "hsl(210 10% 50%)"]);
  });
  it("un bloque de varias líneas cuenta entero y con la línea real de cada color", () => {
    expect(bloquesStyle(FIXTURE)).toHaveLength(3);
    const h = coloresAPelo(FIXTURE);
    expect(h[2].linea).toBe(6);
    expect(h[3].linea).toBe(7);
  });
  it("el respaldo de var(--x, #hex) no es un color a pelo", () => {
    expect(coloresAPelo(`<a style={{ color: "var(--red, #d64545)" }} />`)).toEqual([]);
  });
  it("en CSS, los tokens (--x: #hex) no cuentan; lo suelto sí; los comentarios no", () => {
    const css = `.m { --ink: #152238; --line: #dfe5ee; }\n/* #000000 en comentario */\n.m .a { color: #fff; box-shadow: 0 0 1px rgba(0,0,0,.1); }`;
    expect(coloresSueltosCss(css).map((x) => `${x.linea}:${x.texto}`)).toEqual(["3:#fff", "3:rgba(0,0,0,.1)"]);
  });
});

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("recruiting.css: las dos paletas y lo suelto", () => {
  const css = leer("src/app/recruiting/recruiting.css");
  const tokens = (bloque: string) => [...bloque.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]);
  const claro = tokens(css.slice(css.indexOf(".recruiting-module {"), css.indexOf("font-family: 'Inter'")));
  const oscuro = tokens(css.slice(css.indexOf(':root[data-theme="dark"] .recruiting-module {')));

  it("cada token claro tiene su valor oscuro, salvo --brand-surface (se queda azul marino a propósito)", () => {
    expect(claro.length).toBeGreaterThanOrEqual(30);
    expect(claro.filter((t) => !oscuro.includes(t))).toEqual(["--brand-surface"]);
    expect(oscuro.filter((t) => !claro.includes(t))).toEqual([]);
  });
  it("colores sueltos (no tokens): 15 en 14 líneas, los de la decisión, y no más", () => {
    const sueltos = coloresSueltosCss(css);
    expect(sueltos.length).toBeLessThanOrEqual(15);
    // Blancos sobre color (9), el velo, las sombras: intencionales, uno a uno.
    expect(sueltos.map((x) => x.texto).sort()).toEqual(
      ["#fff", "#fff", "#fff", "#fff", "#fff", "#fff", "#fff", "#fff", "#fff",
        "rgba(0,0,0,.15)", "rgba(0,0,0,.18)", "rgba(15,23,42,.55)", "rgba(21,34,56,.05)", "rgba(255,255,255,.08)", "rgba(36, 86, 201, .12)"].sort(),
    );
  });
});

describe("TSX de HR: colores a pelo por fichero, techo de la decisión", () => {
  // Después del encargo. Lo que queda: blancos sobre el azul marino de la barra y sobre chips,
  // las sombras y el velo del buscador, el rojo sobre la tarjeta oscura de Resultados, el #555
  // de una cabecera solo de impresión. Cada uno está en la decisión.
  const TECHO: Record<string, number> = {
    "src/components/recruiting/GlobalSearch.tsx": 6,
    "src/components/recruiting/TopBar.tsx": 3,
    "src/app/recruiting/(recruiting)/outcomes/page.tsx": 3,
    "src/app/recruiting/(recruiting)/settings/page.tsx": 2,
    "src/components/recruiting/CandidateRow.tsx": 1,
    "src/components/recruiting/ModalHost.tsx": 1,
    "src/app/recruiting/(recruiting)/metrics/page.tsx": 1,
  };

  const ficheros: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".tsx")) ficheros.push(p.replace(/\\/g, "/").split(process.cwd().replace(/\\/g, "/") + "/")[1]);
    }
  };
  walk(join(process.cwd(), "src/app/recruiting"));
  walk(join(process.cwd(), "src/components/recruiting"));

  it("recorre los ficheros de HR (páginas y componentes)", () => {
    expect(ficheros.length).toBeGreaterThanOrEqual(15);
  });

  for (const ruta of ficheros) {
    it(`${ruta.replace("src/", "")} — ≤ ${TECHO[ruta] ?? 0}`, () => {
      const h = coloresAPelo(leer(ruta));
      expect(h.map((x) => `${ruta}:${x.linea} ${x.texto}`).length, h.map((x) => `${ruta}:${x.linea} ${x.texto}`).join("\n")).toBeLessThanOrEqual(TECHO[ruta] ?? 0);
    });
  }

  it("la tabla no lleva techos de más: cada fichero de la tabla existe y llega a su techo", () => {
    // Si un fichero baja, se baja el techo en la tabla (y en la decisión): que no quede holgura
    // para volver a subir sin que nadie lo vea.
    for (const [ruta, techo] of Object.entries(TECHO)) {
      expect(ficheros, ruta).toContain(ruta);
      expect(coloresAPelo(leer(ruta)).length, ruta).toBe(techo);
    }
  });
});

// ============================================================
// Entregas: la otra mitad de la deuda de G-13 (D-226).
//
// D-211 cerró HR y dejó anotadas Entregas y Time Tracker. Esta tabla es la de Entregas
// DESPUÉS del encargo: 117 colores a pelo pasaron a 79. Lo que queda no es residuo — es lo
// que se decidió dejar, y cada grupo tiene su motivo en la decisión. Hoy son 80: D-234
// sumó uno, el blanco del boton de la pantalla de fallo de lectura, y lo dice ahí.
//
// La regla que explica 64 de los 80: **un blanco sobre un fondo de color fijo no cambia con
// el tema**. Una pastilla roja con texto blanco se ve igual en claro y en oscuro, porque el
// rojo no se mueve. Convertirlos a `--card` los rompería justo en oscuro, que es lo contrario
// de lo que este encargo venía a hacer.
// ============================================================

describe("Entregas: colores a pelo por fichero, techo de la decisión", () => {
  const TECHO_ENTREGAS: Record<string, number> = {
    "src/app/(app)/account/page.tsx": 4,
    "src/app/(app)/accounts/page.tsx": 4,
    "src/app/(app)/audit/page.tsx": 1,
    "src/app/(app)/dashboard/page.tsx": 4,
    "src/app/(app)/data/page.tsx": 4,
    "src/app/(app)/map/page.tsx": 4,
    "src/app/(app)/market/page.tsx": 3,
    "src/app/(app)/my-route/page.tsx": 1,
    "src/app/(app)/routes/page.tsx": 11,
    "src/app/(app)/settings/page.tsx": 1,
    "src/app/(app)/summary/page.tsx": 1,
    "src/components/AppUpdateBanner.tsx": 2,
    "src/components/DispatchBoard.tsx": 1,
    "src/components/NotificationBell.tsx": 1,
    "src/components/OfflineBanner.tsx": 1,
    "src/components/OrderModal.tsx": 10,
    "src/components/OrdersTable.tsx": 5,
    // 1 desde D-234: el blanco del texto sobre el azul del boton de reintentar. Todo lo
    // demas de esa pantalla usa `var(--token, #hex)`, que respeta la paleta del modulo
    // donde salga; el blanco sobre un fondo de color fijo es de los 63 de siempre.
    "src/components/RetryButton.tsx": 1,
    "src/components/SessionExpired.tsx": 8,
    "src/components/ShiftClock.tsx": 1,
    // Baja de 6 a 5 (D-247): el fondo translúcido de los botones de la barra estaba escrito
    // dos veces y ahora es una constante. El techo baja con él — la tabla no admite holgura, y
    // eso es lo que hace que sea un techo y no una estimación.
    "src/components/TopBar.tsx": 5,
    "src/components/UserDialog.tsx": 3,
    "src/components/UsersImportModal.tsx": 3,
  };

  const norm = (s: string) => s.split("\\").join("/");
  const RAIZ = norm(process.cwd());
  const ficherosEntregas: string[] = [];
  const recorre = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      // Fuera las otras apps: HR y Time Tracker tienen su propia deuda y su propia tabla.
      if (statSync(p).isDirectory()) { if (!/recruiting|timetracker|erp/.test(f)) recorre(p); }
      else if (f.endsWith(".tsx")) ficherosEntregas.push(norm(p).replace(RAIZ + "/", ""));
    }
  };
  recorre(join(process.cwd(), "src/app/(app)"));
  recorre(join(process.cwd(), "src/components"));

  it("recorre los ficheros de Entregas (páginas y componentes)", () => {
    expect(ficherosEntregas.length).toBeGreaterThanOrEqual(40);
  });

  for (const ruta of ficherosEntregas) {
    it(`${ruta.replace("src/", "")} — ≤ ${TECHO_ENTREGAS[ruta] ?? 0}`, () => {
      const h = coloresAPelo(leer(ruta));
      const detalle = h.map((x) => `${ruta}:${x.linea} ${x.texto}`).join("\n");
      expect(h.length, detalle).toBeLessThanOrEqual(TECHO_ENTREGAS[ruta] ?? 0);
    });
  }

  it("la tabla no lleva techos de más: cada fichero existe y llega a su techo", () => {
    // Igual que en HR: si un fichero baja, se baja el techo. Que no quede holgura para volver
    // a subir sin que nadie lo vea.
    for (const [ruta, techo] of Object.entries(TECHO_ENTREGAS)) {
      expect(ficherosEntregas, ruta).toContain(ruta);
      expect(coloresAPelo(leer(ruta)).length, ruta).toBe(techo);
    }
  });

  it("el total es 79, y de esos 64 son el blanco sobre color", () => {
    // El número entero, para que un cambio que reparta colores entre ficheros sin subir
    // ninguno por encima de su techo no pase desapercibido.
    let total = 0;
    let blancos = 0;
    for (const ruta of ficherosEntregas) {
      const h = coloresAPelo(leer(ruta));
      total += h.length;
      blancos += h.filter((x) => x.texto === "#fff").length;
    }
    expect(total).toBe(79);
    expect(blancos).toBe(64);
  });
});

describe("los tokens nuevos de Entregas: mismo valor en claro, par propio en oscuro", () => {
  // Los finales de línea se normalizan: el fichero está en CRLF en Windows y los cortes de
  // abajo buscan saltos de línea. Sin esto la prueba mide sobre una cadena vacía y pasa sin
  // haber comprobado nada, que es peor que fallar.
  const css = leer("src/app/globals.css").split("\r\n").join("\n");
  const claro = css.slice(css.indexOf(":root {"), css.indexOf(':root[data-theme="dark"] { color-scheme'));
  const oscuro = css.slice(css.indexOf(':root[data-theme="dark"] {\n  --ink: #0d1420;'));

  // Cada token nuevo con el hex EXACTO que sustituyó. Si alguien cambia uno, el modo claro se
  // mueve y esta prueba lo dice — que es la vara que puso D-211 y la que hace esto seguro.
  const NUEVOS: Record<string, string> = {
    "--amber-soft": "#fff7ec",
    "--amber-text": "#b9791a",
    "--red-soft": "#fef6f6",
    "--red-tint": "#fdeaea",
    "--red-chip-bg": "#fff1f0",
    "--red-chip-text": "#a10e0e",
    "--red-chip-line": "#f0c0bd",
    "--green-soft": "#e9f7f0",
    "--teaching-bg": "#7c3aed",
    "--teaching-text": "#7c3aed",
    "--panel-line": "#dfe3ea",
    "--row-line": "#eef1f5",
  };

  for (const [token, hex] of Object.entries(NUEVOS)) {
    it(`${token} vale ${hex} en claro — el color de antes, sin mover`, () => {
      expect(claro).toContain(`${token}: ${hex};`);
    });
  }

  it("todos tienen par oscuro, salvo el fondo del modo enseñanza, que no debe cambiar", () => {
    // `--teaching-bg` lleva texto blanco encima: aclararlo en oscuro rompería ese texto.
    for (const token of Object.keys(NUEVOS)) {
      if (token === "--teaching-bg") { expect(oscuro).not.toContain(`${token}:`); continue; }
      expect(oscuro, token).toContain(`${token}:`);
    }
  });

  it("los tintes oscuros son los que YA usaban los avisos, no unos nuevos", () => {
    // Un aviso `.banner.warn` y una tarjeta teñida de ámbar no pueden verse distintos en
    // oscuro. Los valores salen de las reglas que ya existían más abajo en este mismo fichero.
    expect(oscuro).toContain("--amber-soft: #3a2f12;");
    expect(css).toContain(".banner.warn { background: #3a2f12;");
    expect(oscuro).toContain("--red-chip-text: #ffb3bf;");
    expect(css).toContain(".banner.err  { background: #3a1620; color: #ffb3bf;");
    expect(oscuro).toContain("--green-soft: #16352a;");
    expect(css).toContain(".banner.ok   { background: #16352a;");
  });

  it("no se redefine ningún token que ya existía", () => {
    // El encargo lo pide y es la mitad de «cero cambio en claro»: los pares nuevos se añaden,
    // los viejos no se tocan.
    for (const viejo of ["--ink", "--text", "--paper", "--card", "--line", "--accent", "--amber", "--green", "--red", "--purple", "--teal", "--gray"]) {
      expect(claro.split(`${viejo}:`).length - 1, viejo).toBe(1);
    }
  });
});
