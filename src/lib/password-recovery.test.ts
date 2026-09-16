import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  correoParaRecuperar, destinoDelEnlace, leeFragmentoRecuperacion, pideRecuperacion, RESPUESTA_OLVIDO,
  resumenDelFallo, type RegistroDeFallo,
} from "./password-recovery";

// «¿Olvidaste tu contraseña?» en cualquier equipo (D-263). Sin correos ni Auth real: el envío se
// simula, y lo que se prueba es lo que decide. Dos clases de prueba que no se mezclan: las que
// importan la función y las que leen el fichero que la usa.

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("el fragmento con el que vuelve el enlace", () => {
  it("el error REAL de un enlace caducado, tal como lo devuelve Supabase", () => {
    // Medido por el orquestador en producción: el error llega en el fragmento, no en la query, y con
    // una clave `sb` vacía al final que no es un token.
    const real = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=";
    expect(leeFragmentoRecuperacion(real)).toEqual({ kind: "error", mensaje: "Email link is invalid or has expired" });
  });

  it("una sesión de recuperación con sus dos tokens", () => {
    expect(leeFragmentoRecuperacion("#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery"))
      .toEqual({ kind: "sesion", access_token: "a.b.c", refresh_token: "r1" });
  });

  it("un fragmento de otro tipo no abre la pantalla de cambiar contraseña", () => {
    expect(leeFragmentoRecuperacion("#access_token=a.b.c&refresh_token=r1&type=magiclink")).toEqual({ kind: "nada" });
    expect(leeFragmentoRecuperacion("#access_token=a.b.c&refresh_token=r1")).toEqual({ kind: "nada" });
  });

  it("sin los dos tokens, nada; y la clave `sb` sola tampoco es nada", () => {
    expect(leeFragmentoRecuperacion("#access_token=a.b.c&type=recovery")).toEqual({ kind: "nada" });
    expect(leeFragmentoRecuperacion("#sb=")).toEqual({ kind: "nada" });
    expect(leeFragmentoRecuperacion("")).toEqual({ kind: "nada" });
    expect(leeFragmentoRecuperacion(null)).toEqual({ kind: "nada" });
  });

  it("si trae error y tokens a la vez, manda el error", () => {
    expect(leeFragmentoRecuperacion("#access_token=a&refresh_token=r&type=recovery&error=denied").kind).toBe("error");
  });
});

describe("la ruta contesta lo mismo exista o no la cuenta", () => {
  const origen = "https://hub.example.test";

  it("vuelve a /reset-password en el mismo origen", async () => {
    let redirect = "";
    await pideRecuperacion("ana@example.test", origen, async (_c, r) => { redirect = r; });
    expect(redirect).toBe("https://hub.example.test/reset-password");
    expect(destinoDelEnlace(origen)).toBe(redirect);
  });

  it("envío bueno, error devuelto y excepción: la MISMA respuesta", async () => {
    const bien = await pideRecuperacion("ana@example.test", origen, async () => ({ error: null }));
    const conError = await pideRecuperacion("ana@example.test", origen, async () => ({ error: { status: 429, message: "rate limit" } }));
    const lanza = await pideRecuperacion("ana@example.test", origen, async () => { throw new Error("red"); });
    expect(bien).toEqual({ status: 200, body: { ...RESPUESTA_OLVIDO } });
    expect(conError).toEqual(bien);
    expect(lanza).toEqual(bien);
  });

  it("recorta el correo antes de mandarlo", async () => {
    let enviado = "";
    await pideRecuperacion("  ana@example.test  ", origen, async (c) => { enviado = c; });
    expect(enviado).toBe("ana@example.test");
  });

  it("un correo sin forma de correo no llega a Supabase, y eso no dice nada de ninguna cuenta", async () => {
    let llamadas = 0;
    const r = await pideRecuperacion("usuario-sin-arroba", origen, async () => { llamadas++; });
    expect(r.status).toBe(400);
    expect(llamadas).toBe(0);
    expect(correoParaRecuperar(42)).toBeNull();
    expect(correoParaRecuperar("a@b")).toBeNull();
  });
});

