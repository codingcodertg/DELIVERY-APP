import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { etapasEnIdioma, etiquetaDeEtapa } from "./etapas-idioma";
import { DEFAULT_STAGES } from "./constants";

describe("etiquetaDeEtapa", () => {
  it("traduce las seis etapas de fábrica al español", () => {
    expect(DEFAULT_STAGES.map((s) => etiquetaDeEtapa(s, "es"))).toEqual([
      "Registrado", "Entrevista telefónica", "En espera", "Entrevista presencial", "Contratado", "Descartado",
    ]);
  });
  it("en inglés deja el nombre guardado", () => {
    expect(DEFAULT_STAGES.map((s) => etiquetaDeEtapa(s, "en"))).toEqual(DEFAULT_STAGES.map((s) => s.label));
  });
  it("respeta un nombre que el admin cambió y una etapa propia", () => {
    expect(etiquetaDeEtapa({ key: "phone", label: "Llamada inicial" }, "es")).toBe("Llamada inicial");
    expect(etiquetaDeEtapa({ key: "assessment_1", label: "Assessment" }, "es")).toBe("Assessment");
  });
  it("tolera mayúsculas y guiones del nombre de fábrica", () => {
    expect(etiquetaDeEtapa({ key: "inperson", label: "In-Person interview " }, "es")).toBe("Entrevista presencial");
  });
  it("etapasEnIdioma no toca el resto de la etapa", () => {
    const es = etapasEnIdioma(DEFAULT_STAGES, "es");
    expect(es.map(({ label: _l, ...r }) => r)).toEqual(DEFAULT_STAGES.map(({ label: _l, ...r }) => r));
    expect(etapasEnIdioma(DEFAULT_STAGES, "en")).toBe(DEFAULT_STAGES);
  });
});

// Puerta del mecanismo (D-NEXT): el idioma del hub tiene que llegar a lo que pinta RRHH.
const raiz = join(__dirname, "..", "..");
const proveedor = readFileSync(join(raiz, "lib", "recruiting-data-provider.tsx"), "utf8");

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? ficheros(p) : /\.tsx$/.test(n) ? [p] : [];
  });
}

describe("puerta: RRHH habla el idioma del hub", () => {
  it("el proveedor de datos entrega las etapas traducidas como `stages`", () => {
    expect(proveedor).toMatch(/stages:\s*stagesEnIdioma,/);
    expect(proveedor).toMatch(/etapasEnIdioma\(stages,\s*lang\)/);
  });
  it("ningún aviso del proveedor es un texto fijo en inglés", () => {
    // notify("Texto…") o notify(`Texto…`) sin pasar por tr(); "Error: " + mensaje de la base sí vale.
    const fijos = [...proveedor.matchAll(/notify\(\s*(["`])([^"`]*)\1/g)]
      .map((m) => m[2])
      .filter((txt) => /[A-Za-z]{3,}/.test(txt) && !/^(Error|RingCentral)[: ✓]/.test(txt));
    expect(fijos).toEqual([]);
  });
  it("solo Ajustes lee las etapas sin traducir, y ninguna pantalla de RRHH monta su propio idioma", () => {
    const pantallas = [...ficheros(join(raiz, "app", "recruiting")), ...ficheros(join(raiz, "components", "recruiting"))];
    expect(pantallas.length).toBeGreaterThan(10);
    const usanGuardadas = pantallas.filter((p) => readFileSync(p, "utf8").includes("stagesGuardadas")).map((p) => p.replace(/\\/g, "/"));
    expect(usanGuardadas.length).toBe(1);
    expect(usanGuardadas[0]).toMatch(/recruiting\/\(recruiting\)\/settings\/page\.tsx$/);
    for (const p of pantallas) {
      const src = readFileSync(p, "utf8");
      expect(src.includes("PrefsProvider") || src.includes("PrefsConIdioma"), p).toBe(false);
    }
  });
});
