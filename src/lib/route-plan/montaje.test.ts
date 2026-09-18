import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Dónde se montan los componentes del plan de ruta, y qué proveedores tienen encima (D-322).
 *
 * Por qué existe: D-321. Un componente que llama a `usePrefs()`, `useConfirm()` o `useData()` LANZA si se monta
 * donde no hay proveedor. Compila, las pruebas de texto pasan, y revienta al abrirlo. Esto fija las dos cosas:
 * que estos componentes solo se montan donde se montan hoy, y que ahí arriba están los proveedores que usan.
 * Si alguien los monta en otro sitio, esta prueba cae y le obliga a mirar qué hay encima del sitio nuevo.
 */

const raiz = process.cwd();
const leer = (r: string) => readFileSync(join(raiz, r), "utf8").split("\r\n").join("\n");
function ficheros(dir: string): string[] {
  return readdirSync(join(raiz, dir)).flatMap((n) => {
    const r = `${dir}/${n}`;
    return statSync(join(raiz, r)).isDirectory() ? ficheros(r) : /\.tsx$/.test(n) ? [r] : [];
  });
}
const dondeSeMonta = (componente: string) => ficheros("src").filter((f) => new RegExp(`<${componente}[\\s/>]`).test(leer(f)));
const hooksDe = (r: string) => [...new Set([...leer(r).matchAll(/\b(usePrefs|useConfirm|useData)\(/g)].map((m) => m[1]))].sort();
/** ¿Está `{children}` entre la apertura y el cierre de ese proveedor, en ese fichero? */
function envuelveALosHijos(r: string, proveedor: string): boolean {
  const t = leer(r);
  return [...t.matchAll(/\{children\}/g)].some((m) => {
    const antes = t.slice(0, m.index), despues = t.slice(m.index);
    return antes.lastIndexOf(`<${proveedor}`) > antes.lastIndexOf(`</${proveedor}>`) && despues.includes(`</${proveedor}>`);
  });
}

describe("los componentes del plan de ruta se montan bajo sus proveedores", () => {
  it("`PlanDelDia` solo en /routes, y `RutaDelPlan` solo dentro de `PlanDelDia`", () => {
    expect(dondeSeMonta("PlanDelDia")).toEqual(["src/app/(app)/routes/page.tsx"]);
    expect(dondeSeMonta("RutaDelPlan")).toEqual(["src/components/PlanDelDia.tsx"]);
  });

  it("los hooks con proveedor que usan: los tres, y ninguno más que no esté cubierto abajo", () => {
    expect(hooksDe("src/components/PlanDelDia.tsx")).toEqual(["useConfirm", "useData", "usePrefs"]);
    expect(hooksDe("src/components/RutaDelPlan.tsx")).toEqual(["usePrefs"]);
  });

  it("encima de /routes están los tres: Prefs en el layout raíz, Confirm y Data en el de (app)", () => {
    expect(envuelveALosHijos("src/app/layout.tsx", "PrefsProvider")).toBe(true);
    expect(envuelveALosHijos("src/app/(app)/layout.tsx", "ConfirmProvider")).toBe(true);
    expect(envuelveALosHijos("src/app/(app)/layout.tsx", "DataProvider")).toBe(true);
    // El detector distingue: el layout raíz NO da Confirm ni Data.
    expect(envuelveALosHijos("src/app/layout.tsx", "DataProvider")).toBe(false);
  });
});
