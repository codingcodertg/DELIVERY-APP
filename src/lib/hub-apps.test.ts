import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { veAppsParaInstalar } from "./hub-apps";
import { ROLE_ORDER } from "./constants";
import type { Profile } from "./types";

// «Apps para instalar» en el hub, solo para el admin (D-NEXT). Dos mitades, y hacen falta las
// dos: la decisión, alimentada con el mismo `me` que recibe la pantalla, y que la pantalla
// efectivamente la use para envolver la sección entera. Sin la segunda, la primera protegería
// una función que el hub podría dejar de llamar.

const me = (role: Profile["role"]): Profile =>
  ({ id: "u-1", full_name: "Persona", username: null, role, store: null } as unknown as Profile);

describe("quién ve las apps para instalar", () => {
  it("recorre los roles de verdad (control)", () => {
    expect(ROLE_ORDER.length).toBeGreaterThanOrEqual(5);
    expect(ROLE_ORDER).toContain("admin");
  });

  it("el admin sí", () => {
    expect(veAppsParaInstalar(me("admin"))).toBe(true);
  });

  it("cualquier otro rol, no", () => {
    for (const role of ROLE_ORDER.filter((r) => r !== "admin")) {
      expect(veAppsParaInstalar(me(role)), role).toBe(false);
    }
  });

  it("sin perfil, tampoco", () => {
    expect(veAppsParaInstalar(null)).toBe(false);
    expect(veAppsParaInstalar(undefined)).toBe(false);
  });
});

describe("el hub envuelve la sección entera con esa decisión", () => {
  const src = readFileSync("src/components/HomeSelector.tsx", "utf8").split("\r\n").join("\n");

  it("la sección sigue existiendo (control)", () => {
    expect(src).toContain('<details className="hub-apps">');
  });

  it("y solo se pinta si `veAppsParaInstalar(me)`: ni título plegado ni contador para el resto", () => {
    // La condición va justo delante del `<details>`, que contiene el título y el contador. Si
    // envolviera solo la lista de dentro, el resto seguiría viendo «Apps para instalar 3».
    expect(src).toMatch(/\{veAppsParaInstalar\(me\) && \(\s*<details className="hub-apps">/);
  });
});
