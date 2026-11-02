import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codigoDeTiendaDelPerfil, filasQueVe, veLaFila } from "./visibilidad";

/**
 * D-NEXT: la regla de «quién ve qué cliente» vive en un solo sitio y es el gemelo de la 217. Las demás apps (el Quote
 * Builder la primera) la importan; ninguna escribe la suya.
 */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

const fila = (store: string, rep_id: string | null = null, created_by: string | null = null) => ({ store, rep_id, created_by });

describe("el gemelo de erp.customers_ve_la_fila", () => {
  it("admin: todo", () => {
    expect(veLaFila(fila("MCA"), { id: "a", role: "admin", store: null })).toBe(true);
  });
  it("los demás: su tienda, por el NOMBRE del perfil contra el código de la fila", () => {
    expect(veLaFila(fila("MCA"), { id: "m", role: "manager", store: "RDZ McAllen" })).toBe(true);
    expect(veLaFila(fila("bro "), { id: "m", role: "accounting", store: "RDZ Brownsville" })).toBe(true);
    expect(veLaFila(fila("PHR"), { id: "m", role: "manager", store: "RDZ McAllen" })).toBe(false);
    expect(veLaFila(fila("MCA"), { id: "m", role: "manager", store: null })).toBe(false);
  });
  it("el vendedor, además, los suyos por rep_id o created_by; un gerente no", () => {
    expect(veLaFila(fila("PHR", "v"), { id: "v", role: "sales", store: "RDZ McAllen" })).toBe(true);
    expect(veLaFila(fila("PHR", null, "v"), { id: "v", role: "sales", store: null })).toBe(true);
    expect(veLaFila(fila("PHR", "v"), { id: "v", role: "manager", store: "RDZ McAllen" })).toBe(false);
    expect(veLaFila(fila("PHR", "otro"), { id: "v", role: "sales", store: "RDZ McAllen" })).toBe(false);
  });
  it("filasQueVe filtra con la misma regla", () => {
    const filas = [fila("MCA"), fila("PHR", "v"), fila("BRO")];
    expect(filasQueVe(filas, { id: "v", role: "sales", store: "RDZ McAllen" })).toEqual([filas[0], filas[1]]);
  });
  it("el código de la tienda del perfil: nombre → código, código → código, vacío → vacío", () => {
    expect(codigoDeTiendaDelPerfil("RDZ Pharr")).toBe("PHR");
    expect(codigoDeTiendaDelPerfil(" mca ")).toBe("MCA");
    expect(codigoDeTiendaDelPerfil("")).toBe("");
    expect(codigoDeTiendaDelPerfil(null)).toBe("");
  });
});

describe("una sola regla en todas las apps", () => {
  it("la 217 sigue diciendo lo mismo que el gemelo: admin; tienda; y el vendedor los suyos", () => {
    const sql = leer("supabase/migrations/217_clientes_solo_su_tienda.sql");
    expect(sql).toContain("when p.role = 'admin' then true");
    expect(sql).toContain("upper(btrim(coalesce(p_store, ''))) = erp.customers_codigo_de_tienda(p.store)");
    expect(sql).toContain("or (p.role = 'sales' and (p_rep = auth.uid() or p_creador = auth.uid()))");
  });
  it("el Quote Builder importa la regla, no la reescribe", () => {
    const lib = leer("src/lib/estimator/clientes-para-cotizar.ts");
    expect(lib).toContain('from "@/lib/customers/visibilidad"');
    expect(lib).toContain("veLaFila(c, yo)");
    expect(lib).not.toContain("codigoDeMiTienda");
    expect(lib).not.toContain("rep_id === yo.id");
  });
});
