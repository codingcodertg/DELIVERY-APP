import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { correoTrasCambioDeUsuario, patronDeUsuario, quitarUsuarioDejaElViejo, revisaUsuarioNuevo } from "./cambio-de-usuario";

/** Cambiar el usuario del hub desde la ficha de RR. HH. (Cuenta del hub → «Cambiar usuario»). */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
const ID = "0b6f7a52-3c1d-4e8f-9a2b-5c6d7e8f9a0b";

describe("correoTrasCambioDeUsuario", () => {
  it("con correo derivado, el correo se mueve al del usuario nuevo (el viejo deja de entrar)", () => {
    expect(correoTrasCambioDeUsuario("maximo@users.rdztilegroup.net", "max.garza")).toBe("max.garza@users.rdztilegroup.net");
    expect(correoTrasCambioDeUsuario("MAXIMO@users.rdztilegroup.net", "Max.Garza")).toBe("max.garza@users.rdztilegroup.net");
  });
  it("un correo de verdad nunca se reescribe por renombrar", () => {
    expect(correoTrasCambioDeUsuario("ana@gmail.com", "ana")).toBeNull();
    expect(correoTrasCambioDeUsuario("ana@rdztilegroup.net", "ana")).toBeNull();
  });
  it("el alias de una baja (D-709) pasa a entrar con el usuario nuevo", () => {
    expect(correoTrasCambioDeUsuario(`${ID}@baja.users.rdztilegroup.net`, "pedro2")).toBe("pedro2@users.rdztilegroup.net");
  });
  it("sin usuario, o con el mismo, no se toca nada", () => {
    expect(correoTrasCambioDeUsuario("maximo@users.rdztilegroup.net", null)).toBeNull();
    expect(correoTrasCambioDeUsuario("maximo@users.rdztilegroup.net", "maximo")).toBeNull();
    expect(correoTrasCambioDeUsuario("", "maximo")).toBeNull();
  });
});

describe("quitarUsuarioDejaElViejo", () => {
  it("solo si entra con el correo derivado", () => {
    expect(quitarUsuarioDejaElViejo("maximo@users.rdztilegroup.net")).toBe(true);
    expect(quitarUsuarioDejaElViejo("ana@gmail.com")).toBe(false);
    expect(quitarUsuarioDejaElViejo(`${ID}@baja.users.rdztilegroup.net`)).toBe(false);
    expect(quitarUsuarioDejaElViejo(null)).toBe(false);
  });
});

describe("patronDeUsuario", () => {
  it("escapa el `_` de LIKE y deja lo demás", () => {
    expect(patronDeUsuario("m_garza")).toBe("m\\_garza");
    expect(patronDeUsuario("Max.Garza-2")).toBe("max.garza-2");
  });
});

describe("revisaUsuarioNuevo", () => {
  it("normaliza y acepta un usuario válido y distinto", () => {
    expect(revisaUsuarioNuevo("  Max.Garza ", "maximo")).toEqual({ ok: true, usuario: "max.garza" });
    expect(revisaUsuarioNuevo("maximo", null)).toEqual({ ok: true, usuario: "maximo" });
  });
  it("rechaza vacío, mal formado y el mismo (sin importar mayúsculas)", () => {
    expect(revisaUsuarioNuevo("  ", "maximo")).toEqual({ ok: false, motivo: "vacio" });
    expect(revisaUsuarioNuevo(null, "maximo")).toEqual({ ok: false, motivo: "vacio" });
    expect(revisaUsuarioNuevo("ma ximo", "maximo")).toEqual({ ok: false, motivo: "formato" });
    expect(revisaUsuarioNuevo("ab", null)).toEqual({ ok: false, motivo: "formato" });
    expect(revisaUsuarioNuevo("MAXIMO", "maximo")).toEqual({ ok: false, motivo: "igual" });
  });
});

describe("cableado", () => {
  const ruta = leer("src/app/api/user-identity/route.ts");
  const ficha = leer("src/app/recruiting/(recruiting)/employees/page.tsx");
  const hr = leer("src/app/recruiting/actions/hr.ts");

  it("la ruta sigue siendo solo de admin y usa las reglas: mover el correo, no quitar el usuario que entra, ocupado antes", () => {
    expect(ruta).toContain('if (me?.role !== "admin") { return NextResponse.json({ error: "Only admins can change sign-in details." }, { status: 403 });');
    expect(ruta).toContain("else if (wantsUsername) nextEmail = correoTrasCambioDeUsuario(currentEmail, username);");
    expect(ruta).toContain("quitarUsuarioDejaElViejo(currentEmail)");
    // El «ya está ocupado» va ANTES de mover el correo de acceso.
    const ocupado = ruta.indexOf('.ilike("username", patronDeUsuario(username))');
    expect(ocupado).toBeGreaterThan(0);
    expect(ocupado).toBeLessThan(ruta.indexOf("admin.auth.admin.updateUserById(id, { email: nextEmail"));
  });

  it("los hechos de la cuenta traen el usuario del perfil", () => {
    expect(hr).toContain('admin.from("profiles").select("id, username").in("id", ids)');
    expect(hr).toContain("usuario: usuarioDe.get(id) ?? null,");
  });

  it("la ficha lo cambia en «Cuenta del hub» por /api/user-identity, solo para el admin del hub", () => {
    expect(ficha).toContain('const puedeUsuario = hub?.role === "admin" && !!persona.profile_id;');
    expect(ficha).toContain('{puedeUsuario && usuarioNuevo === null && ( <button className="btn btn-ghost btn-sm" data-accion="cambiar-usuario"');
    expect(ficha).toContain('fetch("/api/user-identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: persona.profile_id, username: revisionUsuario.usuario }) })');
    expect(ficha).toContain('disabled={busy || !revisionUsuario.ok}');
    // Dentro de la sección de la cuenta, no en otra.
    const seccion = ficha.indexOf('<Seccion id="cuenta"');
    expect(ficha.indexOf('data-accion="cambiar-usuario"')).toBeGreaterThan(seccion);
    expect(ficha.indexOf('data-editor="usuario-del-hub"')).toBeLessThan(ficha.indexOf('<Seccion id="time-tracker"'));
  });
});
