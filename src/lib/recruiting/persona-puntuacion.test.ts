import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMNAS_309, NUMERICAS_309, tiene309 } from "./employee-file";

// La columna «Persona» (migración 309) y el Tot Score. Como `expediente-acciones.test.ts`: la función corre, y las
// pruebas de fuente comprueban que la pantalla y las acciones de servidor LA USAN — y que la 309 no se manda cuando
// la tabla no la tiene (si se mandara, tumbaría el guardado entero).

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
const pagina = leer("src/app/recruiting/(recruiting)/employees/page.tsx");
const acciones = sinComentarios(leer("src/app/recruiting/actions/hr.ts"));
const migracion = leer("supabase/migrations/309_puntuacion_persona.sql");

describe("columna Persona (309)", () => {
  it("tiene309 mira si una fila trae la clave", () => {
    expect(tiene309([])).toBe(false);
    expect(tiene309([{ id: "a", risk_score: 1 }])).toBe(false);
    expect(tiene309([{ id: "a", person_score: null }])).toBe(true);
  });

  it("person_score es la única columna de la 309 y es numérica", () => {
    expect(COLUMNAS_309).toEqual(["person_score"]);
    expect(NUMERICAS_309).toEqual(["person_score"]);
  });

  it("la lista dice si la tabla tiene la 309 y el guardado valida el número", () => {
    expect(acciones).toContain("campos309: tiene309((files ?? []) as Record<string, unknown>[]),");
    expect(acciones).toContain("for (const k of [...NUMERICAS_207, ...NUMERICAS_309]) {");
  });

  it("la ficha apaga Persona sin la 309, y «Guardar» solo la manda con ella", () => {
    expect(pagina).toContain("setCon309(r.campos309)");
    expect(pagina).toContain("con309={con309}");
    expect(pagina).toContain("disabled={!con309} data-campo309={k}");
    expect(pagina).toContain("placeholder={con309 ? extra.placeholder : faltaMigracion(t, 309)}");
    expect(pagina).toContain("...(con309 ? de309 : {}),");
    // Sin esto, la columna viajaría en `resto` aunque la tabla no la tenga.
    expect(pagina).toContain("[...COLUMNAS_207, ...COLUMNAS_309] as readonly string[]");
    expect(pagina).toContain('campo309("person_score"');
  });

  it("Tot Score sale de la función pura, es solo lectura y dice «2 de 3» cuando faltan", () => {
    expect(pagina).toContain('import { puntuacionTotal } from "@/lib/recruiting/puntuacion-total";');
    expect(pagina).toContain("puntuacionTotal({ risk: info.risk_score, performance: info.performance_score, person: info.person_score })");
    expect(pagina).toMatch(/data-tot-score[\s\S]{0,80}readOnly|readOnly[\s\S]{0,120}data-tot-score/);
    expect(pagina).toContain("`${totalDeHoja.cuantas} de ${totalDeHoja.de}`");
  });

  it("la migración 309 añade person_score sin tocar lo demás y se inscribe en el ledger", () => {
    expect(migracion).toMatch(/alter table recruiting\.employee_files\s+add column if not exists person_score numeric\(6,2\);/);
    expect(migracion).not.toMatch(/\bcreate policy\b|\bgrant\b|\bdrop\b/i);
    expect(migracion).toMatch(/-- @ledger-below\s+insert into public\.schema_migrations \(name, checksum\) values \('309_puntuacion_persona\.sql', '[0-9a-f]{64}'\)/);
  });
});
