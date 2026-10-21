import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { accessibleModules, knownModules, landingRoute, MODULES, MODULE_ACCESS } from "@/lib/constants";
import { securityLabel } from "@/lib/security-log";
import { COLUMNAS, COLUMNAS_DE_LA_182, COLUMNAS_SIN_182, faltaLa182, leeConRespaldo } from "./almacen";
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
  it("se viste con el tema de Inventario: su hoja, su ancla data-app y su barra (la superior, D-NEXT); y la hoja emite las clases de /customers", () => {
    expect(layout).toContain('import "@/app/erp/erp.css";');
    // D-NEXT (2026-10-21): la barra es la superior de Entregas, en el flujo; el `ErpNavProvider` que reservaba el
    // hueco de la barra lateral se fue con ella.
    expect(layout).toContain('const cascaron = <div data-app="erp">{children}</div>;');
    expect(layout).not.toContain("<ErpNavProvider>");
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
    // Las dos de archivado las añade la 181 (`add column if not exists`), no la tabla de la 180.
    const la181 = leer("supabase/migrations/181_clientes_archivados.sql");
    const alter181 = /alter table erp\.customers\n([\s\S]*?);/.exec(la181)![1];
    // Y las tres del CRM, la 182.
    const alter182 = /alter table erp\.customers\n([\s\S]*?);/.exec(leer("supabase/migrations/182_clientes_crm.sql"))![1];
    const dondeEsta = (col: string) => {
      if (col === "archived_at" || col === "archived_reason") expect(alter181, col).toMatch(new RegExp(`add column if not exists ${col}\\s`));
      else if ((COLUMNAS_DE_LA_182 as readonly string[]).includes(col)) expect(alter182, col).toMatch(new RegExp(`add column if not exists ${col}\\s`));
      else expect(tabla, col).toMatch(new RegExp(`\\n  ${col}\\s`));
    };
    for (const col of COLUMNAS.split(",").map((c) => c.trim())) dondeEsta(col);
    for (const campo of CAMPOS) dondeEsta(campo.key);
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

/**
 * 2026-10-18. El dueño: «the crm stuff in the customer is missing» y «when pressing a cutomer show all details and i mean
 * all details that were giving the intiial excel have the buttom of the fuull detail like the erp has with every item».
 */
describe("la 182 · las tres del CRM", () => {
  const sql182 = leer("supabase/migrations/182_clientes_crm.sql");
  const [cuerpo182] = sql182.split("-- @ledger-below");
  const sinComentarios182 = cuerpo182.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("añade exactamente crm_type_store, crm_type_group y associated_with, de texto, sin check, y nada más", () => {
    const adds = [...sinComentarios182.matchAll(/add column if not exists (\w+) (\w+)/g)].map((m) => [m[1], m[2]]);
    expect(adds).toEqual([["crm_type_store", "text"], ["crm_type_group", "text"], ["associated_with", "text"]]);
    expect(sinComentarios182).not.toMatch(/check\s*\(/i);
    expect(sinComentarios182).not.toMatch(/create policy|create index|create or replace function|insert into erp\.customers|update erp\.customers/i);
    expect(sinComentarios182).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql182).not.toMatch(/D-\d{3}/);
    expect(sql182).toContain("-- Reversion:");
    expect([...adds.map((a) => a[0])].sort()).toEqual([...COLUMNAS_DE_LA_182].sort());
  });
  it("el checksum del registro es el del cuerpo", () => {
    const sha = createHash("sha256").update(cuerpo182).digest("hex");
    expect(sql182).toContain(`values ('182_clientes_crm.sql', '${sha}')`);
  });
  it("el código llega antes que la migración: si la base no tiene una columna, se vuelve a leer sin las tres de la 182", async () => {
    expect(faltaLa182({ code: "42703" })).toBe(true);
    expect(faltaLa182({ code: "PGRST204" })).toBe(true);
    expect(faltaLa182({ code: "42501" })).toBe(false);
    expect(faltaLa182(null)).toBe(false);
    for (const col of COLUMNAS_DE_LA_182) { expect(COLUMNAS).toContain(col); expect(COLUMNAS_SIN_182).not.toContain(col); }
    expect(COLUMNAS_SIN_182).toContain("archived_reason");
    const pedidas: string[] = [];
    const r = await leeConRespaldo(async (cols) => { pedidas.push(cols); return pedidas.length === 1 ? { data: null, error: { code: "42703", message: "column crm_type_store does not exist" } } : { data: [{ id: 1 }], error: null }; });
    expect(pedidas).toEqual([COLUMNAS, COLUMNAS_SIN_182]);
    expect(r.data).toEqual([{ id: 1 }]);
    // Otro error no se reintenta: se devuelve tal cual.
    const otras: string[] = [];
    const r2 = await leeConRespaldo(async (cols) => { otras.push(cols); return { data: null, error: { code: "42501", message: "permission denied" } }; });
    expect(otras).toEqual([COLUMNAS]);
    expect(r2.error?.code).toBe("42501");
  });
  it("el importador lee las tres y las escribe con coalesce (re-importar rellena solo lo nuevo)", () => {
    const g = leer("scripts/importa-clientes.mjs");
    for (const col of COLUMNAS_DE_LA_182) expect(g).toContain(`"${col}"`);
    expect(g).toContain('"CRM TYPE: STORE": "crm_type_store"');
    expect(g).toContain('"CRM TYPE: GROUP": "crm_type_group"');
    expect(g).toContain('"ASSOCIATED WITH": "associated_with"');
  });
});

describe("la ficha completa (/customers/[id]) y el orden de columnas por persona", () => {
  const pagina = leer("src/app/customers/[id]/page.tsx");
  const ficha = leer("src/app/customers/[id]/FichaCompleta.tsx");
  const lista = leer("src/app/customers/Clientes.tsx");

  it("la página existe bajo el layout de Clientes (misma puerta, D-570), lee la fila con la sesión de quien mira, y un id que no está es 404", () => {
    expect(readdirSync("src/app/customers")).toContain("layout.tsx");
    expect(readdirSync("src/app/customers/[id]")).toEqual(expect.arrayContaining(["page.tsx", "FichaCompleta.tsx"]));
    expect(pagina).toContain('import { createClient as createErpClient } from "@/lib/erp/supabase/server";');
    expect(pagina).toContain('erp.from("customers").select(cols).eq("id", n).maybeSingle()');
    expect(pagina).toContain("if (!data) notFound();");
    expect(pagina).toContain("if (!Number.isInteger(n) || n <= 0) notFound();");
    expect(pagina).not.toMatch(/service_role|SUPABASE_SERVICE/i);
    expect(pagina).toContain("<FichaCompleta cliente={cliente} />");
  });
  it("la ficha pinta cada campo por grupo (camposPorGrupo/textoDeCampo), House # y la CONCATENATE, con el cascarón del ERP", () => {
    expect(ficha).toContain("camposPorGrupo().map(({ grupo, campos }) =>");
    expect(ficha).toContain("{textoDeCampo(c, campo, t)}");
    expect(ficha).toContain('data-campo="house_no"');
    expect(ficha).toContain('data-campo="concatenate"');
    expect(ficha).toContain('valorDeColumna(c, "concatenate")');
    expect(ficha).toContain('className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"');
    expect(ficha).toContain('{t("← Customers", "← Clientes")}');
  });
  it("el botón «Ficha completa» está en la fila (sin abrir el cajón) y en el cajón", () => {
    expect(lista).toContain("href={`/customers/${c.id}`}");
    expect(lista).toContain("onClick={(e) => e.stopPropagation()}");
    expect(lista).toContain("href={`/customers/${cliente.id}`}");
    expect(lista).toContain('{t("Full details →", "Ficha completa →")}');
  });
  it("las columnas se guardan por persona (clave con el id del usuario) y el selector mueve", () => {
    expect(lista).toContain("claveDeColumnasDeClientes(userId)");
    expect(lista).not.toContain('"customers_cols"');
    expect(lista).toContain("mover={{");
    expect(lista).toContain("onMueve: (key, delta) => cambiaColumnas((p) => mueveColumnaDeClientes(p, key, delta)),");
    expect(leer("src/app/customers/page.tsx")).toContain('userId={user?.id ?? "anon"}');
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
