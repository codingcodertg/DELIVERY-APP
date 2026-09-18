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
