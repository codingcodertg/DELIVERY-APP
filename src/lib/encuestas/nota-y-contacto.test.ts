import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Migración 171 (dueño, 2026-10-13): nota libre opcional y nombre del contacto opcional. La función del sitio
 * público se COPIA de la 155 y se cambia solo lo pedido: esta prueba lo comprueba rehaciendo los cambios sobre el
 * cuerpo de la 155 y exigiendo que salga, carácter por carácter, el de la 171.
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const SQL155 = leer("supabase/migrations/155_encuestas.sql");
const SQL171 = leer("supabase/migrations/171_encuesta_nota_y_contacto.sql");
const [cuerpo171] = SQL171.split("-- @ledger-below");
const sinComentarios = cuerpo171.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const funcion = (sql: string) => /create or replace function public\.submit_survey_response\(payload jsonb\)[\s\S]*?\nend \$\$;/.exec(sql)![0];

/** Cambia `viejo` por `nuevo` exigiendo que `viejo` aparezca una sola vez (un ancla doble cambiaría el sitio equivocado). */
function una(s: string, viejo: string, nuevo: string): string {
  expect(s.split(viejo).length - 1, viejo).toBe(1);
  return s.replace(viejo, () => nuevo);
}

describe("la 171: submit_survey_response es la de la 155 con solo los cambios pedidos", () => {
  it("ninguna otra migración entre la 155 y la 171 redefine la función", () => {
    const definen = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => leer(`supabase/migrations/${f}`).includes("create or replace function public.submit_survey_response"));
    expect(definen).toEqual(["155_encuestas.sql", "171_encuesta_nota_y_contacto.sql"]);
  });

  it("el cuerpo de la 171 = el de la 155 + nota + nombre opcional, y nada más", () => {
    let f = funcion(SQL155);
    f = una(f, "  v_email   text;\n", "  v_email   text;\n  v_note    text;\n");
    f = una(f, "'contact_name', 'contact_phone', 'contact_email') then", "'contact_name', 'contact_phone', 'contact_email', 'note') then");
    f = una(f, "  v_email := public.survey_payload_text(payload, 'contact_email');\n",
      "  v_email := public.survey_payload_text(payload, 'contact_email');\n  v_note  := public.survey_payload_text(payload, 'note');\n");
    f = una(f,
      "  -- Contacto.\n  if v_wants then\n    if v_name is null then\n      raise exception 'survey: a name is required to be contacted' using errcode = '22023';\n    end if;\n    if length(v_name) > 120 then",
      "  -- Contacto. El nombre es opcional (171); telefono o correo, al menos uno.\n  if v_wants then\n    if v_name is not null and length(v_name) > 120 then");
    f = una(f, "  end if;\n\n  insert into public.survey_responses",
      "  end if;\n\n  -- Nota libre (171): opcional, con o sin contacto.\n  if v_note is not null and length(v_note) > 1000 then\n    raise exception 'survey: the note is longer than 1000 characters' using errcode = '22023';\n  end if;\n\n  insert into public.survey_responses");
    f = una(f, "contact_phone, contact_email)\n  values", "contact_phone, contact_email, note)\n  values");
    f = una(f, "v_phone, v_email)\n  returning", "v_phone, v_email, v_note)\n  returning");
    expect(funcion(SQL171)).toBe(f);
  });

  it("sigue exigiendo teléfono o correo con contacto, y nada de contacto sin él", () => {
    const f = funcion(SQL171);
    expect(f).toContain("if v_phone is null and v_email is null then\n      raise exception 'survey: a phone or an email is required to be contacted'");
    expect(f).toContain("elsif v_name is not null or v_phone is not null or v_email is not null then");
    expect(f).not.toContain("a name is required");
  });
});

describe("la 171: la tabla", () => {
  it("la columna note, con su CHECK de 1 a 1000 tras btrim", () => {
    expect(sinComentarios).toContain("alter table public.survey_responses add column if not exists note text;");
    expect(sinComentarios).toMatch(/add constraint survey_responses_note check \(\s*note is null or length\(btrim\(note\)\) between 1 and 1000\s*\);/);
  });

  it("survey_responses_contact: nombre opcional (1-120 si viene), teléfono o correo obligatorio; sin contacto, los tres nulos", () => {
    expect(sinComentarios).toContain("alter table public.survey_responses drop constraint if exists survey_responses_contact;");
    expect(sinComentarios).toMatch(
      /add constraint survey_responses_contact check \(\s*case when wants_contact\s+then \(contact_name is null or length\(btrim\(contact_name\)\) between 1 and 120\)\s+and \(contact_phone is not null or contact_email is not null\)\s+else contact_name is null and contact_phone is null and contact_email is null end\s*\);/,
    );
    expect(sinComentarios).not.toContain("contact_name is not null and length");
  });

  it("no toca filas, ni políticas, ni grants, ni roles (fuera del insert de la propia función)", () => {
    const fuera = sinComentarios.replace(funcion(sinComentarios), "");
    expect(fuera.length).toBeLessThan(sinComentarios.length);
    expect(fuera).not.toMatch(/\b(update|delete from|insert into)\s+public\.survey_responses\b/i);
    expect(sinComentarios).not.toMatch(/\b(grant|revoke|create policy|drop policy|create role|alter role)\b/i);
  });
});

describe("la 171: forma de migración", () => {
  it("sin begin/commit propios y sin D-NNN dentro", () => {
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(SQL171).not.toMatch(/D-\d{3}|D-NEXT/);
  });

  it("se comprueba a sí misma: nota, contacto, función y privilegios", () => {
    expect(cuerpo171).toContain("raise exception '171: falta survey_responses.note (text, nula)'");
    expect(cuerpo171).toContain("raise exception '171: survey_responses_contact sigue exigiendo el nombre: %', def;");
    expect(cuerpo171).toContain("raise exception '171: encuesta_web ya no puede ejecutar submit_survey_response';");
  });

  it("el checksum del registro es el del cuerpo", () => {
    const sha = createHash("sha256").update(cuerpo171).digest("hex");
    expect(SQL171).toContain(`values ('171_encuesta_nota_y_contacto.sql', '${sha}')`);
  });
});

describe("la pantalla enseña la nota y el contacto sin nombre", () => {
  const p = leer("src/app/surveys/Encuestas.tsx");
  it("las notas salen de notasDe sobre lo filtrado, y la nota va en las dos tablas", () => {
    expect(p).toContain("notasDe(visibles)");
    expect(p.match(/\{f\.note \?\? ""\}/g) ?? []).toHaveLength(2);
  });
  it("el nombre se pinta con nombreDeContacto en la lista de contacto y en la de todas", () => {
    expect(p).toContain("{nombreDeContacto(f, lang)}</td>");
    expect(p).toContain("[nombreDeContacto(f, lang), f.contact_phone, f.contact_email]");
    expect(p).not.toContain("<td>{f.contact_name}</td>");
  });
});
