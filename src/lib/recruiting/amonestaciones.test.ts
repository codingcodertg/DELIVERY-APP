import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { etiquetaDeHistorial, esDeEmpleado, KINDS, motivoDeAmonestacionValido } from "./historial";

/** D-NEXT (227): amonestaciones en el expediente, las dan el admin y el gerente de RR. HH. */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

describe("la amonestación", () => {
  it("es un tipo del historial, de empleado, con etiqueta en los dos idiomas; el motivo necesita 5 letras", () => {
    expect(KINDS).toContain("employee_warning");
    expect(esDeEmpleado("employee_warning")).toBe(true);
    expect(etiquetaDeHistorial("employee_warning", "es")).toBe("Amonestación");
    expect(etiquetaDeHistorial("employee_warning", "en")).toBe("Warning");
    expect(motivoDeAmonestacionValido("  llegó tarde ")).toBe(true);
    expect(motivoDeAmonestacionValido("mal")).toBe(false);
    expect(motivoDeAmonestacionValido(null)).toBe(false);
  });
  it("la 227 suma el tipo sin perder los de la 212", () => {
    const sql = leer("supabase/migrations/227_rrhh_amonestaciones.sql");
    for (const k of KINDS) expect(sql, k).toContain(`'${k}'`);
  });
  it("la acción la dan admin y gerente (PUEDE), exige motivo y escribe la fila con quién y por qué", () => {
    const hr = leer("src/app/recruiting/actions/hr.ts");
    const i = hr.indexOf("export async function registerWarning");
    expect(i).toBeGreaterThan(0);
    const cuerpo = hr.slice(i, hr.indexOf("\n}\n", i));
    expect(cuerpo).toContain("if (!PUEDE.includes(yo.role))");
    expect(cuerpo).toContain("if (!motivoDeAmonestacionValido(datos.motivo))");
    expect(cuerpo).toContain('kind: "employee_warning"');
    expect(cuerpo).toContain("actor_id: yo.userId");
  });
  it("la ficha tiene el botón «Amonestar» y el diálogo con motivo obligatorio", () => {
    const p = leer("src/app/recruiting/(recruiting)/employees/page.tsx");
    expect(p).toContain('data-accion="amonestar" onClick={onAmonestar}');
    expect(p).toContain("<AmonestarDialog");
    const a = leer("src/app/recruiting/(recruiting)/employees/acciones.tsx");
    expect(a).toContain('data-dialogo="amonestar"');
    expect(a).toContain("data-confirmar-amonestacion disabled={!listo || busy}");
    expect(a).toContain("const listo = motivoDeAmonestacionValido(motivo);");
  });
});
