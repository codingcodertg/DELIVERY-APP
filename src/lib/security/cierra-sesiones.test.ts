import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * D-828: cerrar todas las sesiones de una persona. El dueño, tras la baja de Melissa Garza (23 sesiones vivas con la
 * cuenta apagada): la baja las cierra sola y el admin tiene un botón en Security.
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("D-828: cerrar sesiones", () => {
  it("la 236 crea la RPC como security definer, solo para admin o la llave de servicio, y deja rastro", () => {
    const sql = leer("supabase/migrations/236_security_cierra_sesiones.sql");
    expect(sql).toContain("create or replace function public.security_sign_out_user(p_user uuid)");
    expect(sql).toContain("security definer");
    expect(sql).toContain("public.security_is_admin() or auth.role() = 'service_role'");
    expect(sql).toContain("delete from auth.sessions s where s.user_id = p_user");
    expect(sql).toContain("'sessions_closed'");
    expect(sql).toContain("revoke execute on function public.security_sign_out_user(uuid) from public, anon");
  });
  it("la baja (ponAcceso apagando) llama a la RPC; encender no", () => {
    const hr = leer("src/app/recruiting/actions/hr.ts");
    expect(hr).toContain('if (!encendida) await admin.rpc("security_sign_out_user", { p_user: profileId });');
  });
  it("Security tiene la acción y el botón con confirmación en Usuarios", () => {
    expect(leer("src/app/security/actions.ts")).toContain("export async function cierraSesionesDe(userId: string)");
    const panel = leer("src/app/security/PanelDeSeguridad.tsx");
    expect(panel).toContain('data-accion="cerrar-sesiones"');
    expect(panel).toContain("window.confirm(");
  });
});
