import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { MIN_CONTRASENA, mensajeDeContrasena, validaCambioDeContrasena } from "./profile-password";
import { identidadVisible } from "./profile-identity";
import { emailForUsername } from "./username";

/**
 * «Mi perfil»: la contraseña se cambia en un solo sitio, y pidiendo la actual (D-265).
 *
 * Cuatro clases de prueba:
 *   1. La ruta `POST /api/profile/password`, importada y llamada con Auth falso. Nada de esto
 *      llama a Supabase: se mira con qué se llama a `signInWithPassword` y a `updateUser`, y en
 *      qué orden, que es exactamente lo que decide si la contraseña actual protege algo.
 *   2. Lo que se decide sin red: validación e identidad visible.
 *   3. Un barrido de `src/`: ninguna otra pantalla cambia la contraseña.
 *   4. Los caminos: el lobby y las tres apps llevan a «Mi perfil», y el chofer puede entrar.
 */

const falso = vi.hoisted(() => ({
  sesion: { ok: true as boolean, id: "usuario-1", email: "ana@empresa.test" as string | undefined },
  updateUser: vi.fn(async (_a?: unknown) => ({ error: null as null | { message: string } })),
  signInDeLaSesion: vi.fn(async (_a?: unknown) => ({ data: {}, error: null })),
  crearCliente: vi.fn(),
  signInDeComprobacion: vi.fn(async (_a?: unknown) => ({
    data: { user: { id: "usuario-1" } as { id: string } | null },
    error: null as null | { message: string },
  })),
  signOutDeComprobacion: vi.fn(async (_a?: unknown) => ({ error: null })),
}));

vi.mock("@/lib/api-auth", () => ({
  requireUser: async () =>
    falso.sesion.ok
      ? {
          ok: true,
          user: { id: falso.sesion.id, email: falso.sesion.email },
          supabase: { auth: { updateUser: falso.updateUser, signInWithPassword: falso.signInDeLaSesion } },
        }
      : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    falso.crearCliente(...args);
    return { auth: { signInWithPassword: falso.signInDeComprobacion, signOut: falso.signOutDeComprobacion } };
  },
}));

import { POST as cambiar } from "@/app/api/profile/password/route";

const pide = (cuerpo: unknown) =>
  cambiar(new Request("http://localhost/api/profile/password", { method: "POST", body: JSON.stringify(cuerpo) }));

beforeEach(() => {
  falso.sesion = { ok: true, id: "usuario-1", email: "ana@empresa.test" };
  for (const s of [falso.updateUser, falso.signInDeLaSesion, falso.crearCliente, falso.signInDeComprobacion, falso.signOutDeComprobacion]) {
    s.mockClear();
  }
  falso.updateUser.mockImplementation(async () => ({ error: null }));
  falso.signInDeComprobacion.mockImplementation(async () => ({ data: { user: { id: "usuario-1" } }, error: null }));
});

