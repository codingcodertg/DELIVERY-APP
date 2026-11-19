import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// La forma de la migración 331 (tarjetas de presentación). No la ejecuta: la base no está a la mano en las pruebas.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/331_tarjetas_de_presentacion.sql"), "utf8");
const MARCA_LEDGER = "\n-- @ledger-below";
const corte = sql.lastIndexOf(MARCA_LEDGER);
const codigo = sql.slice(0, corte);

describe("migración 331: tarjetas de presentación", () => {
  it("crea la tabla con RLS y solo el admin la lee y escribe", () => {
    expect(codigo).toMatch(/create table if not exists public\.business_cards/);
    expect(codigo).toMatch(/alter table public\.business_cards enable row level security/);
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(codigo).toMatch(new RegExp(`create policy "admin ${op === "select" ? "read" : op} business_cards"[\\s\\S]*?public\\.is_admin\\(\\)`));
    }
    expect(codigo).toMatch(/revoke all on public\.business_cards from anon, authenticated/);
  });

  it("valida el slug, la tienda y el token en la propia tabla", () => {
    expect(codigo).toMatch(/slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'/);
    expect(codigo).toMatch(/store in \('brownsville', 'pharr', 'mcallen', 'edinburg', 'mission', 'weslaco'\)/);
    expect(codigo).toMatch(/edit_token ~ '\^\[a-f0-9\]\{64\}\$'/);
    expect(codigo).toMatch(/constraint business_cards_slug_key unique \(slug\)/);
    expect(codigo).toMatch(/constraint business_cards_token_key unique \(edit_token\)/);
  });

  it("lo público es una función security definer con search_path vacío, solo campos públicos y solo activas", () => {
    const m = /create or replace function public\.business_card_public[\s\S]*?\$\$;/.exec(codigo);
    expect(m).not.toBeNull();
    const f = m![0];
    expect(f).toMatch(/security definer set search_path = ''/);
    expect(f).toMatch(/and c\.active/);
    expect(f).not.toMatch(/edit_token|profile_id|created_by|updated_by/);
  });

  it("las funciones de token existen, comparan exacto y no devuelven el token", () => {
    for (const nombre of ["business_card_by_token", "business_card_set_media"]) {
      expect(codigo).toMatch(new RegExp(`create or replace function public\\.${nombre}`));
    }
    expect(codigo).toMatch(/length\(p_token\) = 64 and c\.edit_token = p_token/);
    const porToken = /create or replace function public\.business_card_by_token[\s\S]*?\$\$;/.exec(codigo)![0];
    const columnas = /select([\s\S]*?)from/.exec(porToken)![1];
    expect(columnas).not.toMatch(/edit_token/);
  });

  it("la ruta de la foto se valida dentro de la carpeta de la tarjeta (su id)", () => {
    expect(codigo).toMatch(/'\^' \|\| v_id::text \|\| '\/\(foto\|portada\)-\[0-9\]\{1,15\}\\\.\(jpg\|png\|webp\)\$'/);
    expect(codigo).toMatch(/raise exception 'ruta de foto fuera de la tarjeta'/);
  });

  it("los permisos: revoke de public y grant solo a anon y authenticated para las tres funciones", () => {
    for (const firma of ["business_card_public(text)", "business_card_by_token(text)", "business_card_set_media(text, text, text)"]) {
      expect(codigo).toContain(`revoke all on function public.${firma} from public;`);
      expect(codigo).toContain(`grant execute on function public.${firma} to anon, authenticated;`);
    }
  });

  it("el bucket es público, con tope de 5 MB y solo imágenes, y solo el admin escribe en él", () => {
    expect(codigo).toMatch(/values \('business-cards', 'business-cards', true, 5242880, array\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
    expect(codigo).toMatch(/create policy "admin write business-cards" on storage\.objects[\s\S]*?bucket_id = 'business-cards' and public\.is_admin\(\)/);
  });

  it("lleva la línea del ledger justo tras su marcador", () => {
    expect(corte).toBeGreaterThan(0);
    expect(sql.slice(corte).trim().startsWith("-- @ledger-below")).toBe(true);
    expect(sql.slice(corte)).toMatch(/insert into public.schema_migrations/);
  });
});
