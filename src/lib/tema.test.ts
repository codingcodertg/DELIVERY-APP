import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { GUION_DE_TEMA, PREFERENCIAS_DE_TEMA, esPreferenciaDeTema, preferenciaDeTemaGuardada, temaEfectivo, type PreferenciaDeTema } from "./tema";

/**
 * El tema, con la tercera opción del personalizador: «como mi equipo» (D-NEXT).
 *
 * Se prueba la regla con datos (`temaEfectivo`), el guion que corre antes de pintar EJECUTÁNDOLO contra
 * la misma regla, y que quien pinta de verdad —el layout y el proveedor— usa esas dos piezas.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("temaEfectivo", () => {
  const claro = { sistemaOscuro: false, escritorio: false };
  const sistemaOscuro = { sistemaOscuro: true, escritorio: false };
  const escritorio = { sistemaOscuro: false, escritorio: true };

  it("claro u oscuro elegidos mandan, diga lo que diga el sistema o el escritorio", () => {
    expect(temaEfectivo("light", { sistemaOscuro: true, escritorio: true })).toBe("light");
    expect(temaEfectivo("dark", claro)).toBe("dark");
  });

  it("«como mi equipo» sigue al sistema, en los dos sentidos", () => {
    expect(temaEfectivo("system", sistemaOscuro)).toBe("dark");
    expect(temaEfectivo("system", claro)).toBe("light");
    // Y el escritorio no lo cambia: quien eligió seguir al sistema, sigue al sistema.
    expect(temaEfectivo("system", escritorio)).toBe("light");
  });

  it("sin elección, lo de siempre: claro, y oscuro en el escritorio de Time Tracker (D-080)", () => {
    expect(temaEfectivo(null, claro)).toBe("light");
    expect(temaEfectivo(undefined, sistemaOscuro)).toBe("light");
    expect(temaEfectivo(null, escritorio)).toBe("dark");
  });

  it("las tres opciones, y nada más, son preferencias válidas", () => {
    expect([...PREFERENCIAS_DE_TEMA]).toEqual(["light", "dark", "system"]);
    for (const p of PREFERENCIAS_DE_TEMA) expect(esPreferenciaDeTema(p), p).toBe(true);
    for (const v of ["auto", "", null, undefined, 1, "Dark"]) expect(esPreferenciaDeTema(v), String(v)).toBe(false);
  });
});

describe("lo guardado en rtg_prefs", () => {
  it("lee las tres opciones", () => {
    expect(preferenciaDeTemaGuardada('{"lang":"es","theme":"system"}')).toBe("system");
    expect(preferenciaDeTemaGuardada('{"theme":"dark"}')).toBe("dark");
    expect(preferenciaDeTemaGuardada('{"theme":"light"}')).toBe("light");
  });
  it("cualquier duda es null: vacío, roto o un valor raro", () => {
    for (const raw of [null, undefined, "", "{", '{"theme":"auto"}', "null", '{"lang":"es"}']) {
      expect(preferenciaDeTemaGuardada(raw), String(raw)).toBeNull();
    }
  });
});

/** Corre el guion de antes de pintar con un navegador de mentira y devuelve el `data-theme` que puso. */
function correGuion(a: { guardado: string | null; sistemaOscuro: boolean; escritorio: boolean }): { tema: string | null; lang: string | null } {
  const attrs: Record<string, string> = {};
  const window = {
    ttDesktop: a.escritorio ? { isDesktop: true } : undefined,
    matchMedia: (q: string) => ({ matches: q === "(prefers-color-scheme: dark)" && a.sistemaOscuro }),
  };
  const localStorage = { getItem: (k: string) => (k === "rtg_prefs" ? a.guardado : null) };
  const document = { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } } };
  new Function("window", "localStorage", "document", GUION_DE_TEMA)(window, localStorage, document);
  return { tema: attrs["data-theme"] ?? null, lang: attrs.lang ?? null };
}

