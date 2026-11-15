import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { RUTAS_CON_MARCA } from "@/lib/pantallas-protegidas";

// `desktop/` es CommonJS y vive fuera de `src`: se carga con `require` (igual que `desktop-origins.test.ts`).
const requerir = createRequire(import.meta.url);
const { RUTAS_PROTEGIDAS, estaProtegida } = requerir("../../desktop/protegidas.js") as {
  RUTAS_PROTEGIDAS: readonly string[];
  estaProtegida: (url: string) => boolean;
};

const BASE = "https://rtg-hub.vercel.app";

describe("ventana de escritorio: pantallas protegidas contra capturas", () => {
  it("la lista de la ventana es la misma que la de la web (pantallas-protegidas.ts)", () => {
    expect([...RUTAS_PROTEGIDAS].sort()).toEqual([...RUTAS_CON_MARCA].sort());
  });

  it("protege las cuatro apps sensibles, también en sus subrutas", () => {
    for (const r of ["/estimator", "/recruiting", "/erp", "/customers"]) {
      expect(estaProtegida(BASE + r)).toBe(true);
      expect(estaProtegida(BASE + r + "/algo/mas?x=1")).toBe(true);
    }
  });

  it("no protege el hub, el cronómetro ni el resto de módulos", () => {
    for (const r of ["/home", "/timetracker", "/", "/login", "/orders", "/leads"]) {
      expect(estaProtegida(BASE + r)).toBe(false);
    }
  });

  it("compara por segmento: un prefijo parecido no cuenta", () => {
    expect(estaProtegida(BASE + "/erpista")).toBe(false);
    expect(estaProtegida(BASE + "/customersx")).toBe(false);
  });

  it("una URL que no se puede leer no se protege", () => {
    expect(estaProtegida("no es una url")).toBe(false);
  });
});