describe("POST /api/profile/password: la actual protege de verdad", () => {
  it("con la actual correcta: comprueba, cierra la comprobación, y cambia con la sesión de siempre", async () => {
    const r = await pide({ actual: "vieja-123", nueva: "nueva-456" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });

    expect(falso.signInDeComprobacion.mock.calls).toEqual([[{ email: "ana@empresa.test", password: "vieja-123" }]]);
    expect(falso.signOutDeComprobacion.mock.calls).toEqual([[{ scope: "local" }]]);
    expect(falso.updateUser.mock.calls).toEqual([[{ password: "nueva-456" }]]);
    // Primero se comprueba y después se cambia; al revés, la comprobación no protege nada.
    expect(falso.signInDeComprobacion.mock.invocationCallOrder[0]).toBeLessThan(falso.updateUser.mock.invocationCallOrder[0]);
  });

  it("la comprobación va en un cliente aparte, que no guarda sesión: la de la persona no se reemplaza", async () => {
    await pide({ actual: "vieja-123", nueva: "nueva-456" });
    expect(falso.crearCliente).toHaveBeenCalledTimes(1);
    const opciones = falso.crearCliente.mock.calls[0][2] as { auth?: { persistSession?: boolean; autoRefreshToken?: boolean } };
    expect(opciones.auth?.persistSession).toBe(false);
    expect(opciones.auth?.autoRefreshToken).toBe(false);
    // El formulario viejo de Entregas iniciaba sesión en el cliente de la propia sesión.
    expect(falso.signInDeLaSesion).not.toHaveBeenCalled();
  });

  it("con la actual incorrecta: 403, y la contraseña NO se toca", async () => {
    falso.signInDeComprobacion.mockImplementation(async () => ({ data: { user: null }, error: { message: "Invalid login credentials" } }));
    const r = await pide({ actual: "no-es", nueva: "nueva-456" });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, codigo: "actual_incorrecta" });
    expect(falso.updateUser).not.toHaveBeenCalled();
  });

  it("si la contraseña resulta ser de OTRA cuenta, tampoco vale", async () => {
    falso.signInDeComprobacion.mockImplementation(async () => ({ data: { user: { id: "otra-cuenta" } }, error: null }));
    const r = await pide({ actual: "vieja-123", nueva: "nueva-456" });
    expect(r.status).toBe(403);
    expect(falso.updateUser).not.toHaveBeenCalled();
  });

  it("sin sesión: 401 y no se intenta nada", async () => {
    falso.sesion.ok = false;
    const r = await pide({ actual: "vieja-123", nueva: "nueva-456" });
    expect(r.status).toBe(401);
    expect(falso.crearCliente).not.toHaveBeenCalled();
    expect(falso.updateUser).not.toHaveBeenCalled();
  });

  it("sin la actual, o con una nueva corta: 400 antes de preguntar a nadie", async () => {
    for (const [cuerpo, codigo] of [
      [{ actual: "", nueva: "nueva-456" }, "falta_actual"],
      [{ nueva: "nueva-456" }, "falta_actual"],
      [{ actual: "vieja-123", nueva: "x".repeat(MIN_CONTRASENA - 1) }, "corta"],
    ] as const) {
      const r = await pide(cuerpo);
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
      expect((await r.json()).codigo).toBe(codigo);
    }
    expect(falso.signInDeComprobacion).not.toHaveBeenCalled();
    expect(falso.updateUser).not.toHaveBeenCalled();
  });

  it("una cuenta sin correo no puede comprobarse, así que no se cambia", async () => {
    falso.sesion.email = undefined;
    const r = await pide({ actual: "vieja-123", nueva: "nueva-456" });
    expect(r.status).toBe(400);
    expect((await r.json()).codigo).toBe("sin_correo");
    expect(falso.signInDeComprobacion).not.toHaveBeenCalled();
    expect(falso.updateUser).not.toHaveBeenCalled();
  });

  it("si Supabase no la guarda, se dice", async () => {
    falso.updateUser.mockImplementation(async () => ({ error: { message: "weak password" } }));
    const r = await pide({ actual: "vieja-123", nueva: "nueva-456" });
    expect(r.status).toBe(400);
    expect((await r.json()).codigo).toBe("no_guardada");
  });

  // Un rechazo de Supabase dice por qué (D-NEXT). Los errores tienen los campos de las clases reales
  // de la librería, que fija `password-input.test.ts` sin simular nada.
  it("débil: contesta «debil» con los motivos de Supabase", async () => {
    falso.updateUser.mockImplementation(async () => ({
      error: { name: "AuthWeakPasswordError", message: "weak", status: 422, code: "weak_password", reasons: ["length"] },
    } as never));
    const r = await pide({ actual: "vieja-123", nueva: "nueva-456" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, codigo: "debil", motivos: ["length"] });
  });

  it("igual a la anterior: contesta «misma_contrasena», no «inténtalo otra vez»", async () => {
    falso.updateUser.mockImplementation(async () => ({
      error: { name: "AuthApiError", message: "same", status: 422, code: "same_password" },
    } as never));
    const r = await pide({ actual: "vieja-123", nueva: "nueva-456" });
    expect((await r.json()).codigo).toBe("misma_contrasena");
  });

  it("un fallo que no se reconoce queda en el log del servidor, y la contraseña nunca va en él", async () => {
    const errorOriginal = console.error;
    const registros: unknown[][] = [];
    console.error = (...a: unknown[]) => { registros.push(a); };
    try {
      falso.updateUser.mockImplementation(async () => ({ error: { message: "boom", status: 500, code: "unexpected_failure" } } as never));
      const r = await pide({ actual: "vieja-secreta-1", nueva: "nueva-secreta-2" });
      expect((await r.json()).codigo).toBe("no_guardada");
      expect(registros).toHaveLength(1);
      const texto = JSON.stringify(registros);
      expect(texto).toContain("unexpected_failure");
      expect(texto).not.toContain("nueva-secreta-2");
      expect(texto).not.toContain("vieja-secreta-1");
    } finally {
      console.error = errorOriginal;
    }
  });
});

