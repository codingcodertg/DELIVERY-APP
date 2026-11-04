import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { telefonoEstandar } from "./recruiting/formato";
import { telefonoDeFicha } from "./recruiting/employee-file";
import { valorDeActivo, textoDeTelefono } from "./recruiting/activos";
import { telefonoDeCliente } from "./customers/formato";
import { conTelefonoEstandar, telefonoParaVer } from "./telefono-de-la-orden";
import { telefonoLimpio } from "./estimator/modelo";

/*
 * D-850 · El dueño: «usa el formato (956) 340-5910 en todo». Un solo formato y un solo ayudante, `telefonoEstandar`.
 * Hasta aquí RR. HH. guardaba «956-555-0123» (D-432, `telefonoDeFicha`) y Entregas/Clientes/candidatos «(956) 340-5910»
 * (D-610/D-630): dos formas para lo mismo, según la app. Estas pruebas fijan que todos los ayudantes dan lo mismo, y que
 * nadie vuelve a escribir otro.
 */

const CASOS = [
  "956-555-0123", "9565550123", "(956) 555-0123", "+1 956.555.0123", "1-956-555-0123", "956 555 0123", "956)735-4681",
  "956*340*5910", "  956  340  5910 ",
  // Lo que no es un número completo se deja, sin perder nada: corto, largo, dos números, y con texto o extensión.
  "555-0123", "95655501234", "9565550123, 9565550124", "956-555-0123 ext. 12", "956 555 0123 ext 12", "956-246-6915 - Viya, A/P",
];

describe("un solo formato de teléfono en todo el hub (D-850)", () => {
  it("la forma es «(956) 340-5910», venga como venga, y la extensión escrita al lado no se pierde", () => {
    expect(telefonoEstandar("956-340-5910")).toBe("(956) 340-5910");
    expect(telefonoEstandar("+19563405910")).toBe("(956) 340-5910");
    expect(telefonoEstandar("956-555-0123 ext. 12")).toBe("956-555-0123 ext. 12");
    expect(telefonoEstandar("")).toBe("");
    expect(telefonoEstandar(null)).toBe("");
  });

  it("RR. HH. (`telefonoDeFicha`) y el ayudante estándar dan lo mismo; vacío es null en la ficha", () => {
    for (const t of CASOS) expect(telefonoDeFicha(t), t).toBe(telefonoEstandar(t));
    expect(telefonoDeFicha("   ")).toBeNull();
    expect(telefonoDeFicha(null)).toBeNull();
  });

  it("Entregas, Clientes y los activos de la empresa también: mismo resultado para cada caso", () => {
    for (const t of CASOS) {
      const e = telefonoEstandar(t);
      expect(telefonoParaVer(t), t).toBe(e);
      expect(conTelefonoEstandar({ delivery_phone: t }).delivery_phone, t).toBe(e || null);
      expect(telefonoDeCliente(t), t).toBe(e);
      expect(valorDeActivo("phone", t), t).toBe(e || null);
    }
    expect(textoDeTelefono({ value: "956-817-1583", ext: "111" })).toBe("(956) 817-1583 · ext. 111");
  });

  it("el Estimador, cuando el número es válido, da la misma forma (y null si no lo es)", () => {
    for (const t of ["956-555-0123", "+1 956.555.0123", "(956) 555-0123", "9565550123"]) expect(telefonoLimpio(t)).toBe(telefonoEstandar(t));
    expect(telefonoLimpio("555-0123")).toBeNull();
  });
});

// ---- Barrido: nadie escribe otro formateador ----------------------------------------------------------------------
const RAIZ = join(__dirname, "..", "..");
function ficheros(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) ficheros(p, out);
    else if (/\.(ts|tsx|mjs|mts|js)$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(RAIZ, p).split(sep).join("/");
const TODOS = [...ficheros(join(RAIZ, "src")), ...ficheros(join(RAIZ, "scripts")), ...ficheros(join(RAIZ, "desktop"))];

describe("barrido: no queda otro formateador de teléfonos", () => {
  it("ningún fichero arma ya la forma vieja 956-xxx-xxxx (`${d.slice(0, 3)}-${d.slice(3, 6)}-…`)", () => {
    const vieja = /\$\{\s*\w+\.slice\(0,\s*3\)\s*\}-\$\{\s*\w+\.slice\(3,\s*6\)\s*\}-/;
    const con = TODOS.filter((p) => vieja.test(readFileSync(p, "utf8"))).map(rel);
    expect(con).toEqual([]);
  });

  it("la forma «(956) 340-5910» solo se arma en el ayudante y en sus copias para node, cada una con su prueba", () => {
    const nueva = /\(\$\{\s*\w+\.slice\(0,\s*3\)\s*\}\)\s\$\{\s*\w+\.slice\(3,\s*6\)\s*\}-/;
    const con = TODOS.filter((p) => nueva.test(readFileSync(p, "utf8"))).map(rel).sort();
    expect(con).toEqual([
      "scripts/carga-herramientas-de-empleados.mjs", // guion de una vez, corre con node
      "scripts/leads/importa-leads-privado.mjs", // guion, corre con node
      "src/lib/customers/formato.ts", // `telefonoDeCliente`: copia sin imports (la cargan guiones con node)
      "src/lib/recruiting/activos.ts", // `telefonoDeActivo`: copia sin imports (la carga un guion con node)
      "src/lib/recruiting/formato.ts", // `telefonoEstandar`: EL ayudante
      "src/lib/telefono-de-la-orden.ts", // `telefonoAlEscribir`: el formato a medio teclear, mismo molde
    ]);
  });
});
