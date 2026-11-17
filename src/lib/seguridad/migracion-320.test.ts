import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// La migración 320 no se aplica desde aquí; estas pruebas fijan lo que el trigger de cambios de privilegio debe hacer,
// para que una edición no lo afloje sin que se note.
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "320_monitoreo_de_seguridad.sql"), "utf8");

describe("320: el trigger de cambios de privilegio lo escribe la base", () => {
  it("se dispara solo al cambiar las columnas de privilegio de profiles", () => {
    expect(sql).toMatch(/after update of role, recruiting_role, timetracker_role, erp_role, customers_role, module_access, permissions\s+on public\.profiles/);
  });
  it("corre como security definer y no es ejecutable por anon ni authenticated", () => {
    expect(sql).toMatch(/seguridad_registra_cambio_de_perfil\(\)\s+returns trigger language plpgsql security definer/);
    expect(sql).toMatch(/revoke all on function public\.seguridad_registra_cambio_de_perfil\(\) from public, anon, authenticated;/);
  });
  it("escribe en sec_events con categoria admin, y el rol nuevo va en meta", () => {
    expect(sql).toMatch(/insert into public\.sec_events \(categoria, severidad, usuario_id, objetivo_tipo, objetivo_id, metodo, meta\)/);
    expect(sql).toMatch(/'admin',\s+case when campo = 'role' and despues = 'admin' then 5/);
    expect(sql).toMatch(/jsonb_build_object\('campo', campo, 'antes', antes, 'despues', despues\)/);
  });
  it("un fallo del registro avisa y no bloquea el cambio del perfil", () => {
    expect(sql).toMatch(/exception when others then\s+raise warning/);
  });
  it("la autocomprobación exige que el trigger exista", () => {
    expect(sql).toMatch(/pg_trigger where tgname = 'seguridad_cambio_de_perfil'/);
  });
});
