import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { accessibleModules, knownModules, landingRoute, MODULES, MODULE_ACCESS } from "@/lib/constants";
import { appForPath } from "@/lib/app-for-path";
import { APP_VERSIONS } from "@/lib/app-versions";
import { securityLabel } from "@/lib/security-log";
import { AREA_KEYS } from "./areas";

/**
 * «Encuestas» existe como módulo igual que el Estimador (migración 155): tarjeta, casilla, puerta, versión propia,
 * la palabra de la base igual que la del código; y la 155 dice lo que promete sobre el rol del sitio público.
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const enModulos = MODULES.find((m) => m.key === "surveys");
const enAcceso = MODULE_ACCESS.find((m) => m.key === "surveys");
const SQL = "supabase/migrations/155_encuestas.sql";

describe("la tarjeta y la casilla", () => {
  it("es una tarjeta del hub hacia /surveys", () => {
    expect(enModulos?.href).toBe("/surveys");
    expect(accessibleModules(["surveys"]).map((m) => m.key)).toEqual(["surveys"]);
    expect(accessibleModules(["estimator"]).map((m) => m.key)).not.toContain("surveys");
  });
  it("una casilla en module_access, sin escalafón, y la nota avisa de los datos de contacto", () => {
    expect(enAcceso?.accessColumn).toBe("module_access");
    expect(enAcceso?.roleColumn).toBeUndefined();
    expect(enAcceso?.roleKeys).toEqual([]);
    expect(enAcceso?.roleNote?.es).toMatch(/teléfono y correo/);
  });
  it("knownModules no la tira al escribir (D-217)", () => {
    expect(knownModules(["clockin", "surveys"])).toEqual(["surveys"]);
  });
  it("con solo Encuestas se entra directo; con dos, al hub", () => {
    expect(landingRoute({ role: "sales", module_access: ["surveys"] })).toBe("/surveys");
    expect(landingRoute({ role: "admin", module_access: ["deliveries", "surveys"] })).toBe("/home");
  });
  it("el diálogo de Usuarios escribe por su propia función y no reclama rol", () => {
    const dialogo = leer("src/components/UserDialog.tsx");
    expect(dialogo).toContain("updateUserSurveysAccess(u.id, { granted });");
    expect(dialogo.match(/case "surveys":/g) ?? []).toHaveLength(2);
    const prov = leer("src/lib/data-provider.tsx");
    expect(prov).toContain('void logSecurityClient(userId, "surveys_access_changed"');
    expect(prov).toContain('? Array.from(new Set([...actuales, "surveys"]))');
    expect(securityLabel("surveys_access_changed", "es")).toBe("Acceso a Encuestas cambiado");
  });
});

describe("la versión y la ruta", () => {
  it("versión propia, y /surveys no cae en deliveries", () => {
    expect(APP_VERSIONS.surveys).toMatch(/^\d+\.\d+\.\d+$/);
    expect(appForPath("/surveys")).toBe("surveys");
    expect(appForPath("/surveysx")).toBe("deliveries");
  });
});

describe("la puerta", () => {
  const layout = leer("src/app/surveys/layout.tsx");
  it("comprueba el acceso en el servidor; el admin siempre entra", () => {
    expect(layout).toContain('const tieneEncuestas = role === "admin" || !!profile?.module_access?.includes("surveys");');
    expect(layout).toContain("if (!tieneEncuestas) {");
    expect(layout).toContain('redirect("/login?next=/surveys")');
  });
  it("un fallo de lectura del perfil no redirige (D-234)", () => {
    const desde = layout.indexOf('=== "fallo"');
    const hasta = layout.indexOf("const role =");
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    expect(layout.slice(desde, hasta)).not.toContain("redirect(");
  });
});

describe("la pantalla usa las funciones probadas, con los datos que tocan", () => {
  const p = leer("src/app/surveys/Encuestas.tsx");
  it("filtra por fechas y calcula sobre lo filtrado", () => {
    expect(p).toContain("filtrarPorFechas(filas, desde || null, hasta || null)");
    expect(p).toContain("respuestasPorDia(visibles, desde || null, hasta || null)");
    expect(p).toContain("porArea(visibles)");
    expect(p).toContain("porcentajeNada(visibles)");
    expect(p).toContain("textosOther(visibles)");
    expect(p).toContain("tablaCsv(visibles)");
  });
  it("la lista de contacto NO obedece al filtro: todas las filas", () => {
    expect(p).toContain("paraContactar(filas)");
    expect(p).not.toContain("paraContactar(visibles)");
  });
  it("marca por el almacén, y lo que pinta es la hora que devolvió la base", () => {
    expect(p).toContain("await almacen.marcarContactado(f.id, valor)");
    expect(p).toContain("contacted: valor, contacted_at: r.valor");
  });
  it("sin la 155 lo dice, y tiene cómo volver al hub", () => {
    expect(p).toContain('r.sinTabla ? { tipo: "sinTabla" }');
    expect(p).toMatch(/<Link href="\/home"/);
  });
});

describe("la 155", () => {
  const sql = leer(SQL);
  const [cuerpo] = sql.split("-- @ledger-below");
  const sinComentarios = cuerpo.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("es la ÚLTIMA migración que define profiles_module_access_known, y su lista es MODULE_ACCESS entero", () => {
    const definen = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => leer(`supabase/migrations/${f}`).includes("add constraint profiles_module_access_known"));
    expect(definen[definen.length - 1]).toBe("155_encuestas.sql");
    const lista = /module_access <@ array\[([^\]]+)\]\)\n  not valid;/.exec(cuerpo)![1];
    expect(lista).not.toContain("clockin");
    expect(lista.split(",").sort()).toEqual(MODULE_ACCESS.map((m) => `'${m.key}'`).sort());
  });

  it("las ocho claves de área son las de la app, en el validador de la tabla y en la función", () => {
    const valido = /create or replace function public\.survey_areas_valid[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(cuerpo)![1];
    const enSubmit = /if v_area not in \(([\s\S]*?)\) then/.exec(cuerpo)![1];
    const claves = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(claves(valido)).toEqual([...AREA_KEYS]);
    expect(claves(enSubmit)).toEqual([...AREA_KEYS]);
  });

  it("submit: definer con search_path fijo, y solo la ejecutan encuesta_web y service_role", () => {
    expect(cuerpo).toContain("create or replace function public.submit_survey_response(payload jsonb)\n  returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$");
    expect(cuerpo).toContain("revoke execute on function public.submit_survey_response(jsonb)          from public, anon, authenticated;");
    expect(cuerpo).toContain("grant execute on function public.submit_survey_response(jsonb)           to encuesta_web, service_role;");
  });

  it("marcar: solo authenticated, y la función comprueba el módulo antes de tocar nada", () => {
    expect(cuerpo).toContain("revoke execute on function public.mark_survey_contacted(uuid, boolean)   from public, anon, authenticated, encuesta_web;");
    expect(cuerpo).toContain("grant execute on function public.mark_survey_contacted(uuid, boolean)    to authenticated;");
    const f = /create or replace function public\.mark_survey_contacted[\s\S]*?end \$\$;/.exec(cuerpo)![0];
    expect(f.indexOf("if not public.has_surveys_access() then")).toBeGreaterThan(0);
    expect(f.indexOf("if not public.has_surveys_access() then")).toBeLessThan(f.indexOf("update public.survey_responses"));
    expect(f).toContain("where id = p_id and wants_contact");
  });

  it("la tabla: una sola política, de SELECT y mirando el módulo; authenticated solo lee; nadie escribe por la API", () => {
    const politicas = [...cuerpo.matchAll(/create policy "([^"]+)" on public\.survey_responses for (\w+)/g)];
    expect(politicas.map((m) => m[2])).toEqual(["select"]);
    expect(cuerpo).toContain("using ((select public.has_surveys_access()));");
    expect(cuerpo).toContain("revoke all on public.survey_responses from public, anon, authenticated;");
    expect(cuerpo).toContain("grant select on public.survey_responses to authenticated;");
    expect(sinComentarios).not.toMatch(/grant [^;]*(insert|update|delete)[^;]*survey_responses/i);
    expect(cuerpo).toContain("alter table public.survey_responses enable row level security;");
  });

  it("encuesta_web: nace NOLOGIN, la contraseña no está en el repo, y solo recibe dos cosas", () => {
    expect(cuerpo).toMatch(/if not exists \(select 1 from pg_roles where rolname = 'encuesta_web'\) then\s+create role encuesta_web nologin;/);
    expect(sinComentarios).not.toMatch(/password/i);
    expect(sinComentarios).not.toMatch(/\blogin\b/i);
    const grants = [...sinComentarios.matchAll(/grant [^;]*;/g)].map((m) => m[0]).filter((g) => g.includes("encuesta_web"));
    expect(grants).toEqual([
      "grant usage on schema public to encuesta_web;",
      "grant execute on function public.submit_survey_response(jsonb)           to encuesta_web, service_role;",
    ]);
  });

  it("los CHECK de la tabla repiten las reglas de contacto y de calificación", () => {
    expect(cuerpo).toContain("constraint survey_responses_ratings check (public.survey_ratings_valid(ratings, selected_areas))");
    expect(cuerpo).toContain("jsonb_typeof(e.value) <> 'number' or e.value::text !~ '^[1-5]$'");
    expect(cuerpo).toMatch(/then contact_name is not null and length\(btrim\(contact_name\)\) between 1 and 120\s+and \(contact_phone is not null or contact_email is not null\)\s+else contact_name is null and contact_phone is null and contact_email is null end/);
    expect(cuerpo).toContain("length(regexp_replace(contact_phone, '[^0-9]', '', 'g')) between 7 and 15");
    expect(cuerpo).toContain("(contacted and contacted_at is not null) or (not contacted and contacted_at is null)");
  });

  it("sin begin/commit propios y sin D-NNN dentro", () => {
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).not.toMatch(/D-\d{3}|D-449/);
  });

  it("el checksum del registro es el del cuerpo", () => {
    const sha = createHash("sha256").update(cuerpo).digest("hex");
    expect(sql).toContain(`values ('155_encuestas.sql', '${sha}')`);
  });
});