describe("lo que se decide sin red", () => {
  it("valida en orden: falta la actual, nueva corta, no coinciden", () => {
    expect(validaCambioDeContrasena({ actual: "", nueva: "123456", confirmacion: "123456" })).toBe("falta_actual");
    expect(validaCambioDeContrasena({ actual: "a", nueva: "12345", confirmacion: "12345" })).toBe("corta");
    expect(validaCambioDeContrasena({ actual: "a", nueva: "123456", confirmacion: "123457" })).toBe("no_coinciden");
    expect(validaCambioDeContrasena({ actual: "a", nueva: "123456", confirmacion: "123456" })).toBeNull();
    // El servidor no recibe la confirmación, y no puede fallar por ella.
    expect(validaCambioDeContrasena({ actual: "a", nueva: "123456" })).toBeNull();
  });

  it("el mínimo es el mismo que pedían los tres formularios que había", () => {
    expect(MIN_CONTRASENA).toBe(6);
  });

  it("cada código tiene texto en los dos idiomas, y distinto", () => {
    const en = (a: string) => a;
    const es = (_a: string, b: string) => b;
    for (const c of ["falta_actual", "corta", "no_coinciden", "actual_incorrecta", "sin_correo", "no_guardada"] as const) {
      expect(mensajeDeContrasena(c, en), c).not.toBe(mensajeDeContrasena(c, es));
    }
  });

  it("quien entra con usuario ve su usuario, no la dirección inventada", () => {
    expect(identidadVisible({ email: emailForUsername("maximo"), username: "maximo" })).toEqual({ correo: null, usuario: "maximo" });
    // Sin usuario guardado, sale de la dirección.
    expect(identidadVisible({ email: emailForUsername("maximo"), username: null })).toEqual({ correo: null, usuario: "maximo" });
  });

  it("quien tiene correo de verdad ve su correo", () => {
    expect(identidadVisible({ email: "ana@empresa.test", username: null })).toEqual({ correo: "ana@empresa.test", usuario: null });
  });
});

// ---- Nadie más cambia la contraseña ---------------------------------------------------------

function codigoDeSrc(dir = "src"): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return codigoDeSrc(ruta);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(nombre) && !/\.test\./.test(nombre) ? [ruta.split("\\").join("/")] : [];
  });
}

function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, "")))
    .join("\n");
}

