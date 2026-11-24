import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ETAPAS } from "./reglas";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const css = leer("src/app/leads/leads.css");
const tsx = leer("src/app/leads/Leads.tsx");

describe("colores de etapa en Leads", () => {
  it("cada etapa tiene su token de fondo y su token de tinta en leads.css", () => {
    for (const e of ETAPAS) {
      expect(css).toMatch(new RegExp(`--etapa-${e}:\\s*#[0-9a-fA-F]{3,8};`));
      expect(css).toMatch(new RegExp(`--etapa-${e}-tinta:\\s*#[0-9a-fA-F]{3,8};`));
    }
  });

  it("el tema oscuro redefine --etapa-new (negro sobre fondo oscuro no se vería)", () => {
    expect(css).toMatch(/:root\[data-theme="dark"\] \.leads-app\s*\{[^}]*--etapa-new:\s*#[0-9a-fA-F]{3,8};/);
  });

  it("los chips de filtro, la pastilla de la tarjeta y el selector de nota pintan el icono de la etapa", () => {
    expect(tsx).toContain("{etapaIcono(e)} {etapaLabel(e, lang)}");
    expect(tsx).toContain("{etapaIcono(a)} {etapaLabel(a, lang)}");
    expect(tsx).toContain("data-pildora-etapa={e}");
    expect(tsx).toContain("data-pildora-etapa={a}");
    expect(tsx).toContain("data-etapa={e}");
  });
});
