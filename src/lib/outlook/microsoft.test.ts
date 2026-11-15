import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ErrorMicrosoft, claveDeErrorMicrosoft, generarPkce, intercambiarCodigo, urlDeAutorizacion } from "./microsoft";
import { MENSAJES_OUTLOOK } from "./mensajes";
import { variablesQueFaltan } from "./config";
import { validaCv } from "./cv";
import { randomBytes } from "node:crypto";

describe("OAuth con Microsoft", () => {
  it("PKCE: el desafío es el SHA-256 del verificador (RFC 7636, ejemplo oficial)", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const p = generarPkce();
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    expect(p.challenge).toBe(createHash("sha256").update(p.verifier).digest("base64url"));
  });

  it("la URL de autorización lleva PKCE, state, prompt y permisos delegados", () => {
    const u = new URL(urlDeAutorizacion({ tenant: "t-1", clientId: "c-1", redirectUri: "https://rtg-hub.vercel.app/api/outlook/callback", state: "S", challenge: "C" }));
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/t-1/oauth2/v2.0/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe("C");
    expect(u.searchParams.get("state")).toBe("S");
    expect(u.searchParams.get("prompt")).toBe("select_account");
    expect(u.searchParams.get("scope")).toBe("offline_access User.Read Mail.Read");
    expect(u.searchParams.get("redirect_uri")).toBe("https://rtg-hub.vercel.app/api/outlook/callback");
  });

  it("un error de token devuelve solo el código AADSTS, no el cuerpo", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "AADSTS65001: x refresh_token=SECRETO" }), { status: 400 })) as typeof fetch;
    const err = await intercambiarCodigo({ tenant: "t", clientId: "c", clientSecret: "s", code: "x", verifier: "v", redirectUri: "r" }, fake).catch((e) => e);
    expect(err).toBeInstanceOf(ErrorMicrosoft);
    expect((err as ErrorMicrosoft).codigo).toBe("AADSTS65001");
    expect((err as Error).message).not.toContain("SECRETO");
  });

  it("traduce el bloqueo de consentimiento a un mensaje claro", () => {
    expect(claveDeErrorMicrosoft("access_denied", "AADSTS90094: admin approval required")).toBe("consentimiento-bloqueado");
    expect(claveDeErrorMicrosoft("access_denied", "AADSTS65004: user declined")).toBe("cancelado");
    expect(claveDeErrorMicrosoft("server_error", "boom")).toBe("microsoft");
    expect(MENSAJES_OUTLOOK["consentimiento-bloqueado"]).toMatch(/administrador/);
  });
});

describe("variables que faltan (solo nombres)", () => {
  it("lista las que faltan y valida la llave", () => {
    expect(variablesQueFaltan({})).toEqual(["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "OUTLOOK_TOKEN_KEY"]);
    const ok = variablesQueFaltan({ MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", OUTLOOK_TOKEN_KEY: randomBytes(32).toString("base64") });
    expect(ok).toEqual([]);
    expect(variablesQueFaltan({ MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", OUTLOOK_TOKEN_KEY: "corta" })).toEqual(["OUTLOOK_TOKEN_KEY"]);
  });
});

describe("validación del CV", () => {
  it("acepta un PDF real por firma y rechaza una extensión falsa", () => {
    expect(validaCv("cv.pdf", Buffer.from("%PDF-1.4 contenido")).ok).toBe(true);
    expect(validaCv("cv.pdf", Buffer.from("MZ no es pdf")).ok).toBe(false);
    expect(validaCv("cv.docx", Buffer.from([0x50, 0x4b, 3, 4, 0])).ok).toBe(true);
    expect(validaCv("foto.jpg", Buffer.from("%PDF")).ok).toBe(false);
    expect(validaCv("cv.pdf", Buffer.alloc(11 * 1024 * 1024, 0x25)).ok).toBe(false);
  });
});

import { cifrar, claveDesdeTexto } from "./cifrado";
import { AAD_OAUTH, leerEstadoOauth, payloadOauth } from "./oauth-estado";

describe("cookie de ida y vuelta", () => {
  const clave = claveDesdeTexto(randomBytes(32).toString("base64"))!;
  const ahora = new Date("2026-11-13T15:00:00Z");
  const sellada = cifrar(JSON.stringify(payloadOauth({ state: "S", verifier: "V", userId: "u1", ahora })), clave, AAD_OAUTH);

  it("ida y vuelta dentro de los 10 minutos", () => {
    expect(leerEstadoOauth(sellada, clave, new Date(ahora.getTime() + 60_000))?.state).toBe("S");
  });

  it("caducada, alterada, de otra llave o sin cookie: null", () => {
    expect(leerEstadoOauth(sellada, clave, new Date(ahora.getTime() + 11 * 60_000))).toBeNull();
    expect(leerEstadoOauth(sellada, claveDesdeTexto(randomBytes(32).toString("base64"))!, ahora)).toBeNull();
    expect(leerEstadoOauth(sellada.slice(0, -2) + "xx", clave, ahora)).toBeNull();
    expect(leerEstadoOauth(undefined, clave, ahora)).toBeNull();
  });
});
