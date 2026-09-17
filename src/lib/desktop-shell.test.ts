import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { enAppDeEscritorio } from "./desktop-shell";

/** El botón ⟳ de recargar, solo dentro de una app de escritorio (D-280). */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

describe("¿corre dentro de una app de escritorio?", () => {
  it("Time Tracker: por el puente que inyecta su preload", () => {
    expect(enAppDeEscritorio({ ttDesktop: { isDesktop: true }, navigator: { userAgent: CHROME } })).toBe(true);
  });

  it("RTG Hub: por el token de su agente de usuario, y también el nombre viejo (D-225)", () => {
    expect(enAppDeEscritorio({ navigator: { userAgent: `${CHROME} RTGHub/1.4.0` } })).toBe(true);
    expect(enAppDeEscritorio({ navigator: { userAgent: `${CHROME} RDZHub/1.1.0` } })).toBe(true);
  });

  it("un navegador normal, no", () => {
    expect(enAppDeEscritorio({ navigator: { userAgent: CHROME } })).toBe(false);
    expect(enAppDeEscritorio({ ttDesktop: null, navigator: { userAgent: "" } })).toBe(false);
    expect(enAppDeEscritorio({})).toBe(false);
    expect(enAppDeEscritorio(null)).toBe(false);
  });

  it("la cáscara Android tampoco: es un teléfono, y ahí se recarga tirando de la pantalla", () => {
    expect(enAppDeEscritorio({ navigator: { userAgent: `${CHROME} RDZDeliveries/34` } })).toBe(false);
  });

  it("un puente sin `isDesktop` no cuenta", () => {
    expect(enAppDeEscritorio({ ttDesktop: {}, navigator: { userAgent: CHROME } })).toBe(false);
  });
});

describe("el botón", () => {
  const boton = leer("src/components/BotonRecargar.tsx");

  it("no se pinta fuera del escritorio, y lo pregunta tras montar", () => {
    expect(boton).toContain("useEffect(() => { setEnEscritorio(enAppDeEscritorio(window)); }, []);");
    expect(boton).toContain("if (!enEscritorio) return null;");
  });

  it("recarga la página, y dice lo que hace también para un lector de pantalla", () => {
    expect(boton).toContain("onClick={() => window.location.reload()}");
    expect(boton).toContain("title={titulo}");
    expect(boton).toContain("aria-label={titulo}");
  });
});

describe("dónde está", () => {
  it("en la barra de Entregas, con su texto en los dos idiomas", () => {
    const barra = leer("src/components/TopBar.tsx");
    expect(barra).toContain('<BotonRecargar titulo={t("Reload the app", "Recargar la app")} />');
  });

  it("en la barra de Time Tracker, con la clave de su diccionario", () => {
    const barra = leer("src/components/timetracker/TopBar.tsx");
    expect(barra).toContain('<BotonRecargar titulo={t("shell.reload")} className="btn-ghost btn-sm tt-recargar" />');
  });

  it("y esa clave existe en los dos idiomas, distinta en cada uno", () => {
    const dic = leer("src/lib/timetracker/i18n.ts");
    expect(dic).toContain("'shell.reload': 'Reload the app',");
    expect(dic).toContain("'shell.reload': 'Recargar la app',");
  });

  it("la clase de Time Tracker tiene su regla, dentro del módulo", () => {
    expect(leer("src/app/timetracker/timetracker.css")).toContain(".timetracker-module .topbar .tt-recargar{");
  });
});
