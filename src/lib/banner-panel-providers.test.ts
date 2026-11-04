import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// D-321: el dueño pulsó «Switch to another user» en el banner de impersonación y vio «Something went
// wrong». El banner vive en el layout raíz, FUERA de `PrefsProvider` y sin `ConfirmProvider`; D-307 montó
// dentro `SwitchUserPanel`, que llama a `usePrefs()` y `useConfirm()`, y esos hooks lanzan sin su proveedor.
// Compilaba, las pruebas de texto pasaban, y reventaba al primer clic.
//
// No hay render en este repo (vitest corre en `node`), así que se fija la ESTRUCTURA: qué hooks con
// proveedor usa el panel, y que el banner se los pone alrededor.
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// D-NEXT: la franja se fue y el panel de saltar se monta en la burbuja general (dentro de `PrefsProvider`). El examen es
// el mismo: el panel de saltar lleva encima `PrefsConIdioma` (el idioma del ADMIN, D-516: el `PrefsProvider` de arriba
// habla el de la persona en la que se entró) y `ConfirmProvider`.
const panel = sinComentarios(leer("src/components/SwitchUserPanel.tsx"));
const burbujaGeneral = sinComentarios(leer("src/components/BotonGeneral.tsx"));
const raiz = sinComentarios(leer("src/app/layout.tsx"));
// El panel de SALTAR es el que va en modo «saltar»; el otro (`modo` por defecto) es el del admin real.
const iSaltar = burbujaGeneral.indexOf('modo="saltar"');
const banner = burbujaGeneral;

/** Los hooks que lanzan si no tienen su proveedor encima, y el proveedor que piden. */
const HOOKS: Record<string, string> = { usePrefs: "PrefsProvider", useConfirm: "ConfirmProvider", useData: "DataProvider" };
/** En el panel de saltar, `usePrefs` lo sirve `PrefsConIdioma` (D-516): el MISMO contexto, con el idioma del admin. */
const EN_EL_BANNER: Record<string, string> = { ...HOOKS, usePrefs: "PrefsConIdioma" };

describe("el panel de saltar (dentro de una suplantación) tiene encima lo que necesita", () => {
  it("control: ya no hay franja en el layout raíz, y la burbuja va dentro de PrefsProvider", () => {
    expect(raiz).not.toContain("<ImpersonationBanner");
    expect(raiz.indexOf("<BotonGeneral />")).toBeGreaterThan(raiz.indexOf("<PrefsProvider"));
  });

  it("control: el panel usa hooks que exigen proveedor", () => {
    expect(Object.keys(HOOKS).filter((h) => new RegExp(`\\b${h}\\(`).test(panel)).sort()).toEqual(["useConfirm", "usePrefs"]);
  });

  it("y la burbuja le pone alrededor CADA proveedor que esos hooks piden", () => {
    const i = iSaltar;
    expect(i).toBeGreaterThan(-1);
    for (const hook of Object.keys(HOOKS).filter((h) => new RegExp(`\\b${h}\\(`).test(panel))) {
      const prov = EN_EL_BANNER[hook];
      const abre = banner.lastIndexOf(`<${prov}`, i), cierra = banner.indexOf(`</${prov}>`, i);
      expect(abre, `${prov} abre antes del panel (lo pide ${hook})`).toBeGreaterThan(-1);
      expect(cierra, `${prov} cierra después del panel`).toBeGreaterThan(i);
      expect(banner.slice(abre, i)).not.toContain(`</${prov}>`);
    }
  });

  it("ConfirmProvider va DENTRO de PrefsConIdioma, con el idioma del admin: él mismo usa usePrefs", () => {
    const i = iSaltar;
    expect(banner.lastIndexOf("<PrefsConIdioma lang={sup.estado.idioma}>", i)).toBeGreaterThan(-1);
    expect(banner.lastIndexOf("<PrefsConIdioma lang={sup.estado.idioma}>", i)).toBeLessThan(banner.lastIndexOf("<ConfirmProvider>", i));
  });
});

// D-333: el panel vuelve a montarse TAMBIÉN en la barra de Entregas. Mismo examen para ese sitio: la barra vive en el
// layout de `(app)`, que tiene los tres proveedores encima — y aquí se fija, para que mover la barra lo haga saltar.
describe("el panel montado en la barra de Entregas también tiene encima lo que necesita", () => {
  const barra = sinComentarios(leer("src/components/TopBar.tsx"));
  const app = sinComentarios(leer("src/app/(app)/layout.tsx"));

  it("la barra ya no monta el panel (D-623: vive en la burbuja general, con su propio ConfirmProvider); la barra sigue solo en (app)", () => {
    expect(barra.indexOf("<SwitchUserPanel")).toBe(-1);
    const burbuja = sinComentarios(leer("src/components/BotonGeneral.tsx"));
    const i = burbuja.indexOf("<SwitchUserPanel");
    expect(i).toBeGreaterThan(-1);
    expect(burbuja.lastIndexOf("<ConfirmProvider>", i)).toBeGreaterThan(-1);
    expect(burbuja.indexOf("</ConfirmProvider>", i)).toBeGreaterThan(i);
    expect(raiz.indexOf("<BotonGeneral />")).toBeGreaterThan(raiz.indexOf("<PrefsProvider"));
    expect(raiz.indexOf("<BotonGeneral />")).toBeLessThan(raiz.indexOf("</PrefsProvider>"));
    expect(app.indexOf("<TopBar")).toBeGreaterThan(-1);
    expect(raiz).not.toContain("<TopBar");
  });

  it("cada proveedor que piden los hooks del panel —y los de la propia barra— envuelve a la barra", () => {
    const usados = Object.keys(HOOKS).filter((h) => new RegExp(`\\b${h}\\(`).test(panel) || new RegExp(`\\b${h}\\(`).test(barra));
    expect(usados.sort()).toEqual(["useConfirm", "useData", "usePrefs"]);
    // Prefs está en el layout raíz alrededor de los hijos; Confirm y Data, en el de (app) alrededor de la barra.
    expect(raiz.indexOf("<PrefsProvider")).toBeGreaterThan(-1);
    expect(raiz.indexOf("<PrefsProvider")).toBeLessThan(raiz.indexOf("{children}"));
    expect(raiz.indexOf("{children}")).toBeLessThan(raiz.indexOf("</PrefsProvider>"));
    const i = app.lastIndexOf("<TopBar");
    for (const prov of ["ConfirmProvider", "DataProvider"]) {
      const abre = app.lastIndexOf(`<${prov}`, i), cierra = app.indexOf(`</${prov}>`, i);
      expect(abre, `${prov} abre antes de la barra`).toBeGreaterThan(-1);
      expect(cierra, `${prov} cierra después de la barra`).toBeGreaterThan(i);
      expect(app.slice(abre, i)).not.toContain(`</${prov}>`);
    }
  });

  it("dos entradas al MISMO panel, y nada más: el hub y la burbuja general (que monta también el de saltar desde D-NEXT)", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const tsx: string[] = [];
    const recorre = (d: string) => { for (const f of readdirSync(d)) { const r = `${d}/${f}`; if (statSync(r).isDirectory()) recorre(r); else if (f.endsWith(".tsx")) tsx.push(r); } };
    recorre("src");
    expect(tsx.filter((f) => sinComentarios(leer(f)).includes("<SwitchUserPanel")).sort()).toEqual(
      ["src/app/home/switch-user/page.tsx", "src/components/BotonGeneral.tsx"]);
  });
});
