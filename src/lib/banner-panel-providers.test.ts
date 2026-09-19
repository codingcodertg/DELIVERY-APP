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

const panel = sinComentarios(leer("src/components/SwitchUserPanel.tsx"));
const banner = sinComentarios(leer("src/components/ImpersonationBanner.tsx"));
const raiz = sinComentarios(leer("src/app/layout.tsx"));

/** Los hooks que lanzan si no tienen su proveedor encima, y el proveedor que piden. */
const HOOKS: Record<string, string> = { usePrefs: "PrefsProvider", useConfirm: "ConfirmProvider", useData: "DataProvider" };

describe("el panel que se monta dentro del banner tiene encima lo que necesita", () => {
  it("control: el banner sigue fuera de PrefsProvider en el layout raíz (si entra, esta prueba sobra)", () => {
    expect(raiz.indexOf("<ImpersonationBanner")).toBeGreaterThan(-1);
    expect(raiz.indexOf("<ImpersonationBanner")).toBeLessThan(raiz.indexOf("<PrefsProvider"));
  });

  it("control: el panel usa hooks que exigen proveedor", () => {
    expect(Object.keys(HOOKS).filter((h) => new RegExp(`\\b${h}\\(`).test(panel)).sort()).toEqual(["useConfirm", "usePrefs"]);
  });

  it("y el banner le pone alrededor CADA proveedor que esos hooks piden", () => {
    const i = banner.indexOf("<SwitchUserPanel");
    expect(i).toBeGreaterThan(-1);
    for (const hook of Object.keys(HOOKS).filter((h) => new RegExp(`\\b${h}\\(`).test(panel))) {
      const prov = HOOKS[hook];
      const abre = banner.lastIndexOf(`<${prov}>`, i), cierra = banner.indexOf(`</${prov}>`, i);
      expect(abre, `${prov} abre antes del panel (lo pide ${hook})`).toBeGreaterThan(-1);
      expect(cierra, `${prov} cierra después del panel`).toBeGreaterThan(i);
      // y no se cerró antes de llegar al panel
      expect(banner.slice(abre, i)).not.toContain(`</${prov}>`);
    }
  });

  it("ConfirmProvider va DENTRO de PrefsProvider: él mismo usa usePrefs", () => {
    const i = banner.indexOf("<SwitchUserPanel");
    expect(banner.lastIndexOf("<PrefsProvider>", i)).toBeLessThan(banner.lastIndexOf("<ConfirmProvider>", i));
  });

  it("el propio banner no usa ninguno de esos hooks: por eso puede vivir fuera", () => {
    for (const hook of Object.keys(HOOKS)) expect(new RegExp(`\\b${hook}\\(`).test(banner), hook).toBe(false);
  });
});

// D-NEXT: el panel vuelve a montarse TAMBIÉN en la barra de Entregas. Mismo examen para ese sitio: la barra vive en el
// layout de `(app)`, que tiene los tres proveedores encima — y aquí se fija, para que mover la barra lo haga saltar.
describe("el panel montado en la barra de Entregas también tiene encima lo que necesita", () => {
  const barra = sinComentarios(leer("src/components/TopBar.tsx"));
  const app = sinComentarios(leer("src/app/(app)/layout.tsx"));

  it("la barra monta el panel, y solo se monta en el layout de (app)", () => {
    expect(barra.indexOf("<SwitchUserPanel")).toBeGreaterThan(-1);
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

  it("dos entradas al MISMO panel, y nada más: el hub, la barra de Entregas y el banner (que es la de dentro)", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const tsx: string[] = [];
    const recorre = (d: string) => { for (const f of readdirSync(d)) { const r = `${d}/${f}`; if (statSync(r).isDirectory()) recorre(r); else if (f.endsWith(".tsx")) tsx.push(r); } };
    recorre("src");
    expect(tsx.filter((f) => sinComentarios(leer(f)).includes("<SwitchUserPanel")).sort()).toEqual(
      ["src/app/home/switch-user/page.tsx", "src/components/ImpersonationBanner.tsx", "src/components/TopBar.tsx"]);
  });
});
