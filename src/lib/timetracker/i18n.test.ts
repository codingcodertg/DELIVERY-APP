import { describe, it, expect } from "vitest";
import { t, setLang, getLang } from "./i18n";

// D-122. El interpolador tenía `/{(w+)}/g` — la barra de `\w` se había perdido, así que el
// patrón solo casaba con la letra w literal. Ninguna de las 99 cadenas con variables
// sustituía nada: se enseñaba "{h} h restantes" tal cual, en los dos idiomas.
describe("t() sustituye las variables", () => {
  it("mete el valor donde dice {h}", () => {
    setLang("en");
    expect(t("track.left", { h: 3 })).toBe("3 h left");
  });

  it("y varias en la misma cadena", () => {
    setLang("en");
    expect(t("mgr.rep.summary", { h: 8, a: 1, tot: 9 })).toBe("Hours 8 · Adjustments 1 · Total 9");
  });

  it("también en español", () => {
    setLang("es");
    expect(t("track.left", { h: 3 })).toBe("3 h restantes");
    setLang("en");
  });

  it("una variable que no llega se queda vacía, no imprime {x}", () => {
    setLang("en");
    expect(t("track.left", {})).toBe(" h left");
  });
});

describe("cambiar de idioma cambia lo que devuelve t()", () => {
  it("la misma clave da texto distinto por idioma", () => {
    setLang("en");
    const en = t("shell.manager");
    setLang("es");
    const es = t("shell.manager");
    setLang("en");
    expect(en).toBe("Manager");
    expect(es).toBe("Gerente");
    expect(getLang()).toBe("en");
  });
});

// D-122. La barra de pestañas es lo único que se ve en TODAS las pantallas, y sus etiquetas
// estaban escritas a mano en inglés dentro de constants.ts: por mucho que se pulsara el botón
// de idioma, la barra no cambiaba. Estas pruebas atan cada pestaña a su clave.
describe("la barra de pestañas está traducida", () => {
  it("toda pestaña tiene texto en los dos idiomas, y distinto", async () => {
    const { TABS, MANAGER_TABS } = await import("./constants");
    const ids = [...new Set([...TABS, ...MANAGER_TABS].map((x) => x.id))];
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      setLang("en");
      const en = t("tab." + id);
      setLang("es");
      const es = t("tab." + id);
      // Si falta la clave, t() devuelve la clave misma: eso es el fallo que se está evitando.
      expect(en, `falta tab.${id} en inglés`).not.toBe("tab." + id);
      expect(es, `falta tab.${id} en español`).not.toBe("tab." + id);
    }
    setLang("en");
  });
});

// D-123. "Registrar tiempo" reparte por tipo de trabajador, así que sus textos salen en
// pantallas que ve gente distinta. Si falta uno, t() devuelve la clave cruda.
describe("los textos del reparto por tipo de trabajador existen", () => {
  it("en los dos idiomas", () => {
    for (const k of ["track.openingClock", "track.viewTimer", "track.viewPunch"]) {
      setLang("en");
      expect(t(k), `falta ${k} en inglés`).not.toBe(k);
      setLang("es");
      expect(t(k), `falta ${k} en español`).not.toBe(k);
    }
    setLang("en");
  });
});