describe("la ruta de servidor pide el reset con flujo implícito", () => {
  const ruta = leer("src/app/api/auth/forgot/route.ts");

  it("usa el núcleo probado arriba", () => {
    expect(ruta).toContain('import { pideRecuperacion } from "@/lib/password-recovery";');
    expect(ruta).toContain("supabase.auth.resetPasswordForEmail(correo, { redirectTo })");
  });

  it("con cliente implícito y de un solo uso", () => {
    expect(ruta).toContain('flowType: "implicit",');
    expect(ruta).toContain("persistSession: false,");
  });
});

describe("el login ya no pide el reset desde el navegador", () => {
  const login = leer("src/app/login/page.tsx");

  it("llama a la ruta de servidor", () => {
    expect(login).toContain('await fetch("/api/auth/forgot", {');
  });

  it("y no usa el cliente PKCE del navegador para esto", () => {
    expect(login).not.toContain("resetPasswordForEmail");
  });
});

describe("la pantalla de restablecer toma el fragmento y lo borra", () => {
  const pagina = leer("src/app/reset-password/page.tsx");

  it("lee el fragmento con la función probada", () => {
    expect(pagina).toContain("const lectura = leeFragmentoRecuperacion(window.location.hash);");
  });

  it("lo borra de la URL ANTES de abrir la sesión, para que los tokens no queden en el historial", () => {
    const borra = pagina.indexOf("window.history.replaceState(null, \"\", window.location.pathname + window.location.search);");
    const abre = pagina.indexOf("setSession({ access_token: lectura.access_token, refresh_token: lectura.refresh_token })");
    expect(borra).toBeGreaterThan(-1);
    expect(abre).toBeGreaterThan(-1);
    expect(borra).toBeLessThan(abre);
  });

  it("y si el fragmento trae error, lo enseña", () => {
    expect(pagina).toContain('if (lectura.kind === "error") {');
    expect(pagina).toContain("lectura.mensaje");
  });
});

// Al cliente, lo mismo pase lo que pase; pero el fallo queda en el log del servidor, y sin el correo.
// Sin esto, «no me llegó el correo» no tendría respuesta: el límite de Supabase, un 5xx y un correo
// mal escrito se verían igual desde fuera.
describe("el fallo del envío se registra en el servidor, sin el correo", () => {
  const origen = "https://hub.example.test";
  const correo = "ana@example.test";

  const conRegistro = () => {
    const registros: RegistroDeFallo[] = [];
    return { registros, registrar: (r: RegistroDeFallo) => { registros.push(r); } };
  };

  it("un { error } devuelto se registra con estado, código y mensaje, y el cliente sigue viendo ok", async () => {
    const { registros, registrar } = conRegistro();
    const res = await pideRecuperacion(correo, origen, async () => ({
      error: { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" },
    }), registrar);
    expect(res).toEqual({ status: 200, body: { ...RESPUESTA_OLVIDO } });
    expect(registros).toEqual([
      { origen: "error", status: 429, code: "over_email_send_rate_limit", mensaje: "email rate limit exceeded" },
    ]);
  });

  it("una excepción también se registra, y el cliente sigue viendo ok", async () => {
    const { registros, registrar } = conRegistro();
    const res = await pideRecuperacion(correo, origen, async () => { throw new TypeError("fetch failed"); }, registrar);
    expect(res.body).toEqual({ ...RESPUESTA_OLVIDO });
    expect(registros).toEqual([{ origen: "excepcion", nombre: "TypeError", mensaje: "fetch failed" }]);
  });

  it("un envío bueno no deja nada en el log", async () => {
    const { registros, registrar } = conRegistro();
    await pideRecuperacion(correo, origen, async () => ({ error: null }), registrar);
    await pideRecuperacion(correo, origen, async () => undefined, registrar);
    expect(registros).toEqual([]);
  });

  it("el correo NO llega al log aunque el mensaje de Supabase lo incluya", async () => {
    const { registros, registrar } = conRegistro();
    await pideRecuperacion(correo, origen, async () => ({
      error: { status: 400, message: `Email address "${correo}" is invalid` },
    }), registrar);
    expect(JSON.stringify(registros)).not.toContain(correo);
    expect(registros[0].mensaje).toBe('Email address "[correo]" is invalid');
  });

  it("y el resumen nunca lleva el correo aunque venga en otra forma", () => {
    expect(resumenDelFallo(new Error("user ana.maria+x@sub.example.test not allowed"), "excepcion").mensaje)
      .toBe("user [correo] not allowed");
    expect(resumenDelFallo(null, "error").mensaje).toBe("sin mensaje");
  });
});
