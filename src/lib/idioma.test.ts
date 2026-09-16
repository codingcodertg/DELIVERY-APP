import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EVENTO_IDIOMA, idiomaAlCargar, idiomaDeRtgPrefs, sincronizaIdiomaAlCargar, type Idioma } from "./idioma";

/**
 * Un solo idioma para todas las apps, por persona (D-NEXT).
 *
 * Cuatro clases de prueba:
 *   1. La regla de carga, con datos, y la carga entera con la base falsa: qué se aplica, qué se
 *      siembra, y que un error no siembra nada. Nada de red.
 *   2. Time Tracker sigue el aviso del hub, importando su módulo de verdad.
 *   3. Un solo sitio escribe el idioma: barrido de `src/`.
 *   4. La migración 112 contra la vista vigente de la 089.
 */

// Lo que el proveedor le pasa: `hub` sale de `idiomaDeRtgPrefs(localStorage "rtg_prefs")` y `tt`
// es `localStorage "tt_lang"` en crudo. Se alimenta así, con la forma real, y no con idiomas limpios.
const rtgPrefs = (lang: string) => idiomaDeRtgPrefs(JSON.stringify({ lang, theme: "dark" }));

describe("la regla de carga", () => {
  it("si la base ya tiene idioma, manda la base, aunque las copias locales digan otra cosa", () => {
    expect(idiomaAlCargar({ servidor: "es", hub: rtgPrefs("en"), tt: "en" })).toEqual({ unificado: "es", sembrar: null });
  });

  it("sin idioma en la base, si las dos copias coinciden: se usa y se siembra", () => {
    expect(idiomaAlCargar({ servidor: null, hub: rtgPrefs("es"), tt: "es" })).toEqual({ unificado: "es", sembrar: "es" });
  });

  it("con una sola copia, esa", () => {
    expect(idiomaAlCargar({ servidor: null, hub: rtgPrefs("es"), tt: null })).toEqual({ unificado: "es", sembrar: "es" });
    expect(idiomaAlCargar({ servidor: null, hub: null, tt: "es" })).toEqual({ unificado: "es", sembrar: "es" });
  });

  it("si las copias NO coinciden, no se elige por la persona: cada app sigue con el suyo", () => {
    // El orden va a propósito en los dos sentidos: una regla que diera prioridad a una de las dos
    // pasaría con uno de ellos y no con el otro.
    expect(idiomaAlCargar({ servidor: null, hub: rtgPrefs("en"), tt: "es" })).toEqual({ unificado: null, sembrar: null });
    expect(idiomaAlCargar({ servidor: null, hub: rtgPrefs("es"), tt: "en" })).toEqual({ unificado: null, sembrar: null });
  });

  it("sin nada en ningún sitio, no se decide", () => {
    expect(idiomaAlCargar({ servidor: null, hub: null, tt: null })).toEqual({ unificado: null, sembrar: null });
  });

  it("avisos en español y pantalla en inglés (un PC compartido): no se siembra, para no pasar sus SMS a inglés", () => {
    // La entrada real que pidió la revisión: base vacía, equipo en inglés, avisos en español.
    expect(idiomaAlCargar({ servidor: null, hub: rtgPrefs("en"), tt: null, avisos: "es" })).toEqual({ unificado: null, sembrar: null });
    expect(idiomaAlCargar({ servidor: null, hub: null, tt: "en", avisos: "es" })).toEqual({ unificado: null, sembrar: null });
  });

  it("avisos en español y pantalla en español: coinciden, se siembra", () => {
    expect(idiomaAlCargar({ servidor: null, hub: rtgPrefs("es"), tt: "es", avisos: "es" })).toEqual({ unificado: "es", sembrar: "es" });
  });

  it("avisos en inglés no cuentan: es el valor por defecto y no se distingue de no haber elegido", () => {
    expect(idiomaAlCargar({ servidor: null, hub: rtgPrefs("es"), tt: null, avisos: "en" })).toEqual({ unificado: "es", sembrar: "es" });
  });

  it("los avisos solos no deciden: sin copias de pantalla se sigue viendo inglés, y sembrar cambiaría la pantalla", () => {
    expect(idiomaAlCargar({ servidor: null, hub: null, tt: null, avisos: "es" })).toEqual({ unificado: null, sembrar: null });
  });

  it("con idioma en la base, los avisos dan igual", () => {
    expect(idiomaAlCargar({ servidor: "en", hub: rtgPrefs("en"), tt: "en", avisos: "es" })).toEqual({ unificado: "en", sembrar: null });
  });

  it("lo que no es «en» o «es» cuenta como nada, venga de donde venga", () => {
    expect(idiomaAlCargar({ servidor: "fr", hub: rtgPrefs("es"), tt: "" })).toEqual({ unificado: "es", sembrar: "es" });
    expect(rtgPrefs("xx")).toBeNull();
    expect(idiomaDeRtgPrefs("{roto")).toBeNull();
    expect(idiomaDeRtgPrefs(null)).toBeNull();
  });
});

