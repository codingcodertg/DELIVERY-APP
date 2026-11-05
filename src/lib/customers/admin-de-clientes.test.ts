import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { esAdminDeClientes, rolEnClientes } from "./admin-de-clientes";
import { puedeArchivar, puedeAsignarVendedores, puedeEditar } from "./reglas";
import { securityLabel } from "@/lib/security-log";

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
const conCasilla = ["customers", "deliveries"];

describe("admin solo de Clientes (customers_role, 241)", () => {
  it("con customers_role = 'admin' y la casilla, dentro de Clientes es admin", () => {
    const nick = { role: "sales", customers_role: "admin", module_access: conCasilla };
    expect(esAdminDeClientes(nick)).toBe(true);
    expect(rolEnClientes(nick)).toBe("admin");
    expect(puedeAsignarVendedores(rolEnClientes(nick))).toBe(true);
    expect(puedeArchivar(rolEnClientes(nick))).toBe(true);
    expect(puedeEditar(rolEnClientes(nick))).toBe(true);
  });

  it("el cambio se apunta en el registro de seguridad con su propia clase", () => {
    expect(securityLabel("customers_role_changed", "es")).toBe("Admin de Clientes cambiado");
    expect(securityLabel("customers_role_changed", "en")).toBe("Customers admin changed");
  });

  it("sin la casilla no vale, y sin customers_role sigue con su rol del hub", () => {
    expect(esAdminDeClientes({ role: "sales", customers_role: "admin", module_access: ["deliveries"] })).toBe(false);
    expect(rolEnClientes({ role: "sales", customers_role: "admin", module_access: null })).toBe("sales");
    expect(rolEnClientes({ role: "manager", customers_role: null, module_access: conCasilla })).toBe("manager");
    expect(rolEnClientes({ role: "admin", customers_role: null, module_access: null })).toBe("admin");
    expect(rolEnClientes(null)).toBe("sales");
  });

  it("las tres páginas leen customers_role y deciden con el rol de Clientes; la barra sigue con el del hub", () => {
    for (const p of ["src/app/customers/page.tsx", "src/app/customers/[id]/page.tsx", "src/app/customers/juntar/page.tsx"]) {
      const s = leer(p);
      expect(s, p).toContain("customers_role");
      expect(s, p).toContain("rolEnClientes(");
      expect(s, p).toMatch(/<BarraDeClientes\s+role=\{rolDelHub\}\s+esAdminDeClientes=\{role === "admin"\}/);
      expect(s, p).toMatch(/rolDelHub = role;\s+role = rolEnClientes\(/);
    }
    expect(leer("src/app/customers/juntar/page.tsx")).toContain('if (role !== "admin") redirect("/customers");');
    expect(leer("src/components/customers/barra.tsx")).toContain('...((esAdminDeClientes ?? role === "admin") ? [{ href: "/customers/juntar"');
  });

  it("la base lo respeta (241): columna guardada, función, fila, políticas y las tres funciones de decidir", () => {
    const sql = leer("supabase/migrations/241_admin_de_clientes.sql");
    expect(sql).toContain("add column if not exists customers_role text");
    expect(sql).toContain("or NEW.customers_role is distinct from OLD.customers_role");
    expect(sql).toContain("create or replace function erp.es_admin_de_clientes()");
    expect(sql).toContain("(customers_role = 'admin' and 'customers' = any(coalesce(module_access, '{}')))");
    expect(sql).toMatch(/customers_ve_la_fila[\s\S]*p\.customers_role = 'admin'/);
    for (const pol of ["customers update (admin)", "customers delete (admin)", "customer requests read own or admin"]) expect(sql).toContain(`create policy "${pol}"`);
    for (const f of ["aprueba_solicitud_de_cliente(bigint)", "rechaza_solicitud_de_cliente(bigint, text)", "aprueba_edicion_de_cliente(bigint, text)"]) expect(sql).toContain(`'erp.${f}'`);
    expect(sql).toContain("replace(def, 'if not public.is_admin() then', 'if not erp.es_admin_de_clientes() then')");
    expect(sql).not.toContain("D-864");
    expect(sql).toContain("-- @ledger-below");
  });
});
