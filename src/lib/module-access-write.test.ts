import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { knownModules, normalizeModules, MODULE_ACCESS } from "./constants";
import { constraintDe, detalleAConsola, mensajeEscrituraPerfil } from "./user-write-error";

// El bug de Patricia (D-NEXT): su fila lleva module_access = ['clockin'] —la que 095 dejó a
// propósito sin tocar— y conceder cualquier módulo desde el diálogo arrastraba esa palabra al
// UPDATE, que el constraint profiles_module_access_known rechazaba entero.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

describe("knownModules: filtra a lo que la base acepta, y NO traduce", () => {
  it("deja caer 'clockin' y conserva el resto", () => {
    expect(knownModules(["clockin"])).toEqual([]);
    expect(knownModules(["clockin", "timetracker", "erp"])).toEqual(["timetracker", "erp"]);
    expect(knownModules(["deliveries", "recruiting"])).toEqual(["deliveries", "recruiting"]);
  });
  it("nulo o vacío → vacío", () => {
    expect(knownModules(null)).toEqual([]);
    expect(knownModules(undefined)).toEqual([]);
    expect(knownModules([])).toEqual([]);
  });
  it("no inventa módulos: es un filtro, no una traducción (normalizeModules SÍ traduce)", () => {
    expect(normalizeModules(["clockin"])).toEqual(["timetracker"]);   // lectura: la de siempre
    expect(knownModules(["clockin"])).toEqual([]);                     // escritura: sin conceder nada
  });
  it("la lista sale de MODULE_ACCESS, no escrita a mano", () => {
    const claves = MODULE_ACCESS.map((m) => m.key);
    expect(knownModules([...claves, "clockin", "inventado"])).toEqual(claves);
    expect(leer("src/lib/constants.ts")).toMatch(/MODULE_ACCESS\.some\(\(c\) => c\.key === m\)/);
  });
  it("mutación: si el filtro dejara pasar 'clockin', el caso de Patricia volvería", () => {
    const sinFiltro = (a: string[]) => a;
    expect(sinFiltro(["clockin"])).toContain("clockin");
    expect(knownModules(["clockin"])).not.toContain("clockin");
  });
});

describe("lo que se escribe al conceder un módulo partiendo de ['clockin']", () => {
  // La misma expresión que las cuatro funciones de data-provider.
  const alConceder = (actual: string[] | null, modulo: string) =>
    Array.from(new Set([...knownModules(actual), modulo]));
  const alQuitar = (actual: string[] | null, modulo: string) =>
    knownModules(actual).filter((m) => m !== modulo);

  for (const modulo of ["deliveries", "recruiting", "timetracker", "erp"]) {
    it(`conceder ${modulo}: sin 'clockin' y con el módulo concedido`, () => {
      const escrito = alConceder(["clockin"], modulo);
      expect(escrito).not.toContain("clockin");
      expect(escrito).toContain(modulo);
      expect(escrito).toHaveLength(1);
    });
  }
  it("quitar un módulo también limpia la palabra vieja", () => {
    expect(alQuitar(["clockin", "erp"], "erp")).toEqual([]);
  });
  it("a quien está bien no le cambia nada", () => {
    expect(alConceder(["deliveries", "timetracker"], "erp")).toEqual(["deliveries", "timetracker", "erp"]);
  });
});

describe("las cuatro escrituras del provider filtran, y el select trae erp_role", () => {
  const src = leer("src/lib/data-provider.tsx");
  it("ninguna parte ya del array crudo de la fila", () => {
    expect(src.match(/const actuales = knownModules\(target\?\.module_access\);/g) ?? []).toHaveLength(4);
    expect(src).not.toMatch(/Array\.from\(new Set\(\[\.\.\.\(target\?\.module_access \?\? \[\]\)/);
    expect(src).not.toMatch(/\(target\?\.module_access \?\? \[\]\)\.filter/);
  });
  it("el select de profiles trae erp_role (el diálogo lo pinta y el guardado lo conserva)", () => {
    const select = /\.from\("profiles"\)\.select\("([^"]+)"\)/.exec(src);
    expect(select).not.toBeNull();
    for (const col of ["module_access", "recruiting_role", "timetracker_role", "erp_role"]) {
      expect(select![1], col).toContain(col);
    }
  });
  it("y el fallo de la base ya no se pinta crudo en las cuatro", () => {
    // Solo el tramo de las cuatro funciones de módulos: las otras escrituras de perfil
    // (nombre, tienda, rol de Entregas) siguen como estaban, fuera del alcance del encargo.
    const desde = src.indexOf("const updateUserRecruitingAccess");
    const hasta = src.indexOf("const deleteUser");
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    const tramo = src.slice(desde, hasta);
    expect(tramo).not.toMatch(/notify\(error\.message\)/);
    expect(tramo.match(/notify\(mensajeEscrituraPerfil\(error, lang\)\)/g) ?? []).toHaveLength(4);
    expect(tramo.match(/console\.error\(detalleAConsola\(error\)\)/g) ?? []).toHaveLength(4);
  });
});

describe("mensajeEscrituraPerfil: legible, en su idioma, sin tragarse el detalle", () => {
  const conocido = { message: 'new row for relation "profiles" violates check constraint "profiles_module_access_known"', code: "23514" };
  const tramo = { message: 'new row for relation "profiles" violates check constraint "profiles_timetracker_access_needs_role"' };
  const raro = { message: "could not connect to server", code: "08006" };

  it("saca el nombre del constraint del mensaje de Postgres", () => {
    expect(constraintDe(conocido)).toBe("profiles_module_access_known");
    expect(constraintDe(raro)).toBeNull();
  });
  it("constraint conocido: explicación en el idioma del usuario, distinta en cada uno", () => {
    const es = mensajeEscrituraPerfil(conocido, "es");
    const en = mensajeEscrituraPerfil(conocido, "en");
    expect(es).not.toBe(en);
    expect(es).not.toContain("check constraint");
    expect(es).toMatch(/módulo antiguo/);
    expect(en).toMatch(/old module name/);
  });
  it("el del tramo de Time Tracker también, porque es el otro que puede saltar aquí", () => {
    expect(mensajeEscrituraPerfil(tramo, "es")).toMatch(/tramo/);
  });
  it("constraint desconocido: el mensaje crudo, sin inventar un texto genérico", () => {
    expect(mensajeEscrituraPerfil(raro, "es")).toBe("could not connect to server");
  });
  it("el detalle para la consola lleva el crudo y el código", () => {
    const d = detalleAConsola(conocido);
    expect(d).toContain('violates check constraint "profiles_module_access_known"');
    expect(d).toContain("code=23514");
  });
});
