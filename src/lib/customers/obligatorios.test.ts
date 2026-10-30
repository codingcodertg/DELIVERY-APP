import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { faltanEnElAlta } from "./obligatorios";
import { contactoVacio } from "./contactos";

/** Lo obligatorio en el alta de cliente: términos, nombre y cargo del contacto, y teléfono o correo (D-772). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const lleno = { ...contactoVacio(), name: "Omar", title: "Owner", phones: ["(956) 261-4318"], emails: ["omar@example.com"], address: "4301 W Business 83" };

describe("faltanEnElAlta", () => {
  it("con todo puesto, nada falta; ni en la solicitud ni en el alta directa", () => {
    expect(faltanEnElAlta({ terms: "NET 30" }, [lleno], true)).toEqual([]);
    expect(faltanEnElAlta({ terms: "NET 30" }, [lleno], false)).toEqual([]);
  });
  it("términos, nombre y cargo del primer contacto son obligatorios siempre", () => {
    expect(faltanEnElAlta({ terms: " " }, [{ ...lleno, name: "", title: " " }], true)).toEqual(["terms", "contacto.0.name", "contacto.0.title"]);
  });
  it("teléfono O correo: con uno de los dos basta; sin ninguno, se marcan los dos", () => {
    expect(faltanEnElAlta({ terms: "COD" }, [{ ...lleno, emails: [""] }], true)).toEqual([]);
    expect(faltanEnElAlta({ terms: "COD" }, [{ ...lleno, phones: [] }], true)).toEqual([]);
    expect(faltanEnElAlta({ terms: "COD" }, [{ ...lleno, phones: [""], emails: [] }], true)).toEqual(["contacto.0.phones.0", "contacto.0.emails.0"]);
  });
  it("correo y dirección: la solicitud puede ir sin ellos («can pass to auth»); el alta directa, no", () => {
    const sinCorreoNiDireccion = { ...lleno, emails: [], address: "" };
    expect(faltanEnElAlta({ terms: "COD" }, [sinCorreoNiDireccion], true)).toEqual([]);
    expect(faltanEnElAlta({ terms: "COD" }, [sinCorreoNiDireccion], false)).toEqual(["contacto.0.emails.0", "contacto.0.address"]);
  });
  it("sin ningún contacto, falta todo el primero; los contactos de después no se exigen", () => {
    expect(faltanEnElAlta({ terms: "COD" }, [], true)).toEqual(["contacto.0.name", "contacto.0.title", "contacto.0.phones.0", "contacto.0.emails.0"]);
    expect(faltanEnElAlta({ terms: "COD" }, [lleno, contactoVacio()], true)).toEqual([]);
  });
});

describe("la ficha", () => {
  const ficha = sinComentarios(leer("src/app/customers/FichaDeCliente.tsx"));
  it("solo en un alta suma lo obligatorio a los errores, con la bandera de solicitud; una ficha ya creada no", () => {
    expect(ficha).toContain("...(nuevo ? faltanEnElAlta(form, contactos, altaComoSolicitud) : [])");
  });
  it("marca en rojo nombre, cargo y dirección del contacto, y en el alta pone el asterisco al primero", () => {
    expect(ficha).toContain("className={cn(rojo(`contacto.${i}.name`))} data-nombre-de-contacto={i}");
    expect(ficha).toContain("className={cn(rojo(`contacto.${i}.title`))} data-cargo-de-contacto={i}");
    expect(ficha).toContain("rojo(`contacto.${i}.address`))} />");
    expect(ficha).toContain('const ast = (i: number) => (alta && i === 0 ? " *" : "");');
    expect(ficha).toContain("alta={cliente === null} t={t} />");
  });
});
