import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { accessibleModules, knownModules, landingRoute, MODULES, MODULE_ACCESS } from "@/lib/constants";
import { securityLabel } from "@/lib/security-log";
import { COLUMNAS } from "./almacen";
import { CAMPOS, ESTADOS, HISTORIAS, QB_ESTADOS } from "./reglas";

/**
 * «Clientes» existe como módulo igual que Leads (migración 180): tarjeta, casilla, puerta, la palabra de la base igual
 * que la del código; y la 180 dice lo que promete sobre quién lee, quién escribe y la clave natural.
 * Lo que la 180 HACE se mide con el ensayo del plan (docs/PLAN-clientes.md, sección 6); aquí se fija su texto.
 *
 * La versión propia (`APP_VERSIONS.customers`) y la ruta en `app-for-path.ts` las pone el orquestador al fusionar
 * (la rama no toca app-versions.ts): por eso aquí no se afirman.
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const enModulos = MODULES.find((m) => m.key === "customers");
const enAcceso = MODULE_ACCESS.find((m) => m.key === "customers");
const SQL = "supabase/migrations/180_clientes.sql";

describe("la tarjeta y la casilla", () => {
  it("es una tarjeta del hub hacia /customers, «Clientes / Customers»", () => {
    expect(enModulos?.href).toBe("/customers");
    expect(enModulos?.label_es).toBe("Clientes");
    expect(enModulos?.label_en).toBe("Customers");
    expect(accessibleModules(["customers"]).map((m) => m.key)).toEqual(["customers"]);
    expect(accessibleModules(["leads"]).map((m) => m.key)).not.toContain("customers");
  });
  it("una casilla en module_access, sin escalafón, y la nota dice quién edita y que se ven contacto y crédito", () => {
    expect(enAcceso?.accessColumn).toBe("module_access");
    expect(enAcceso?.roleColumn).toBeUndefined();
    expect(enAcceso?.roleKeys).toEqual([]);
    expect(enAcceso?.alwaysOn).toBe(false);
    expect(enAcceso?.roleNote?.es).toMatch(/Admins y managers editan/);
    expect(enAcceso?.roleNote?.es).toMatch(/contacto, teléfono, correo y crédito/);
  });
  it("knownModules no la tira al escribir (D-217)", () => {
    expect(knownModules(["clockin", "customers"])).toEqual(["customers"]);
  });
  it("con solo Clientes se entra directo; con dos, al hub", () => {
    expect(landingRoute({ role: "sales", module_access: ["customers"] })).toBe("/customers");
    expect(landingRoute({ role: "sales", module_access: ["deliveries", "customers"] })).toBe("/home");
  });
  it("el diálogo de Usuarios escribe por su propia función y no reclama rol", () => {
    const dialogo = leer("src/components/UserDialog.tsx");
    expect(dialogo).toContain("updateUserCustomersAccess(u.id, { granted });");
    expect(dialogo.match(/case "customers":/g) ?? []).toHaveLength(2);
    const prov = leer("src/lib/data-provider.tsx");
    expect(prov).toContain('void logSecurityClient(userId, "customers_access_changed"');
    expect(prov).toContain('? Array.from(new Set([...actuales, "customers"]))');
    expect(prov).toContain(': actuales.filter((m) => m !== "customers");');
    expect(securityLabel("customers_access_changed", "es")).toBe("Acceso a Clientes cambiado");
    expect(securityLabel("customers_access_changed", "en")).toBe("Customers access changed");
  });
});

describe("la puerta y el tema", () => {
  const layout = leer("src/app/customers/layout.tsx");
  // Nota D-570: la condición pasó a `puedeEntrarAClientes` (solo admins por ahora); el layout la llama en vez de escribirla.
  it("comprueba el acceso en el servidor; el admin siempre entra", () => {
    expect(layout).toContain("const tieneClientes = puedeEntrarAClientes({ role, module_access: profile?.module_access });");
    expect(layout).toContain("if (!tieneClientes) {");
    expect(layout).toContain('redirect("/login?next=/customers")');
  });
  it("un fallo de lectura del perfil no redirige (D-234)", () => {
    const desde = layout.indexOf('=== "fallo"');
    const hasta = layout.indexOf("const role =");
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    expect(layout.slice(desde, hasta)).not.toContain("redirect(");
  });
  it("se viste con el tema del ERP: su hoja, su ancla data-app y su barra lateral; y la hoja emite las clases de /customers", () => {
    expect(layout).toContain('import "@/app/erp/erp.css";');
    expect(layout).toContain('<div data-app="erp">');
    expect(layout).toContain("<ErpNavProvider>{children}</ErpNavProvider>");
    const css = leer("src/app/erp/erp.css");
    for (const s of ['@source "../customers";', '@source "../../components/customers";', '@source "../../lib/customers";']) expect(css).toContain(s);
    const barra = leer("src/components/customers/barra.tsx");
    expect(barra).toContain('import { SideNav } from "@/components/erp/side-nav";');
    expect(barra).toContain('nav: { main: [{ href: "/customers", label: t("Customers", "Clientes") }], analytics: [] }');
  });
  it("la página dice quién mira (rol del hub) y no lee los clientes en el servidor; la pantalla usa el cliente del ERP", () => {
    const page = leer("src/app/customers/page.tsx");
    expect(page).toContain('.select("full_name, role, module_access")');
    expect(page).toContain("puedeEditar={puedeEditar(role)}");
    expect(page).not.toContain('.from("customers")');
    const pantalla = leer("src/app/customers/Clientes.tsx");
    expect(pantalla).toContain('import { createClient } from "@/lib/erp/supabase/client";');
    expect(pantalla).toContain('import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";');
  });
});

describe("la 180", () => {
  const sql = leer(SQL);
  const [cuerpo] = sql.split("-- @ledger-below");
  const sinComentarios = cuerpo.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("es la ÚLTIMA migración que define profiles_module_access_known, y su lista es MODULE_ACCESS entero", () => {
    const definen = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => leer(`supabase/migrations/${f}`).includes("add constraint profiles_module_access_known"));
    expect(definen[definen.length - 1]).toBe("180_clientes.sql");
    const lista = /module_access <@ array\[([^\]]+)\]\)\n  not valid;/.exec(cuerpo)![1];
    expect(lista).not.toContain("clockin");
    expect(lista.split(",").sort()).toEqual(MODULE_ACCESS.map((m) => `'${m.key}'`).sort());
  });

  it("quién entra: admin o la casilla; quién escribe: admin, o manager del HUB con la casilla (profiles.role, no erp_role)", () => {
    expect(cuerpo).toContain("create or replace function public.has_customers_access()");
    expect(cuerpo).toContain("select role = 'admin' or 'customers' = any(coalesce(module_access, '{}'))");
    const escribe = /create or replace function erp\.customers_can_write\(\)[\s\S]*?\$\$;/.exec(cuerpo)![0];
    expect(escribe).toContain("select (role = 'admin' or (role = 'manager' and 'customers' = any(coalesce(module_access, '{}'))))");
    expect(escribe).toContain("from public.profiles where id = auth.uid()");
    expect(escribe).not.toContain("erp_role");
  });

  it("la tabla vive en erp, con la clave natural tienda + cuenta sin mayúsculas ni espacios, y las columnas que la pantalla pide", () => {
    const tabla = /create table if not exists erp\.customers \(([\s\S]*?)\n\);/.exec(cuerpo)![1];
    for (const col of COLUMNAS.split(",").map((c) => c.trim())) expect(tabla, col).toMatch(new RegExp(`\\n  ${col}\\s`));
    for (const campo of CAMPOS) expect(tabla, campo.key).toMatch(new RegExp(`\\n  ${campo.key}\\s`));
    expect(cuerpo).toContain("create unique index if not exists customers_store_account_unico\n  on erp.customers (upper(btrim(store)), lower(btrim(account)));");
  });

  it("los valores cerrados de la base son los de la pantalla", () => {
    const valores = (col: string) => [...new RegExp(`check \\(${col} is null or ${col} in \\(([^)]+)\\)\\)`).exec(cuerpo)![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(valores("status_store").sort()).toEqual([...ESTADOS].sort());
    expect(valores("status_group").sort()).toEqual([...ESTADOS].sort());
    expect(valores("history_store").sort()).toEqual([...HISTORIAS].sort());
    expect(valores("history_group").sort()).toEqual([...HISTORIAS].sort());
    expect(valores("qb_status").sort()).toEqual([...QB_ESTADOS].sort());
  });

  it("RLS al estilo del ERP: una puerta RESTRICTIVA por módulo, lectura para todos los que entran, escritura por la función, borrado solo admin", () => {
    expect(cuerpo).toContain('create policy "customers module gate" on erp.customers as restrictive for all to authenticated\n  using ((select public.has_customers_access())) with check ((select public.has_customers_access()));');
    expect(cuerpo).toContain('create policy "customers read" on erp.customers as permissive for select to authenticated\n  using (true);');
    expect(cuerpo).toContain('create policy "customers insert (writers)" on erp.customers as permissive for insert to authenticated\n  with check ((select erp.customers_can_write()));');
    expect(cuerpo).toContain('create policy "customers update (writers)" on erp.customers as permissive for update to authenticated\n  using ((select erp.customers_can_write())) with check ((select erp.customers_can_write()));');
    expect(cuerpo).toContain('create policy "customers delete (admin)" on erp.customers as permissive for delete to authenticated\n  using ((select public.is_admin()));');
    expect([...cuerpo.matchAll(/create policy /g)]).toHaveLength(5);
    expect(cuerpo).toMatch(/revoke all on erp\.customers from public, anon, authenticated;/);
    expect(cuerpo).toMatch(/grant select, insert, update, delete on erp\.customers to authenticated;/);
    expect(cuerpo).toMatch(/alter table erp\.customers enable row level security;/);
    expect(sinComentarios).not.toMatch(/to anon/i);
  });

  it("quién y cuándo lo pone un disparador, antes de insertar y de actualizar", () => {
    expect(cuerpo).toContain("create trigger customers_touch before insert or update on erp.customers");
    const fn = /create or replace function erp\.customers_touch\(\)[\s\S]*?\nend \$\$;/.exec(cuerpo)![0];
    expect(fn).toContain("new.updated_at := now();");
    expect(fn).toContain("new.updated_by := coalesce(auth.uid(), new.updated_by);");
  });

  it("no concede el módulo a nadie, no mete datos, sin begin/commit propios y sin D-NNN dentro", () => {
    expect(sinComentarios).not.toMatch(/update public\.profiles/i);
    expect(sinComentarios).not.toMatch(/insert into erp\.customers/i);
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).not.toMatch(/D-\d{3}/);
  });

  it("el checksum del registro es el del cuerpo", () => {
    const sha = createHash("sha256").update(cuerpo).digest("hex");
    expect(sql).toContain(`values ('180_clientes.sql', '${sha}')`);
  });
});

describe("D-570 · solo admins por ahora", async () => {
  const { CLIENTES_SOLO_ADMINS, puedeEntrarAClientes, seOfreceClientes } = await import("./reglas");
  it("el interruptor está puesto, y con él solo entra el admin aunque otro tenga la casilla", () => {
    expect(CLIENTES_SOLO_ADMINS).toBe(true);
    expect(puedeEntrarAClientes({ role: "admin", module_access: [] })).toBe(true);
    for (const role of ["manager", "sales", "accounting", "logistics", "warehouse", "driver"]) {
      expect(puedeEntrarAClientes({ role, module_access: ["customers"] })).toBe(false);
    }
    expect(puedeEntrarAClientes(null)).toBe(false);
  });
  it("la casilla de Usuarios solo se ofrece al admin, y el diálogo pregunta antes de dibujar el bloque", () => {
    expect(seOfreceClientes("admin")).toBe(true);
    expect(seOfreceClientes("manager")).toBe(false);
    const dialogo = leer("src/components/UserDialog.tsx");
    expect(dialogo).toContain("(m.offeredTo?.(u.role) ?? true)");
    const constantes = leer("src/lib/constants.ts");
    expect(constantes).toContain("offeredTo: (role) => seOfreceClientes(role),");
  });
});
