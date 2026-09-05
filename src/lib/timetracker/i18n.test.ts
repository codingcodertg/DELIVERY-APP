import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DICT, t, setLang, getLang } from "./i18n";

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

// D-187. El horario se tradujo entero y sus tres formularios pasaron a ventana. Como este repo
// no dibuja pantallas en las pruebas, la única red automática posible es esta: las claves se
// sacan DEL FUENTE de los componentes (no del diccionario, que compararlo consigo mismo no
// prueba nada) y se exige que cada una exista en los dos idiomas. Una clave inventada o una
// errata en un t("...") revienta aquí.
//
// Se mira DICT directo y no t(): t() cae al inglés cuando falta el español
// (`DICT[lang][key] ?? DICT.en[key] ?? key`), así que "t() no devuelve la clave" en español
// solo demuestra que existe en ALGÚN idioma, y lo que se vigila es que exista en los dos.
describe("las claves que usan los componentes de Asignaciones y Nómina existen en los dos idiomas", () => {
  const ficheros = [
    "src/components/timetracker/ScheduleWeek.tsx",
    "src/components/timetracker/AssignmentsPanel.tsx",
    "src/components/timetracker/AssignmentsTabs.tsx",
    "src/components/timetracker/Modal.tsx",
    // D-190 (Nómina): la cabecera que era "Period", la vista única y la marca `revisar`.
    "src/components/timetracker/PayrollResumen.tsx",
    "src/components/timetracker/PayrollTabs.tsx",
    "src/components/timetracker/PayrollTimesheets.tsx",
    "src/components/timetracker/ManagerReports.tsx",
    // D-194 (Auditoría): el selector de vistas y las capturas de escritorio que eran Team Diary.
    "src/components/timetracker/AuditTabs.tsx",
    "src/components/timetracker/TeamDiary.tsx",
  ];

  function clavesDe(ruta: string): string[] {
    const src = readFileSync(join(process.cwd(), ruta), "utf8");
    const fijas = [...src.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]);
    // Claves construidas, del tipo t(`mgr.sch.dow.${i}`): se toma el prefijo y se exige que
    // exista el juego completo. Hoy solo hay una, los siete días.
    const dinamicas = [...src.matchAll(/\bt\(`([^`$]+)\$\{/g)].flatMap((m) =>
      m[1].endsWith("dow.") ? [0, 1, 2, 3, 4, 5, 6].map((i) => m[1] + i) : [m[1] + "__desconocida__"]);
    return [...new Set([...fijas, ...dinamicas])];
  }

  for (const ruta of ficheros) {
    it(`${ruta.split("/").pop()} — cada t("…") tiene en y es`, () => {
      const claves = clavesDe(ruta);
      expect(claves.length, `${ruta} no usa t(): o se destradujo o cambió la forma de llamarlo`).toBeGreaterThan(0);
      for (const k of claves) {
        expect(DICT.en[k], `falta ${k} en inglés (usada en ${ruta})`).toBeDefined();
        expect(DICT.es[k], `falta ${k} en español (usada en ${ruta})`).toBeDefined();
      }
    });
  }

  it("ScheduleWeek cubre el inventario de textos que tenía en inglés a pelo", () => {
    // La lista es la que el auditor levantó sobre main (6de1948) antes de traducir: si alguien
    // vuelve a escribir uno de estos a mano, la clave deja de usarse y esto lo nota.
    const usadas = new Set(clavesDe("src/components/timetracker/ScheduleWeek.tsx"));
    for (const k of [
      "mgr.sch.prev", "mgr.sch.next", "mgr.sch.thisWeek",
      "mgr.sch.addTitle", "mgr.sch.person", "mgr.sch.site", "mgr.sch.days", "mgr.sch.from", "mgr.sch.to", "mgr.sch.lunch",
      "mgr.sch.clockTitle", "mgr.sch.reason", "mgr.sch.reasonPh",
      "mgr.sch.empty", "mgr.sch.delConfirm",
      "mgr.sch.clockedIn", "mgr.sch.clockedOut", "mgr.sch.deleted", "mgr.sch.applied",
      "mgr.sch.errSave", "mgr.sch.errRead", "mgr.sch.noStore", "mgr.sch.unknown",
      "mgr.sch.dow.0", "mgr.sch.dow.6",
    ]) {
      expect(usadas.has(k), `ScheduleWeek ya no usa ${k}: ¿volvió el texto a mano?`).toBe(true);
    }
  });
});
