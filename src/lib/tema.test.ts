import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  GUION_DE_TEMA, PREFERENCIAS_DE_TEMA, TEMA_VIEJO_DEL_EQUIPO, esPreferenciaDeTema, preferenciaDeTemaGuardada,
  temaDeLoGuardado, temaEfectivo, type Tema,
} from "./tema";

/**
 * El tema: Claro u Oscuro. D-490 añadió «Same as my device» (`system`) y D-530 la quitó —el dueño: «that same as
 * my device remove it»—.
 *
 * Se prueba la regla con datos (`temaEfectivo`, `temaDeLoGuardado`), el guion que corre antes de pintar
 * EJECUTÁNDOLO contra la misma regla, y que quien pinta de verdad —el layout y el proveedor— usa esas piezas.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("temaEfectivo", () => {
  it("claro u oscuro elegidos mandan, también en el escritorio", () => {
    expect(temaEfectivo("light", { escritorio: true })).toBe("light");
    expect(temaEfectivo("dark", { escritorio: false })).toBe("dark");
  });

  it("sin elección, lo de siempre: claro, y oscuro en el escritorio de Time Tracker (D-080)", () => {
    expect(temaEfectivo(null, { escritorio: false })).toBe("light");
    expect(temaEfectivo(undefined, { escritorio: false })).toBe("light");
    expect(temaEfectivo(null, { escritorio: true })).toBe("dark");
  });

  it("solo Claro y Oscuro son elecciones: «system» ya no lo es (D-530)", () => {
    expect([...PREFERENCIAS_DE_TEMA]).toEqual(["light", "dark"]);
    for (const p of PREFERENCIAS_DE_TEMA) expect(esPreferenciaDeTema(p), p).toBe(true);
    for (const v of ["system", "auto", "", null, undefined, 1, "Dark"]) expect(esPreferenciaDeTema(v), String(v)).toBe(false);
  });
});

describe("quien tenía guardado «Same as my device» (D-530)", () => {
  it("se queda con lo que su equipo le está pintando ahora: oscuro con el sistema en oscuro, claro si no", () => {
    expect(TEMA_VIEJO_DEL_EQUIPO).toBe("system");
    expect(temaDeLoGuardado("system", { sistemaOscuro: true })).toBe("dark");
    expect(temaDeLoGuardado("system", { sistemaOscuro: false })).toBe("light");
  });

  it("claro y oscuro guardados no se tocan, diga lo que diga el sistema", () => {
    expect(temaDeLoGuardado("light", { sistemaOscuro: true })).toBe("light");
    expect(temaDeLoGuardado("dark", { sistemaOscuro: false })).toBe("dark");
  });

  it("nada guardado, o algo raro, es «sin elección»", () => {
    for (const v of [null, undefined, "", "auto", "Dark", 1]) expect(temaDeLoGuardado(v, { sistemaOscuro: true }), String(v)).toBeNull();
  });
});

describe("lo guardado en rtg_prefs", () => {
  const oscuro = { sistemaOscuro: true };
  it("lee claro y oscuro tal cual, y convierte «system»", () => {
    expect(preferenciaDeTemaGuardada('{"lang":"es","theme":"system"}', oscuro)).toBe("dark");
    expect(preferenciaDeTemaGuardada('{"lang":"es","theme":"system"}', { sistemaOscuro: false })).toBe("light");
    expect(preferenciaDeTemaGuardada('{"theme":"dark"}', { sistemaOscuro: false })).toBe("dark");
    expect(preferenciaDeTemaGuardada('{"theme":"light"}', oscuro)).toBe("light");
  });
  it("cualquier duda es null: vacío, roto o un valor raro", () => {
    for (const raw of [null, undefined, "", "{", '{"theme":"auto"}', "null", '{"lang":"es"}']) {
      expect(preferenciaDeTemaGuardada(raw, oscuro), String(raw)).toBeNull();
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

describe("el guion de antes de pintar pinta lo mismo que el proveedor va a guardar", () => {
  // `system` sigue en la lista: es lo que tendrá guardado quien lo eligió, la primera vez que abra la app.
  const guardados: (Tema | "system" | null)[] = ["light", "dark", "system", null];
  for (const guardado of guardados) {
    for (const sistemaOscuro of [false, true]) {
      for (const escritorio of [false, true]) {
        it(`${guardado ?? "sin elegir"} · sistema ${sistemaOscuro ? "oscuro" : "claro"} · ${escritorio ? "escritorio" : "web"}`, () => {
          const raw = guardado ? JSON.stringify({ lang: "es", theme: guardado }) : null;
          const loQueGuardaElProveedor = temaEfectivo(preferenciaDeTemaGuardada(raw, { sistemaOscuro }), { escritorio });
          expect(correGuion({ guardado: raw, sistemaOscuro, escritorio }).tema).toBe(loQueGuardaElProveedor);
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

describe("el proveedor pinta con la misma regla y convierte «system» al leer", () => {
  const prefs = leer("src/lib/prefs.tsx");

  it("el tema que se pinta sale de temaEfectivo con la elección", () => {
    expect(prefs).toContain("const theme = temaEfectivo(themeElegido, { escritorio: enEscritorio() });");
    expect(prefs).toContain('document.documentElement.setAttribute("data-theme", theme);');
  });

  it("al cargar, lee lo guardado con preferenciaDeTemaGuardada y lo que el sistema pinta AHORA", () => {
    expect(prefs).toContain("const guardado = preferenciaDeTemaGuardada(raw, { sistemaOscuro: sistemaOscuro() });");
    expect(prefs).toContain("if (guardado) setThemeElegido(guardado);");
  });

  it("guarda el tema que se pinta, que ya nunca es «system»", () => {
    expect(prefs).toContain("localStorage.setItem(KEY, JSON.stringify({ lang, theme }));");
  });

  it("ya no escucha al sistema en vivo ni ofrece «system»: sin addEventListener de matchMedia", () => {
    expect(prefs).not.toContain('addEventListener?.("change"');
    expect(prefs).not.toMatch(/themeElegido !== "system"/);
  });

  it("no pinta ni guarda NADA antes de leer lo guardado: si no, lo de arranque pisaba lo elegido", () => {
    // Medido en el navegador el 2026-10-07: abrir Time Tracker con «es/dark» guardado lo dejaba en
    // «en/light» (su HTML de servidor nunca coincide en español y React rehace el árbol justo entonces).
    const persistir = prefs.slice(prefs.indexOf("// Apply + persist whenever they change."), prefs.indexOf("}, [cargado, lang, theme]);"));
    expect(persistir).toMatch(/useEffect\(\(\) => \{\n[^\n]*\n\s*if \(!cargado\) return;\n\s*document\.documentElement\.setAttribute\("data-theme", theme\);/);
    const cargar = prefs.slice(prefs.indexOf("// Load saved prefs on mount."), prefs.indexOf("if (LOCAL_MODE) return;"));
    expect(cargar).toContain("setCargado(true);");
    expect(cargar.indexOf("setCargado(true);")).toBeGreaterThan(cargar.indexOf("setThemeElegido(guardado);"));
  });

  it("al personalizador le da el tema que se pinta, y elegir lo guarda tal cual", () => {
    expect(prefs).not.toMatch(/themePref[:;]/);
    expect(prefs).toContain("const setTheme = useCallback((t: PreferenciaDeTema) => setThemeElegido(t), []);");
  });
});
