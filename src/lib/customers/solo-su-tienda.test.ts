import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Clientes: todos salvo el admin ven solo su tienda; juntar, columnas y archivados son del admin (D-NEXT, migración 217). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("la 217", () => {
  const sql = leer("supabase/migrations/217_clientes_solo_su_tienda.sql");
  it("sin «else true»: admin todo; los demás su tienda (sin tienda, nada); el vendedor además los suyos", () => {
    expect(sql).toContain("when p.role = 'admin' then true");
    // Sin los comentarios: la cabecera del .sql cuenta por qué se quitó el «else true».
    expect(sql.split("
").filter((l) => !l.trim().startsWith("--")).join("
")).not.toMatch(/else true/);
    expect(sql).toContain("upper(btrim(coalesce(p_store, ''))) = erp.customers_codigo_de_tienda(p.store)");
    expect(sql).toContain("or (p.role = 'sales' and (p_rep = auth.uid() or p_creador = auth.uid()))");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
    expect(sql).not.toContain("'PENDIENTE'");
  });
});

describe("la pantalla", () => {
  const lista = sinComentarios(leer("src/app/customers/Clientes.tsx"));
  it("«Archivados» solo para el admin; la vista acotada esconde columnas, arrastre y pastillas", () => {
    expect(lista).toContain("{esAdmin && (\n        <button\n          type=\"button\"\n          onClick={() => setFiltro((f) => ({ ...f, archivados: !f.archivados }))}");
    expect(lista).toContain("data-chip-archivados");
    expect(lista).toContain("const soloSuTienda = vistaAcotada;");
  });
  it("«Decidir si se juntan» solo en la barra del admin, y su página redirige a los demás", () => {
    expect(sinComentarios(leer("src/components/customers/barra.tsx"))).toContain('...(role === "admin" ? [{ href: "/customers/juntar", label: rotuloDeDecidir(pendientes, t) }] : []),');
    const pagina = sinComentarios(leer("src/app/customers/juntar/page.tsx"));
    expect(pagina).toContain('if (role !== "admin") redirect("/customers");');
    expect(pagina).toContain('import { redirect } from "next/navigation";');
  });
});
