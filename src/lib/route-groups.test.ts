import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// G-4 / G-5 (D-NEXT). Dos rutas que estaban donde no debían: una página sin ningún enlace y una
// redirección metida en un route group cuyo layout la gateaba antes de que corriera. Como este repo
// no dibuja pantallas en las pruebas, lo que sí se puede afirmar es la forma del árbol de rutas.

const raiz = process.cwd();

function ficheros(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) ficheros(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

describe("G-4: /recruiting/users redirige siempre, fuera del grupo (recruiting)", () => {
  it("la página vive en src/app/recruiting/users, no dentro de (recruiting)", () => {
    expect(existsSync(join(raiz, "src/app/recruiting/users/page.tsx"))).toBe(true);
    expect(existsSync(join(raiz, "src/app/recruiting/(recruiting)/users"))).toBe(false);
  });
  it("no hay un layout propio en src/app/recruiting que la vuelva a gatear", () => {
    expect(existsSync(join(raiz, "src/app/recruiting/layout.tsx"))).toBe(false);
  });
  it("y sigue siendo una redirección a /home/users, sin sesión ni rol por medio", () => {
    // Sin los comentarios: el propio fichero explica por qué se movió y nombra recruiting_role.
    const src = readFileSync(join(raiz, "src/app/recruiting/users/page.tsx"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/redirect\("\/home\/users"\)/);
    expect(src).not.toMatch(/createClient|getUser|recruiting_role/);
  });
});

describe("G-5: la página de aprobaciones huérfana se borró y nadie la enlaza", () => {
  it("src/app/(app)/approvals no existe", () => {
    expect(existsSync(join(raiz, "src/app/(app)/approvals"))).toBe(false);
  });
  it("ningún fichero de src/ enlaza /approvals", () => {
    const conEnlace = ficheros(join(raiz, "src"))
      .filter((p) => !p.endsWith("route-groups.test.ts"))
      .filter((p) => /["'`]\/approvals\b/.test(readFileSync(p, "utf8")));
    expect(conEnlace).toEqual([]);
  });
});
