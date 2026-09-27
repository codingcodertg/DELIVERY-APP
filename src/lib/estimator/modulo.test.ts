import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { accessibleModules, knownModules, landingRoute, MODULES, MODULE_ACCESS } from "@/lib/constants";
import { appForPath } from "@/lib/app-for-path";
import { APP_VERSIONS } from "@/lib/app-versions";
import { securityLabel } from "@/lib/security-log";

/**
 * El Estimador existe como módulo igual que RTG PROMOS (T-0408): tarjeta, casilla, puerta, versión
 * propia, y la palabra de la base (148) igual que la del código.
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const enModulos = MODULES.find((m) => m.key === "estimator");
const enAcceso = MODULE_ACCESS.find((m) => m.key === "estimator");
const SQL = "supabase/migrations/148_estimator.sql";

describe("la tarjeta y la casilla", () => {
  it("es una tarjeta del hub hacia /estimator", () => {
    expect(enModulos?.href).toBe("/estimator");
    expect(accessibleModules(["estimator"]).map((m) => m.key)).toEqual(["estimator"]);
    expect(accessibleModules(["promos"]).map((m) => m.key)).not.toContain("estimator");
  });
  it("una casilla en module_access, sin escalafón y con su nota", () => {
    expect(enAcceso?.accessColumn).toBe("module_access");
    expect(enAcceso?.roleColumn).toBeUndefined();
    expect(enAcceso?.roleKeys).toEqual([]);
    expect(enAcceso?.roleNote?.es).toMatch(/aprobación/);
  });
  it("knownModules no la tira al escribir (D-217)", () => {
    expect(knownModules(["clockin", "estimator"])).toEqual(["estimator"]);
  });
  it("con solo el Estimador se entra directo; con dos, al hub", () => {
    expect(landingRoute({ role: "sales", module_access: ["estimator"] })).toBe("/estimator");
    expect(landingRoute({ role: "sales", module_access: ["deliveries", "estimator"] })).toBe("/home");
  });
  it("el diálogo de Usuarios escribe por su propia función y no reclama rol", () => {
    const dialogo = leer("src/components/UserDialog.tsx");
    expect(dialogo).toContain("updateUserEstimatorAccess(u.id, { granted });");
    expect(dialogo.match(/case "estimator":/g) ?? []).toHaveLength(2);
    const prov = leer("src/lib/data-provider.tsx");
    expect(prov).toContain('void logSecurityClient(userId, "estimator_access_changed"');
    expect(securityLabel("estimator_access_changed", "es")).toBe("Acceso al Estimador cambiado");
  });
});

describe("la versión y la ruta", () => {
  it("versión propia, y /estimator no cae en deliveries", () => {
    expect(APP_VERSIONS.estimator).toMatch(/^\d+\.\d+\.\d+$/);
    expect(appForPath("/estimator")).toBe("estimator");
    expect(appForPath("/estimatorx")).toBe("deliveries");
  });
});

describe("la puerta", () => {
  const layout = leer("src/app/estimator/layout.tsx");
  it("comprueba el acceso en el servidor; el admin siempre entra", () => {
    expect(layout).toContain('const tieneEstimador = role === "admin" || !!profile?.module_access?.includes("estimator");');
    expect(layout).toContain("if (!tieneEstimador) {");
    expect(layout).toContain('redirect("/login?next=/estimator")');
  });
  it("un fallo de lectura del perfil no redirige (D-234)", () => {
    const desde = layout.indexOf('=== "fallo"');
    const hasta = layout.indexOf("const role =");
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    expect(layout.slice(desde, hasta)).not.toContain("redirect(");
  });
  it("tiene cómo volver al hub", () => {
    expect(leer("src/app/estimator/Estimador.tsx")).toMatch(/<Link href="\/home"/);
  });
});

describe("la 148", () => {
  const sql = leer(SQL);
  const [cuerpo] = sql.split("-- @ledger-below");

  it("la palabra de la base es la del código, y parte de la 140 (no pierde promos ni recupera clockin)", () => {
    expect(sql).toContain("array['deliveries','recruiting','timetracker','erp','promos','estimator']");
    const lista = /module_access <@ array\[([^\]]+)\]\)\n  not valid;/.exec(cuerpo)![1];
    expect(lista).not.toContain("clockin");
    const claves = MODULE_ACCESS.map((m) => `'${m.key}'`).sort();
    expect(lista.split(",").sort()).toEqual(claves);
  });
  it("una cotización por estimado, sin mayúsculas ni espacios que las separen", () => {
    expect(cuerpo).toContain("create unique index if not exists estimator_quotes_one_per_estimate\n  on public.estimator_quotes (lower(btrim(estimate_num)));");
  });
  it("sin DELETE ni FOR ALL, y todas las políticas miran el módulo", () => {
    expect(cuerpo).toContain("grant select, insert, update on public.estimator_quotes    to authenticated;");
    expect(cuerpo).not.toMatch(/grant [^;]*delete[^;]*estimator/i);
    const politicas = [...cuerpo.matchAll(/create policy "([^"]+)" on public\.estimator_\w+ for (\w+)/g)];
    expect(politicas.map((m) => m[2]).sort()).toEqual(["insert", "insert", "select", "select", "update", "update"]);
  });
  it("editar: dueño, admin o aprobado — ver la de un compañero de tienda no da para editar", () => {
    const update = /create policy "estimator_quotes update"[\s\S]*?;\n/.exec(cuerpo)![0];
    expect(update).toContain("owner_id = (select auth.uid()) or public.estimator_has_approval(id)");
    expect(update).not.toContain("estimator_my_store");
    const select = /create policy "estimator_quotes select"[\s\S]*?;\n/.exec(cuerpo)![0];
    expect(select).toContain("store = (select public.estimator_my_store())");
  });
  it("el dueño lo pone la base, no el navegador", () => {
    expect(cuerpo).toMatch(/if not public\.is_admin\(\) or new\.owner_id is null then\s+new\.owner_id := yo;/);
    expect(cuerpo).toContain("raise exception 'Only an admin can change who owns an estimate'");
  });
  it("buscar un estimado no devuelve NADA del cliente", () => {
    const f = /create or replace function public\.estimator_find_estimate[\s\S]*?\$\$;/.exec(cuerpo)![0];
    expect(f).not.toMatch(/customer|lines|delivery|sales_ext/);
  });
  it("los helpers que leen las tablas se crean DESPUÉS de las tablas (una función sql se valida al crearla)", () => {
    expect(cuerpo.indexOf("function public.estimator_is_quote_owner")).toBeGreaterThan(cuerpo.indexOf("create table if not exists public.estimator_approvals"));
    expect(cuerpo.indexOf("function public.estimator_has_approval")).toBeGreaterThan(cuerpo.indexOf("create table if not exists public.estimator_approvals"));
  });
  it("sin begin/commit propios y sin D-NNN dentro", () => {
    expect(cuerpo.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).not.toMatch(/D-\d{3}|D-NEXT/);
  });
  it("el checksum del registro es el del cuerpo", () => {
    const sha = createHash("sha256").update(cuerpo).digest("hex");
    expect(sql).toContain(`values ('148_estimator.sql', '${sha}')`);
  });
});