/** Los argumentos de cada `nombre(`, contando paréntesis: una llamada partida en varias líneas sale entera. */
function argumentosDe(src: string, nombre: string): string[] {
  const codigo = sinComentarios(src);
  const salida: string[] = [];
  const re = new RegExp(nombre + "\\s*\\(", "g");
  for (let m = re.exec(codigo); m; m = re.exec(codigo)) {
    let profundidad = 1;
    let i = m.index + m[0].length;
    const inicio = i;
    while (i < codigo.length && profundidad > 0) {
      if (codigo[i] === "(") profundidad++;
      else if (codigo[i] === ")") profundidad--;
      i++;
    }
    salida.push(codigo.slice(inicio, i - 1).replace(/\s+/g, " ").trim());
  }
  return salida;
}

describe("la contraseña se cambia en un solo sitio", () => {
  const ficheros = codigoDeSrc();

  it("el detector ve una llamada partida en varias líneas y no ve un comentario (control)", () => {
    const partida = "await supabase.auth\n  .updateUser(\n    { password: nueva },\n  );\n// updateUser({ password }) en un comentario";
    expect(argumentosDe(partida, "updateUser")).toEqual(["{ password: nueva },"]);
  });

  it("solo dos sitios ponen contraseña con updateUser: Mi perfil y el enlace del correo", () => {
    const conPassword = ficheros.filter((f) =>
      argumentosDe(readFileSync(f, "utf8"), "updateUser").some((a) => /\bpassword\b/.test(a)),
    );
    // `/reset-password` es la página a la que lleva el correo de «¿Olvidaste tu contraseña?»:
    // quien llega ahí NO sabe la actual, y por eso existe. No es un formulario de perfil.
    expect(conPassword.sort()).toEqual(["src/app/api/profile/password/route.ts", "src/app/reset-password/page.tsx"]);
  });

  it("y solo el login y Mi perfil inician sesión con contraseña", () => {
    const conSignIn = ficheros.filter((f) => argumentosDe(readFileSync(f, "utf8"), "signInWithPassword").length > 0);
    expect(conSignIn.sort()).toEqual(["src/app/api/profile/password/route.ts", "src/app/login/page.tsx"]);
  });

  it("el proveedor de Time Tracker ya no ofrece updatePassword", () => {
    expect(sinComentarios(readFileSync("src/lib/timetracker-data-provider.tsx", "utf8"))).not.toMatch(/\bupdatePassword\b/);
  });
});

describe("los caminos hasta Mi perfil", () => {
  const codigo = (f: string) => sinComentarios(readFileSync(f, "utf8"));

  it("el lobby enlaza a Mi perfil, fuera del bloque de las apps que se instalan", () => {
    const lobby = codigo("src/components/HomeSelector.tsx");
    expect(lobby).toContain('href="/home/profile"');
    // Para todos: el enlace no está dentro de ninguna condición de rol.
    const antesDelEnlace = lobby.slice(0, lobby.indexOf('href="/home/profile"'));
    expect(antesDelEnlace).not.toMatch(/me\.role\s*[!=]==/);
  });

  it("cada app que tenía el formulario lleva ahora a Mi perfil", () => {
    for (const f of [
      "src/app/(app)/account/page.tsx",
      "src/app/recruiting/(recruiting)/settings/page.tsx",
      "src/app/timetracker/(timetracker)/account/page.tsx",
    ]) {
      expect(codigo(f), f).toContain('href="/home/profile"');
      expect(codigo(f), f).not.toMatch(/type="password"/);
    }
  });

  it("la puerta de Mi perfil solo pide sesión: el chofer, que no entra al lobby (D-173), llega", () => {
    const puerta = codigo("src/app/home/profile/layout.tsx");
    expect(puerta).toContain("auth.getUser()");
    expect(puerta).toContain('redirect("/login?next=/home/profile")');
    expect(puerta).not.toContain("canReachHub");
    expect(puerta).not.toMatch(/role\s*[!=]==?\s*"/);
  });

  it("en Time Tracker, «Cerrar sesión en todos los dispositivos» sigue ahí", () => {
    expect(codigo("src/app/timetracker/(timetracker)/account/page.tsx")).toContain("<SignOutEverywhere />");
  });
});