describe("el guion de antes de pintar hace lo mismo que temaEfectivo", () => {
  const elecciones: (PreferenciaDeTema | null)[] = ["light", "dark", "system", null];
  for (const pref of elecciones) {
    for (const sistemaOscuro of [false, true]) {
      for (const escritorio of [false, true]) {
        it(`${pref ?? "sin elegir"} · sistema ${sistemaOscuro ? "oscuro" : "claro"} · ${escritorio ? "escritorio" : "web"}`, () => {
          const guardado = pref ? JSON.stringify({ lang: "es", theme: pref }) : null;
          expect(correGuion({ guardado, sistemaOscuro, escritorio }).tema).toBe(temaEfectivo(pref, { sistemaOscuro, escritorio }));
        });
      }
    }
  }

  it("pone también el idioma guardado, como antes", () => {
    expect(correGuion({ guardado: '{"lang":"es","theme":"dark"}', sistemaOscuro: false, escritorio: false }).lang).toBe("es");
  });

  it("con lo guardado roto no revienta la página: no pinta nada y deja el CSS por defecto", () => {
    expect(() => correGuion({ guardado: "{", sistemaOscuro: false, escritorio: false })).not.toThrow();
  });

  it("el layout raíz usa ESTE guion, no una copia", () => {
    const layout = leer("src/app/layout.tsx");
    expect(layout).toContain('import { GUION_DE_TEMA } from "@/lib/tema";');
    expect(layout).toContain("const themeScript = GUION_DE_TEMA;");
    expect(layout).toContain("<script dangerouslySetInnerHTML={{ __html: themeScript }} />");
  });
});

describe("el proveedor pinta con la misma regla y guarda lo ELEGIDO", () => {
  const prefs = leer("src/lib/prefs.tsx");

  it("el tema que se pinta sale de temaEfectivo con la elección y el sistema", () => {
    expect(prefs).toContain("const theme = temaEfectivo(themeElegido, { sistemaOscuro: oscuroDelSistema, escritorio: enEscritorio() });");
    expect(prefs).toContain('document.documentElement.setAttribute("data-theme", theme);');
  });

  it("guarda la elección (también «system»), no el tema resuelto", () => {
    expect(prefs).toContain("localStorage.setItem(KEY, JSON.stringify({ lang, theme: themeElegido ?? theme }));");
  });

  it("lee las tres opciones al cargar", () => {
    expect(prefs).toContain("if (esPreferenciaDeTema(guardado)) setThemeElegido(guardado);");
  });

  it("con «system», escucha los cambios del sistema en vivo y deja de escuchar al cambiar", () => {
    const efecto = prefs.slice(prefs.indexOf('if (themeElegido !== "system"'), prefs.indexOf("}, [themeElegido]);"));
    expect(efecto).toContain("window.matchMedia(CONSULTA_OSCURO)");
    expect(efecto).toContain('mq.addEventListener?.("change", cambia);');
    expect(efecto).toContain('return () => mq.removeEventListener?.("change", cambia);');
  });

  it("no pinta ni guarda NADA antes de leer lo guardado: si no, lo de arranque pisaba lo elegido", () => {
    // Medido en el navegador el 2026-10-07: abrir Time Tracker con «es/dark» guardado lo dejaba en
    // «en/light» (su HTML de servidor nunca coincide en español y React rehace el árbol justo entonces).
    const persistir = prefs.slice(prefs.indexOf("// Apply + persist whenever they change."), prefs.indexOf("}, [cargado, lang, theme, themeElegido]);"));
    expect(persistir).toMatch(/useEffect\(\(\) => \{\n[^\n]*\n\s*if \(!cargado\) return;\n\s*document\.documentElement\.setAttribute\("data-theme", theme\);/);
    const cargar = prefs.slice(prefs.indexOf("// Load saved prefs on mount."), prefs.indexOf("if (LOCAL_MODE) return;"));
    expect(cargar).toContain("setCargado(true);");
    expect(cargar.indexOf("setCargado(true);")).toBeGreaterThan(cargar.indexOf("setThemeElegido(guardado);"));
  });

  it("al personalizador le da lo elegido; a todas las apps, el tema resuelto", () => {
    expect(prefs).toContain("themePref: themeElegido ?? theme");
    expect(prefs).toContain("const setTheme = useCallback((t: PreferenciaDeTema) => setThemeElegido(t), []);");
  });
});