describe("la carga entera, con la base falsa", () => {
  type Lectura = { data: { language?: unknown } | null; error: unknown };
  const SIN_FILA_DE_AVISOS: Lectura = { data: null, error: null };

  function prueba(base: Lectura, locales: { hub: unknown; tt: unknown }, uid: string | null = "u-1", avisos: Lectura = SIN_FILA_DE_AVISOS) {
    const aplicados: Idioma[] = [];
    const guardados: [string, Idioma][] = [];
    const leidos: string[] = [];
    const avisosLeidos: string[] = [];
    const corre = sincronizaIdiomaAlCargar({
      uid,
      ...locales,
      leerDeLaBase: async (id) => { leidos.push(id); return base; },
      leerAvisos: async (id) => { avisosLeidos.push(id); return avisos; },
      guardarEnLaBase: async (id, l) => { guardados.push([id, l]); },
      aplicar: (l) => { aplicados.push(l); },
    });
    return corre.then(() => ({ aplicados, guardados, leidos, avisosLeidos }));
  }

  it("idioma en la base: se aplica y no se vuelve a guardar", async () => {
    expect(await prueba({ data: { language: "es" }, error: null }, { hub: rtgPrefs("en"), tt: "en" }))
      .toEqual({ aplicados: ["es"], guardados: [], leidos: ["u-1"], avisosLeidos: [] });
  });

  it("base vacía y copias de acuerdo: se aplica y se siembra en la fila de ESA persona", async () => {
    expect(await prueba({ data: { language: null }, error: null }, { hub: rtgPrefs("es"), tt: "es" }))
      .toEqual({ aplicados: ["es"], guardados: [["u-1", "es"]], leidos: ["u-1"], avisosLeidos: ["u-1"] });
  });

  it("base vacía y copias en desacuerdo: ni se aplica ni se guarda", async () => {
    expect(await prueba({ data: { language: null }, error: null }, { hub: rtgPrefs("en"), tt: "es" }))
      .toEqual({ aplicados: [], guardados: [], leidos: ["u-1"], avisosLeidos: ["u-1"] });
  });

  it("si la lectura FALLA, no se decide nada: ni se aplica ni se siembra", async () => {
    // Es el caso de desplegar el código antes que la migración: la columna no existe y la lectura
    // da error. Sembrar ahí sería guardar un idioma a ciegas.
    expect(await prueba({ data: null, error: { message: "column profiles.language does not exist" } }, { hub: rtgPrefs("es"), tt: "es" }))
      .toEqual({ aplicados: [], guardados: [], leidos: ["u-1"], avisosLeidos: [] });
  });

  it("sin sesión no se pregunta a la base", async () => {
    expect(await prueba({ data: { language: "es" }, error: null }, { hub: rtgPrefs("es"), tt: "es" }, null))
      .toEqual({ aplicados: [], guardados: [], leidos: [], avisosLeidos: [] });
  });

  it("base vacía, equipo en inglés, avisos en español: ni se aplica ni se siembra", async () => {
    expect(await prueba({ data: { language: null }, error: null }, { hub: rtgPrefs("en"), tt: null }, "u-1", { data: { language: "es" }, error: null }))
      .toEqual({ aplicados: [], guardados: [], leidos: ["u-1"], avisosLeidos: ["u-1"] });
  });

  it("si leer los avisos FALLA, tampoco se decide", async () => {
    expect(await prueba({ data: { language: null }, error: null }, { hub: rtgPrefs("en"), tt: "en" }, "u-1", { data: null, error: { message: "permission denied" } }))
      .toEqual({ aplicados: [], guardados: [], leidos: ["u-1"], avisosLeidos: ["u-1"] });
  });

  it("sin fila de avisos (o sin acceso a fichaje), cuenta solo la pantalla", async () => {
    expect(await prueba({ data: { language: null }, error: null }, { hub: rtgPrefs("en"), tt: "en" }, "u-1", SIN_FILA_DE_AVISOS))
      .toEqual({ aplicados: ["en"], guardados: [["u-1", "en"]], leidos: ["u-1"], avisosLeidos: ["u-1"] });
  });
});

