import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { accessibleModules, knownModules, landingRoute, MODULES, MODULE_ACCESS } from "@/lib/constants";
import { securityLabel } from "@/lib/security-log";
import { COLUMNAS, COLUMNAS_DE_LA_182, COLUMNAS_DE_LA_189, COLUMNAS_DE_LA_193, COLUMNAS_DE_LA_195, COLUMNAS_DE_LA_197, COLUMNAS_DE_LA_198, COLUMNAS_SIN_182, COLUMNAS_SIN_189, COLUMNAS_SIN_193, COLUMNAS_SIN_195, COLUMNAS_SIN_197, COLUMNAS_SIN_198, faltaLa182, leeConRespaldo } from "./almacen";
import { CAMPOS_DE_UNION, motivoDeDuplicado } from "./duplicados";
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
  it("se viste con el tema de Inventario: su hoja, su ancla data-app y su barra (la superior, D-622); y la hoja emite las clases de /customers", () => {
    expect(layout).toContain('import "@/app/erp/erp.css";');
    // D-622 (2026-10-21): la barra es la superior de Entregas, en el flujo; el `ErpNavProvider` que reservaba el
    // hueco de la barra lateral se fue con ella.
    expect(layout).toContain('const cascaron = <div data-app="erp">{children}</div>;');
    expect(layout).not.toContain("<ErpNavProvider>");
    const css = leer("src/app/erp/erp.css");
    for (const s of ['@source "../customers";', '@source "../../components/customers";', '@source "../../lib/customers";']) expect(css).toContain(s);
    const barra = leer("src/components/customers/barra.tsx");
    expect(barra).toContain('import { SideNav } from "@/components/erp/side-nav";');
    // Desde la 189, dos pestañas: la lista y la cola «Decidir si se juntan» con las pendientes.
    expect(barra).toContain('{ href: "/customers", label: t("Customers", "Clientes") },');
    expect(barra).toContain('...(role === "admin" ? [{ href: "/customers/juntar", label: rotuloDeDecidir(pendientes, t) }] : []),'); // D-748: solo admin
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
    // Y la empresa, la 189.
    const la189 = leer("supabase/migrations/189_clientes_empresas.sql");
    // Y los contactos, la 193 (D-668).
    const la193 = leer("supabase/migrations/193_clientes_contactos.sql");
    // Y los impuestos y el sitio web, la 195 (D-672).
    const la195 = leer("supabase/migrations/195_clientes_impuestos_y_archivos.sql");
    // Y las redes sociales, la 197 (D-682).
    const la197 = leer("supabase/migrations/197_clientes_redes_sociales.sql");
    // Y el vendedor, la 198 (D-683).
    const la198 = leer("supabase/migrations/198_clientes_vendedor.sql");
    const dondeEsta = (col: string) => {
      if ((COLUMNAS_DE_LA_198 as readonly string[]).includes(col)) expect(la198, col).toMatch(new RegExp(`alter table erp\\.customers add column if not exists ${col}\\s`));
      else if ((COLUMNAS_DE_LA_197 as readonly string[]).includes(col)) expect(la197, col).toMatch(new RegExp(`alter table erp\\.customers add column if not exists ${col}\\s`));
      else if ((COLUMNAS_DE_LA_195 as readonly string[]).includes(col)) expect(la195, col).toMatch(new RegExp(`alter table erp\\.customers add column if not exists ${col}\\s`));
      else if ((COLUMNAS_DE_LA_193 as readonly string[]).includes(col)) expect(la193, col).toMatch(new RegExp(`alter table erp\\.customers add column if not exists ${col}\\s`));
      else if ((COLUMNAS_DE_LA_189 as readonly string[]).includes(col)) expect(la189, col).toMatch(new RegExp(`alter table erp\\.customers add column if not exists ${col}\\s`));
      else if (col === "archived_at" || col === "archived_reason") expect(alter181, col).toMatch(new RegExp(`add column if not exists ${col}\\s`));
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
    // Sin la 182 (ni la 189, la 193, la 195 ni la 197): sin socials, sin impuestos, sin contacts, sin company_id, que también fallan, y luego sin las tres.
    const r = await leeConRespaldo(async (cols) => { pedidas.push(cols); return pedidas.length < 7 ? { data: null, error: { code: "42703", message: "column crm_type_store does not exist" } } : { data: [{ id: 1 }], error: null }; });
    expect(pedidas).toEqual([COLUMNAS, COLUMNAS_SIN_198, COLUMNAS_SIN_197, COLUMNAS_SIN_195, COLUMNAS_SIN_193, COLUMNAS_SIN_189, COLUMNAS_SIN_182]);
    expect(r.data).toEqual([{ id: 1 }]);
    for (const col of COLUMNAS_DE_LA_189) { expect(COLUMNAS).toContain(col); expect(COLUMNAS_SIN_189).not.toContain(col); expect(COLUMNAS_SIN_182).not.toContain(col); }
    expect(COLUMNAS_SIN_189).toContain("crm_type_store");
    // Con la 182 y sin la 189 (ni la 193): quitar contacts no basta; quitar también company_id, sí.
    const solo189: string[] = [];
    const r189 = await leeConRespaldo(async (cols) => { solo189.push(cols); return solo189.length < 6 ? { data: null, error: { code: "42703", message: "column customers.company_id does not exist" } } : { data: [{ id: 2 }], error: null }; });
    expect(solo189).toEqual([COLUMNAS, COLUMNAS_SIN_198, COLUMNAS_SIN_197, COLUMNAS_SIN_195, COLUMNAS_SIN_193, COLUMNAS_SIN_189]);
    expect(r189.data).toEqual([{ id: 2 }]);
    // D-668: con todo menos la 193, basta quitar contacts; y las demás siguen ahí.
    for (const col of COLUMNAS_DE_LA_193) { expect(COLUMNAS).toContain(col); expect(COLUMNAS_SIN_193).not.toContain(col); expect(COLUMNAS_SIN_189).not.toContain(col); }
    expect(COLUMNAS_SIN_193).toContain("company_id");
    const solo193: string[] = [];
    const r193 = await leeConRespaldo(async (cols) => { solo193.push(cols); return solo193.length < 5 ? { data: null, error: { code: "PGRST204", message: "Could not find the 'contacts' column" } } : { data: [{ id: 3 }], error: null }; });
    expect(solo193).toEqual([COLUMNAS, COLUMNAS_SIN_198, COLUMNAS_SIN_197, COLUMNAS_SIN_195, COLUMNAS_SIN_193]);
    expect(r193.data).toEqual([{ id: 3 }]);
    // D-672: con todo menos la 195, basta quitar sus dos.
    for (const col of COLUMNAS_DE_LA_195) { expect(COLUMNAS).toContain(col); expect(COLUMNAS_SIN_195).not.toContain(col); expect(COLUMNAS_SIN_193).not.toContain(col); }
    expect(COLUMNAS_SIN_195).toContain("contacts");
    const solo195: string[] = [];
    const r195 = await leeConRespaldo(async (cols) => { solo195.push(cols); return solo195.length < 4 ? { data: null, error: { code: "42703", message: "column customers.tax_terms does not exist" } } : { data: [{ id: 4 }], error: null }; });
    expect(solo195).toEqual([COLUMNAS, COLUMNAS_SIN_198, COLUMNAS_SIN_197, COLUMNAS_SIN_195]);
    expect(r195.data).toEqual([{ id: 4 }]);
    // D-682: con todo menos la 197, basta quitar socials; y las demás siguen ahí.
    for (const col of COLUMNAS_DE_LA_197) { expect(COLUMNAS).toContain(col); expect(COLUMNAS_SIN_197).not.toContain(col); expect(COLUMNAS_SIN_195).not.toContain(col); }
    expect(COLUMNAS_SIN_197).toContain("tax_terms");
    const solo197: string[] = [];
    const r197 = await leeConRespaldo(async (cols) => { solo197.push(cols); return solo197.length < 3 ? { data: null, error: { code: "42703", message: "column customers.socials does not exist" } } : { data: [{ id: 5 }], error: null }; });
    expect(solo197).toEqual([COLUMNAS, COLUMNAS_SIN_198, COLUMNAS_SIN_197]);
    expect(r197.data).toEqual([{ id: 5 }]);
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

describe("la lista: cabecera bloqueada y barra de arriba (D-649, como Órdenes en D-398)", () => {
  const lista = readFileSync("src/app/customers/Clientes.tsx", "utf8");
  it("la caja tiene alto propio y se desplaza ella; la cabecera se pega arriba; la barra de arriba mueve ESA caja", () => {
    expect(lista).toContain('<div ref={cajaRef} data-caja-de-clientes className="max-h-[calc(100dvh-150px)] overflow-auto');
    expect(lista).toMatch(/<thead className="sticky top-0 z-10 bg-slate-50/);
    expect(lista).toContain("<BarraSuperior caja={cajaRef} />");
    expect(lista.indexOf("<BarraSuperior caja={cajaRef} />")).toBeGreaterThan(-1);
    expect(lista.indexOf("<BarraSuperior caja={cajaRef} />")).toBeLessThan(lista.indexOf("data-caja-de-clientes"));
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
    expect(pagina).toContain("<FichaCompleta cliente={cliente} hermanas={hermanas} puedeEditar={puedeEditar(role)} esVendedor={esVendedor(role)} />");
  });
  it("«✏️ Editar» (D-648): solo para quien puede editar, abre la VENTANA de la lista con ese cliente ya editando (D-654) y quita el parámetro", () => {
    expect(ficha).toContain("{puedeEditar && (");
    expect(ficha).toContain("href={`/customers?editar=${c.id}`}");
    expect(lista).toContain('new URLSearchParams(window.location.search).get("editar")');
    expect(lista).toContain("if (c) setFicha({ tipo: \"ver\", cliente: c, editar: true });");
    expect(lista).toContain('editarAlAbrir={ficha.tipo === "ver" && ficha.editar === true}');
    expect(lista).toContain('if (editarPendiente == null || estado.tipo !== "listo") return;');
    expect(lista).toContain("window.history.replaceState(null, \"\", window.location.pathname)");
  });
  it("la página pinta las MISMAS tarjetas que la ventana (D-654), y arriba el nombre sin «tienda · tienda+cuenta»", () => {
    expect(ficha).toContain("<TarjetasDeLaFicha cliente={c} esVendedor={esVendedor} t={t} />");
    expect(ficha).toContain('import { TarjetasDeLaFicha } from "../FichaDeCliente";');
    expect(ficha).toContain('<h1 className="text-2xl font-semibold">{c.account}</h1>');
    expect(ficha).not.toContain("valorDeColumna");
    expect(ficha).not.toContain("nombreDeTienda(c.store)} · ");
    expect(ficha).toContain('{t("← Customers", "← Clientes")}');
  });
  it("D-654: el clic en la fila abre la VENTANA (no el cajón lateral), y la fila ya no lleva el enlace «ficha»", () => {
    expect(lista).toContain("onClick={() => { if (abrible) setFicha({ tipo: \"ver\", cliente: c }); }}");
    expect(lista).toContain("<FichaEnVentana");
    expect(lista).toContain('import { FichaEnVentana, selCls } from "./FichaDeCliente";');
    expect(lista).not.toContain("function FichaDeCliente");
    expect(lista).not.toContain("fixed inset-0 z-50 flex justify-end");
    expect(lista).not.toContain('{t("details", "ficha")}');
    expect(lista).not.toContain('"Ficha completa →"');
    const ventana = leer("src/app/customers/FichaDeCliente.tsx");
    expect(ventana).not.toContain('"Ficha completa →"');
    // Se cierra con la regla probada (`cierraLaFicha`): Escape, y el clic en el fondo que empezó en el fondo; ✕ siempre.
    expect(ventana).toContain("cierraLaFicha({ tecla: e.key })");
    expect(ventana).toContain("cierraLaFicha({ clicEnElFondo: e.target === e.currentTarget, empezoEnElFondo: fueraRef.current })");
    expect(ventana).toContain("onMouseDown={(e) => { fueraRef.current = e.target === e.currentTarget; }}");
    expect(ventana).toContain('<button type="button" onClick={pedirCierre}');
  });
  it("las columnas se guardan por persona (clave con el id del usuario) y el selector mueve", () => {
    expect(lista).toContain("claveDeColumnasDeClientes(userId)");
    expect(lista).not.toContain('"customers_cols"');
    expect(lista).toContain("mover={{");
    expect(lista).toContain("onMueve: (key, delta) => cambiaColumnas((p) => mueveColumnaDeClientes(p, key, delta)),");
    expect(leer("src/app/customers/page.tsx")).toContain('userId={user?.id ?? "anon"}');
  });
});

describe("D-570 · solo admins por ahora (quitado en D-683, vuelto a poner en D-NEXT)", async () => {
  const { CLIENTES_SOLO_ADMINS, puedeEntrarAClientes, seOfreceClientes } = await import("./reglas");
  it("el interruptor está PUESTO: solo el admin entra, tenga o no la casilla; los demás no, aunque la tengan", () => {
    expect(CLIENTES_SOLO_ADMINS).toBe(true);
    expect(puedeEntrarAClientes({ role: "admin", module_access: [] })).toBe(true);
    for (const role of ["manager", "sales", "accounting", "logistics", "warehouse", "driver"]) {
      expect(puedeEntrarAClientes({ role, module_access: ["customers"] })).toBe(false);
      expect(puedeEntrarAClientes({ role, module_access: ["leads"] })).toBe(false);
    }
    expect(puedeEntrarAClientes(null)).toBe(false);
    // Y el hub no enseña la tarjeta a quien la puerta va a rebotar.
    expect(leer("src/components/HomeSelector.tsx")).toContain('.filter((m) => m.key !== "customers" || puedeEntrarAClientes(me))');
  });
  it("la casilla de Usuarios se ofrece solo al admin, y el diálogo pregunta antes de dibujar el bloque", () => {
    expect(seOfreceClientes("admin")).toBe(true);
    expect(seOfreceClientes("manager")).toBe(false);
    const dialogo = leer("src/components/UserDialog.tsx");
    expect(dialogo).toContain("(m.offeredTo?.(u.role) ?? true)");
    const constantes = leer("src/lib/constants.ts");
    expect(constantes).toContain("offeredTo: (role) => seOfreceClientes(role),");
  });
});

/**
 * 2026-10-21. El dueño: «analices toda la lista otra vez y ver los que son obviamente duplicados, hacerle un merge […]
 * tiene que irse a un site que dice Decide to Merge». La 189: la empresa, la cola y las dos funciones. Lo que HACEN se
 * midió con el ensayo del guion (`junta-clientes-duplicados.mts --ensayo`, BEGIN … ROLLBACK contra producción); aquí se
 * fija su texto, y sobre todo que la base y la app juntan con la MISMA lista de campos.
 */
describe("la 189 · empresas, juntar y la cola", () => {
  const sql189 = leer("supabase/migrations/189_clientes_empresas.sql");
  const [cuerpo189] = sql189.split("-- @ledger-below");
  const sinComentarios189 = cuerpo189.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const junta = /create or replace function erp\.junta_clientes\(p_a bigint, p_b bigint\)[\s\S]*?\nend \$\$;/.exec(cuerpo189)![0];
  const rechaza = /create or replace function erp\.rechaza_sugerencia_de_clientes\(p_id bigint\)[\s\S]*?\nend \$\$;/.exec(cuerpo189)![0];

  it("la función de la base junta con la MISMA lista de campos, etiquetas y comparación que la app (CAMPOS_DE_UNION)", () => {
    const lista = /campos constant text\[\] := array\[([\s\S]*?)\n  \];/.exec(junta)![1];
    const textos = [...lista.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const triples: string[][] = [];
    for (let i = 0; i < textos.length; i += 3) triples.push(textos.slice(i, i + 3));
    expect(triples).toEqual(CAMPOS_DE_UNION.map((c) => [...c]));
  });
  it("y las mismas reglas: la superviviente es la de id menor, la otra se archiva con el motivo de la app, y la nota dice lo mismo", () => {
    expect(junta).toContain("upper(btrim(store)) = tienda order by id limit 1;");
    expect(junta).toContain("archived_reason = 'duplicado: unido a #' || s.id");
    expect(motivoDeDuplicado(41)).toBe("duplicado: unido a #41");
    expect(junta).toContain("'Del duplicado #' || o.id || ': '");
    expect(junta).toContain("'sin datos distintos'");
    expect(junta).toContain("'Del duplicado #' || o.id || ' (notas): '");
    // La empresa que queda: la de la fila más vieja de las dos empresas (como `juntaEnMemoria`).
    expect(junta).toContain("where c.company_id in (a.company_id, b.company_id) order by c.id limit 1;");
    // Lo que se escribe en la superviviente es cada campo de la lista (menos la cuenta) y las notas.
    const sets = [...junta.matchAll(/(\w+) = r\.(\w+)/g)].map((m) => m[1]);
    expect(sets.sort()).toEqual([...CAMPOS_DE_UNION.filter(([, , como]) => como !== "n").map(([k]) => k), "notes"].sort());
  });
  it("company_id es uuid, no nulo, cada fila el suyo al nacer; con índice", () => {
    expect(sinComentarios189).toContain("alter table erp.customers add column if not exists company_id uuid not null default gen_random_uuid();");
    expect(sinComentarios189).toContain("create index if not exists customers_company_idx on erp.customers (company_id);");
  });
  it("la cola: par ordenado y único, los estados que lee la app, y nadie escribe directo (solo select), con la puerta del módulo", () => {
    expect(sinComentarios189).toContain("constraint customer_merge_suggestions_par_ordenado check (a_id < b_id)");
    expect(sinComentarios189).toContain("constraint customer_merge_suggestions_par_unico unique (a_id, b_id)");
    expect(sinComentarios189).toContain("check (status in ('pending', 'merged', 'rejected', 'superseded'))");
    expect(sinComentarios189).toContain("revoke all on erp.customer_merge_suggestions from public, anon, authenticated;");
    expect(sinComentarios189).toContain("grant select on erp.customer_merge_suggestions to authenticated;");
    expect(sinComentarios189).not.toMatch(/grant (insert|update|delete|all)[^;]*customer_merge_suggestions/i);
    expect(sinComentarios189).toMatch(/as restrictive for all to authenticated\n  using \(\(select public\.has_customers_access\(\)\)\)/);
  });
  it("las dos funciones: SECURITY DEFINER, solo quien puede editar clientes (customers_can_write), y anon no las ejecuta", () => {
    for (const fn of [junta, rechaza]) {
      expect(fn).toContain("security definer set search_path = public, pg_temp");
      expect(fn).toMatch(/is not null and not erp\.customers_can_write\(\) then\n    raise exception '[^']+' using errcode = '42501';/);
    }
    expect(sinComentarios189).toContain("revoke execute on function erp.junta_clientes(bigint, bigint) from public, anon;");
    expect(sinComentarios189).toContain("revoke execute on function erp.rechaza_sugerencia_de_clientes(bigint) from public, anon;");
    expect(rechaza).toContain("where id = p_id and status = 'pending';");
    expect(junta).toContain("raise exception 'An archived customer is not merged'");
  });
  it("sin begin/commit propios, con su reversión, y el checksum del registro es el del cuerpo", () => {
    expect(sinComentarios189).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql189).toContain("-- Reversion (en este orden):");
    expect(sinComentarios189).not.toMatch(/insert into erp\.customers|update erp\.customers set archived_at = null/i);
    const sha = createHash("sha256").update(cuerpo189).digest("hex");
    expect(sql189).toContain(`values ('189_clientes_empresas.sql', '${sha}')`);
  });
  it("el guion de una vez usa las funciones de la app, llama a la de la base, compara, y en seco no escribe", () => {
    const g = leer("scripts/junta-clientes-duplicados.mts");
    expect(g).toContain('from "../src/lib/customers/duplicados.ts";');
    expect(g).toContain('await c.query("select erp.junta_clientes($1, $2)", [a, b]);');
    expect(g).toContain("const dif = comparar(plan.filas, despues);");
    expect(g).toContain('if (!escribe && !ensayo) await c.query("set default_transaction_read_only = on");');
    expect(g).toContain("on conflict (a_id, b_id) do nothing");
    // El respaldo se escribe ANTES de abrir la transacción.
    expect(g.indexOf("writeFileSync(ruta,")).toBeGreaterThan(0);
    expect(g.indexOf("writeFileSync(ruta,")).toBeLessThan(g.indexOf('await c.query("begin");\n    try {\n      await juntaYLlena(filas);'));
  });
  it("la pantalla: la lista por empresa, la ficha con pestañas, la cola llama a la base, y las rutas cuelgan del layout", () => {
    const lista = leer("src/app/customers/Clientes.tsx");
    expect(lista).toContain("const empresas = useMemo(() => agrupaEnEmpresas(listaConEncontrados, filtro), [listaConEncontrados, filtro]);");
    expect(lista).toContain("ordenarEmpresas(filtraEmpresas(empresas, filtrosCol), ordenes)");
    expect(lista).toContain("hermanas={ficha.tipo === \"ver\" ? filasDeLaEmpresa(lista,");
    expect(leer("src/app/customers/FichaDeCliente.tsx")).toContain('role="tablist"');
    const cola = leer("src/app/customers/juntar/DecidirJuntar.tsx");
    expect(cola).toContain("await almacen.juntar(p.a.id, p.b.id);");
    expect(cola).toContain("await almacen.rechazar(p.sugerencia.id);");
    expect(cola).toContain("paresParaDecidir(sugs, lista)");
    expect(readdirSync("src/app/customers/juntar")).toEqual(expect.arrayContaining(["page.tsx", "DecidirJuntar.tsx"]));
    const pagina = leer("src/app/customers/[id]/page.tsx");
    expect(pagina).toContain('erp.from("customers").select(cols).eq("company_id", cliente.company_id!)');
  });
});
