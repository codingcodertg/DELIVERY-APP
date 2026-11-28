import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extensionDeLaPersona } from "./mi-extension";

const filas = [{ extension_number: "441", name: "Ernesto Castillo" }, { extension_number: "450", name: "Julio  Jijón" }];

describe("D-1212 · RingCentral extension of the driver", () => {
  it("matches by full name, ignoring accents, case and spaces", () => {
    expect(extensionDeLaPersona("Ernesto Castillo", filas)).toBe("441");
    expect(extensionDeLaPersona("julio jijon", filas)).toBe("450");
    expect(extensionDeLaPersona("Maximo Garza", filas)).toBeNull();
    expect(extensionDeLaPersona("", filas)).toBeNull();
  });
  it("the driver screen shows ☎️ RingCentral only with an extension, using the rcapp link", () => {
    const modal = readFileSync(join(__dirname, "..", "..", "components", "OrderModal.tsx"), "utf8");
    expect(modal).toContain('fetch("/api/ringcentral/mi-extension")');
    expect(modal).toContain("{miExtension && (");
    expect(modal).toContain("href={rcCall(phone)}");
  });
});