describe("Time Tracker sigue el idioma del hub sin recargar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("al recibir el aviso cambia su diccionario, y un aviso raro no lo toca", async () => {
    vi.resetModules();
    const ventana = new EventTarget();
    vi.stubGlobal("window", ventana);
    const tt = await import("./timetracker/i18n");
    expect(tt.getLang()).toBe("en"); // control: arranca en inglés sin copia local

    ventana.dispatchEvent(new CustomEvent(EVENTO_IDIOMA, { detail: "es" }));
    expect(tt.getLang()).toBe("es");
    expect(tt.t("shell.manager")).toBe("Gerente");

    ventana.dispatchEvent(new CustomEvent(EVENTO_IDIOMA, { detail: "fr" }));
    expect(tt.getLang()).toBe("es");
  });
});

// ---- Un solo sitio escribe el idioma ---------------------------------------------------------

function codigoDeSrc(dir = "src"): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return codigoDeSrc(ruta);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(nombre) && !/\.test\./.test(nombre) ? [ruta.split("\\").join("/")] : [];
  });
}

function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, "")))
    .join("\n");
}

describe("el idioma se escribe en un solo sitio", () => {
  const ficheros = codigoDeSrc().map((f) => ({ f, codigo: sinComentarios(readFileSync(f, "utf8")) }));

  it("solo el proveedor del hub guarda el idioma en la base", () => {
    // Cualquier `update(...)` cuyo objeto lleve `language`, aunque esté partido en varias líneas.
    const escriben = ficheros.filter(({ codigo }) => /\.update\(\s*\{[^}]*\blanguage\b/.test(codigo)).map(({ f }) => f);
    expect(escriben).toEqual(["src/lib/prefs.tsx"]);
  });

  it("solo el proveedor del hub escribe las copias locales del idioma", () => {
    // `KEY` a secas es un nombre corriente (el menú del ERP, el id del aparato): solo cuenta donde
    // `KEY` ES la clave del idioma. Sin esto la prueba contaba ficheros que guardan otra cosa.
    const escriben = ficheros
      .filter(({ codigo }) =>
        /localStorage\.setItem\(\s*(CLAVE_TT|["']tt_lang["']|["']rtg_prefs["'])/.test(codigo) ||
        (/localStorage\.setItem\(\s*KEY\b/.test(codigo) && /\bKEY\s*=\s*["'](rtg_prefs|tt_lang)["']/.test(codigo)))
      .map(({ f }) => f);
    expect(escriben).toEqual(["src/lib/prefs.tsx"]);
  });

  it("ninguna pantalla cambia el idioma de Time Tracker por su cuenta", () => {
    const importan = ficheros
      .filter(({ f }) => f !== "src/lib/timetracker/i18n.ts")
      .filter(({ codigo }) => /import\s*\{[^}]*\bsetLang\b[^}]*\}\s*from\s*["']@\/lib\/timetracker\/i18n["']/.test(codigo))
      .map(({ f }) => f);
    expect(importan).toEqual([]);
  });

  it("elegir un idioma lo guarda en la base, no solo en este equipo", () => {
    // El barrido de arriba no basta: la siembra de la carga también escribe en el mismo fichero, así
    // que un `setLang` que dejara de guardar lo seguiría dejando en verde. Se mira SU cuerpo.
    const prefs = sinComentarios(readFileSync("src/lib/prefs.tsx", "utf8"));
    const ini = prefs.indexOf("const setLang = useCallback(");
    const fin = prefs.indexOf("}, []);", ini);
    expect(ini).toBeGreaterThan(-1);
    const cuerpo = prefs.slice(ini, fin);
    expect(cuerpo).toMatch(/\.from\("profiles"\)\s*\.update\(\s*\{\s*language:\s*l\s*,?\s*\}\s*\)/);
    expect(cuerpo).toContain("copiaLocal(l)");
  });

  it("el diccionario de Time Tracker ya no guarda nada", () => {
    expect(sinComentarios(readFileSync("src/lib/timetracker/i18n.ts", "utf8"))).not.toMatch(/localStorage\.setItem/);
  });

  it("el selector aparte del idioma de los avisos ya no existe", () => {
    for (const { f, codigo } of ficheros) {
      expect(codigo, f).not.toMatch(/NotificationLanguage|getMyLanguage|clock-in\/actions\/account/);
    }
  });

  it("el proveedor lee los avisos de la vista de fichaje, la que usa el servidor", () => {
    const prefs = sinComentarios(readFileSync("src/lib/prefs.tsx", "utf8"));
    expect(prefs).toMatch(/leerAvisos:[\s\S]*?\.schema\("clockin"\)\s*\.from\("profiles"\)\s*\.select\("language"\)/);
  });

  it("Mi perfil elige el idioma con el mismo setLang que todos", () => {
    const perfil = sinComentarios(readFileSync("src/components/profile/ProfileView.tsx", "utf8"));
    expect(perfil).toContain('setLang("en")');
    expect(perfil).toContain('setLang("es")');
  });
});

// ---- La migración 112 ------------------------------------------------------------------------

describe("112_profile_language.sql", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
  const sql = leer("supabase/migrations/112_profile_language.sql");
  const ejecutable = sinComentarios(sql.replace(/^--.*$/gm, ""));
  const vistaDe = (texto: string) => {
    const ini = texto.indexOf("create or replace view clockin.profiles");
    const fin = texto.indexOf("join clockin.employee_settings es on es.id = p.id;", ini);
    if (ini < 0 || fin < 0) throw new Error("no está la vista");
    return texto.slice(ini, fin);
  };

  it("la columna: idempotente, sin valor por defecto, y solo «en» o «es»", () => {
    expect(ejecutable).toContain("add column if not exists language text;");
    expect(ejecutable).not.toMatch(/language\s+text\s+(not\s+null|default)/i);
    expect(ejecutable).toMatch(/if not exists \(\s*select 1 from pg_constraint/);
    expect(ejecutable).toContain("check (language in ('en', 'es'))");
  });

  it("no rellena a nadie: el idioma lo siembra el navegador con lo que ya ve cada uno", () => {
    expect(ejecutable).not.toMatch(/\bupdate\s+public\.profiles\b/i);
    expect(ejecutable).not.toMatch(/\binsert\s+into\s+public\.profiles\b/i);
  });

  it("la vista de fichaje lee primero el idioma único y después el viejo", () => {
    expect(vistaDe(sql)).toContain("coalesce(p.language, es.language, 'en') as language,");
  });

  it("y es la vista vigente de la 089 con esa línea cambiada, y ninguna más", () => {
    // `create or replace view` la reemplaza entera: lo que no se copie, se pierde.
    const la089 = vistaDe(leer("supabase/migrations/089_store_manager.sql"));
    const vuelta = vistaDe(sql).split("coalesce(p.language, es.language, 'en') as language,").join("coalesce(es.language, 'en') as language,");
    expect(vuelta).toBe(la089);
    expect(vistaDe(sql)).toContain("with (security_invoker = on) as");
  });

  it("no toca políticas, guards ni el trigger de la vista", () => {
    expect(ejecutable).not.toMatch(/create\s+policy|drop\s+policy/i);
    expect(ejecutable).not.toMatch(/function\s+public\.guard_/i);
    expect(ejecutable).not.toMatch(/clockin\.profiles_update|create\s+trigger/i);
  });

  it("se auto-registra en el ledger y no lleva el marcador sin numerar", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain("112_profile_language.sql");
    expect(sql).not.toContain("D-" + "NEXT");
  });
});
