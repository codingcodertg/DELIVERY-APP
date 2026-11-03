import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { conQueEntra } from "./employee-file";

/** D-809: en «Cuenta del hub» del expediente sale con qué entra la persona: su usuario, o su correo. */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");

describe("conQueEntra", () => {
  it("con usuario: solo el usuario, sin el dominio sintético", () => {
    expect(conQueEntra("maximo@users.rdztilegroup.net")).toBe("maximo");
    expect(conQueEntra(" Maximo.Garza@USERS.rdztilegroup.net ")).toBe("maximo.garza");
  });
  it("con correo: el correo, en minúsculas; sin nada, null", () => {
    expect(conQueEntra("Ana@Gmail.com")).toBe("ana@gmail.com");
    expect(conQueEntra("")).toBeNull();
    expect(conQueEntra(null)).toBeNull();
  });
});

describe("dónde sale", () => {
  it("el servidor lo manda con los hechos de la cuenta", () => {
    expect(leer("src/app/recruiting/actions/hr.ts")).toContain("inicio: conQueEntra(email),");
  });
  it("la ficha lo pinta en «Cuenta del hub», con su rótulo según cómo entra", () => {
    const src = leer("src/app/recruiting/(recruiting)/employees/page.tsx");
    expect(src).toContain('{hechos?.inicio && ( <span data-dato="inicio-de-sesion"> {cuenta.acceso === "usuario" ? t("Username", "Usuario") : t("Email", "Correo")}: <b>{hechos.inicio}</b>');
  });
});
