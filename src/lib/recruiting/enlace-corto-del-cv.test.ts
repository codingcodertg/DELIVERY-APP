import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bytesAUuid, DIAS_DEL_ENLACE_CORTO, diaDeCaducidad, leerTokenDelCv, tokenDelCv, urlDelCv, uuidABytes } from "./enlace-corto-del-cv";

// D-NEXT · «no podemos hacer un link para el cv mas corto mucho mas corto?» (el dueño, 2026-10-19).

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
const SECRETO = "cv-link:secreto-de-prueba";
const ID = "8f3e2c1a-9b0d-4e4f-8a1b-0123456789ab";
const HOY = new Date("2026-10-19T15:00:00Z");
const dias = (n: number) => new Date(HOY.getTime() + n * 86_400_000);

describe("el token: corto, firmado y con fecha", () => {
  it("35 caracteres (24 de carga, punto, 10 de firma); la URL completa ronda los 60", () => {
    const tok = tokenDelCv(ID, SECRETO, HOY)!;
    expect(tok).toMatch(/^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{10}$/);
    const url = urlDelCv("https://rtg-hub.vercel.app/", tok);
    expect(url).toBe(`https://rtg-hub.vercel.app/api/cv/${tok}`);
    expect(url.length).toBeLessThan(70);
  });
  it("se lee de vuelta con el mismo secreto; vale hoy y 7 días; al octavo caduca", () => {
    const tok = tokenDelCv(ID, SECRETO, HOY)!;
    expect(leerTokenDelCv(tok, SECRETO, HOY)).toEqual({ ok: true, candidateId: ID });
    expect(leerTokenDelCv(tok, SECRETO, dias(DIAS_DEL_ENLACE_CORTO))).toEqual({ ok: true, candidateId: ID });
    expect(leerTokenDelCv(tok, SECRETO, dias(DIAS_DEL_ENLACE_CORTO + 1))).toEqual({ ok: false, motivo: "caducado" });
    expect(leerTokenDelCv(tok, SECRETO, dias(400))).toEqual({ ok: false, motivo: "caducado" });
    expect(diaDeCaducidad(HOY)).toBe(Math.floor(HOY.getTime() / 86_400_000) + 7);
  });
  it("otro secreto, una letra cambiada o una forma rara: no pasa, y no dice el id", () => {
    const tok = tokenDelCv(ID, SECRETO, HOY)!;
    expect(leerTokenDelCv(tok, "cv-link:otro", HOY)).toEqual({ ok: false, motivo: "firma" });
    const [carga, firma] = tok.split(".");
    const otraFirma = (firma[0] === "A" ? "B" : "A") + firma.slice(1);
    expect(leerTokenDelCv(`${carga}.${otraFirma}`, SECRETO, HOY)).toEqual({ ok: false, motivo: "firma" });
    expect(leerTokenDelCv("hola", SECRETO, HOY)).toEqual({ ok: false, motivo: "malformado" });
    expect(leerTokenDelCv("", SECRETO, HOY)).toEqual({ ok: false, motivo: "malformado" });
    // Cambiar un byte de la carga (otro candidato) también tumba la firma.
    const bytes = Buffer.from(carga, "base64url"); bytes[0] ^= 0xff;
    expect(leerTokenDelCv(`${bytes.toString("base64url")}.${firma}`, SECRETO, HOY).ok).toBe(false);
  });
  it("el id va y vuelve en 16 bytes; uno que no es UUID no da token", () => {
    expect(bytesAUuid(uuidABytes(ID)!)).toBe(ID);
    expect(uuidABytes("no-es-uuid")).toBeNull();
    expect(tokenDelCv("no-es-uuid", SECRETO, HOY)).toBeNull();
  });
});

describe("las rutas y el botón", () => {
  it("la pública (/api/cv/<token>): sin sesión, 404 a todo lo que no pase, y redirige a un enlace de Storage de un minuto", () => {
    const r = leer("src/app/api/cv/[token]/route.ts");
    expect(r).not.toContain("requireUser");
    expect(r).toContain("const leido = leerTokenDelCv(token, secretoDelCv());");
    expect(r).toContain('if (!leido.ok) return new NextResponse("Not found", { status: 404 });');
    expect(r).toContain('select("resume_path").eq("id", leido.candidateId).maybeSingle()');
    expect(r).toContain('createSignedUrl(c.resume_path, 60)');
    expect(r).toContain("return NextResponse.redirect(data.signedUrl, 302);");
  });
  it("la que lo crea (/api/recruiting/cv-link): sesión + RLS, y devuelve la URL con el origen de la app", () => {
    const r = leer("src/app/api/recruiting/cv-link/route.ts");
    expect(r).toContain("const auth = await requireUser();");
    expect(r).toContain('select("id, resume_path").eq("id", id).maybeSingle()');
    expect(r).toContain("return NextResponse.json({ url: urlDelCv(new URL(req.url).origin, token) });");
  });
  it("«Copiar para el gerente» pide el enlace corto al servidor en vez del firmado largo (D-590)", () => {
    const prov = leer("src/lib/recruiting-data-provider.tsx");
    expect(prov).toContain("resumeLink: (candidateId: string) => Promise<string | null>;");
    expect(prov).toContain('const res = await fetch("/api/recruiting/cv-link", {');
    expect(prov).not.toContain("createSignedUrl(c.resume_path, seconds)");
    const boton = leer("src/components/recruiting/BotonCopiarParaElGerente.tsx");
    expect(boton).toContain("const cvEnlace = c.resume_path ? await resumeLink(c.id) : null;");
    expect(boton).not.toContain("SEGUNDOS_DEL_ENLACE_DEL_CV");
  });
});
