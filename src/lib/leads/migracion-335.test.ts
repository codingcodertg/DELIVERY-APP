import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMNAS, COLUMNAS_EN_ORDEN } from "./almacen";

/** 335 · Teléfono a mano: lo que la migración promete, leído del propio fichero (no se aplica aquí). */
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const sql = leer("supabase/migrations/335_leads_telefono_a_mano.sql");
const sinComentarios = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const importadorPrivado = leer("scripts/leads/importa-leads-privado.mjs");
const importadorEstado = leer("scripts/leads/importa-leads.mjs");
const migracion328 = leer("supabase/migrations/328_leads_etapas.sql");

describe("335 · la forma del fichero", () => {
  it("termina con el marcador del registro y nada detrás (el registro lo pone quien aplica)", () => {
    const partes = sql.split("-- @ledger-below");
    expect(partes).toHaveLength(2);
    expect(partes[1].trim()).toBe("");
  });
  it("sin begin ni commit propios: la transacción la pone quien aplica", () => {
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });
  it("no borra datos ni tablas, y no redefine lo que no le toca", () => {
    expect(sinComentarios).not.toMatch(/\bdelete\s+from\b/i);
    expect(sinComentarios).not.toMatch(/\bdrop\s+table\b/i);
    expect(sinComentarios).not.toMatch(/create or replace function public\.(lead_note|leads_import_rows|leads_registra_nota|leads_puede_ver_fila|lead_take|lead_close)\(/);
  });
  it("la única función nueva es security definer con search_path fijado", () => {
    const funciones = [...sinComentarios.matchAll(/create or replace function public\.(\w+)\([^)]*\)[\s\S]*?security definer set search_path = public, pg_temp/g)].map((m) => m[1]);
    expect(funciones).toEqual(["lead_set_phone"]);
  });
  it("lead_set_phone tiene la firma de cinco argumentos y pide poder VERLO (la misma puerta que la nota)", () => {
    expect(sinComentarios).toContain("create or replace function public.lead_set_phone(p_lead uuid, p_quien text, p_telefono text, p_ext text, p_contacto text)");
    expect(sinComentarios).toContain("if not public.leads_puede_ver_fila(p_lead) then");
    expect(sinComentarios).toContain("if v_uid is null or not public.has_leads_access() then");
  });
  it("valida en el servidor: 10 dígitos, extensión de hasta 6 y contacto de hasta 80", () => {
    expect(sinComentarios).toContain("length(v_digitos) <> 10");
    expect(sinComentarios).toContain("v_ext !~ '^[0-9]{1,6}$'");
    expect(sinComentarios).toContain("length(v_contacto) > 80");
  });
  it("da la misma forma que telefonos.ts: «(956) 555-0123» y « ext. N»", () => {
    expect(sinComentarios).toContain("'(' || substr(v_digitos, 1, 3) || ') ' || substr(v_digitos, 4, 3) || '-' || substr(v_digitos, 7, 4)");
    expect(sinComentarios).toContain("' ext. ' || v_ext");
  });
  it("cada campo nuevo está por lado: contratista (owner_) y propietario (tenant_), con su nombre, quién y cuándo", () => {
    for (const lado of ["owner", "tenant"]) {
      for (const campo of ["phone_manual", "phone_manual_contact", "phone_manual_by", "phone_manual_by_name", "phone_manual_at"]) {
        expect(sinComentarios).toContain(`add column if not exists ${lado}_${campo} `);
      }
    }
  });
  it("el historial acepta el tipo phone y conserva los de antes", () => {
    const m = /constraint lead_events_kind[\s\S]*?check \(([\s\S]*?)\);/.exec(sinComentarios);
    expect(m).not.toBeNull();
    const tipos = [...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    expect([...tipos].sort()).toEqual(["archived", "assigned", "closed", "imported", "phone", "progress", "released", "taken"]);
  });
  it("los grants: nadie anónimo; sesión sí (como lead_note)", () => {
    expect(sinComentarios).toContain("revoke execute on function public.lead_set_phone(uuid, text, text, text, text) from public, anon;");
    expect(sinComentarios).toContain("grant  execute on function public.lead_set_phone(uuid, text, text, text, text) to authenticated;");
  });
});

describe("335 · los imports nunca tocan el teléfono a mano", () => {
  it("ni el guion del Excel privado ni el del estado nombran las columnas de mano", () => {
    expect(importadorPrivado).not.toMatch(/_manual/);
    expect(importadorEstado).not.toMatch(/_manual/);
  });
  it("la función de carga (328) no nombra las columnas de mano: su «on conflict» no las pisa", () => {
    expect(migracion328).not.toMatch(/_manual/);
  });
  it("el guion del privado sigue sobrescribiendo SOLO el teléfono del Excel (owner_phone / tenant_phone)", () => {
    expect(importadorPrivado).toMatch(/owner_phone = excluded\.owner_phone/);
    expect(importadorPrivado).toMatch(/tenant_phone = excluded\.tenant_phone/);
  });
});

describe("335 · la lectura por tramos de columnas", () => {
  it("las columnas nuevas van en la lista más nueva y se bajan a la vieja si falta la 335", () => {
    expect(COLUMNAS).toContain("owner_phone_manual");
    expect(COLUMNAS).toContain("tenant_phone_manual_at");
    expect(COLUMNAS_EN_ORDEN).toHaveLength(4);
    expect(COLUMNAS_EN_ORDEN[1]).not.toContain("owner_phone_manual");
    expect(COLUMNAS_EN_ORDEN[1]).toContain("times_seen");
    expect(COLUMNAS_EN_ORDEN[3]).not.toContain("follow_up_action");
  });
});
