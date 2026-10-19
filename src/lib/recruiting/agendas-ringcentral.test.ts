import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AGENDA_DEL_SERVIDOR, agendasExtraDesde, notaDelGuardado } from "./agendas-ringcentral";

// D-594 · «osea yo solo quiero que el contacto me aparezca a mi tambien mas que todo en mi ring central agenda» (el dueño,
// 2026-10-19). Su RingCentral es otra cuenta: una app suya + su JWT, en `RINGCENTRAL_AGENDAS_EXTRA`.

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
const andres = { nombre: "Andrés", clientId: "3nON…", clientSecret: "s3cr3t", jwt: "eyJ…" };

describe("agendasExtraDesde: la variable, validada", () => {
  it("una lista JSON de {nombre, clientId, clientSecret, jwt}, limpia de espacios", () => {
    expect(agendasExtraDesde(JSON.stringify([{ ...andres, nombre: " Andrés " }]))).toEqual([andres]);
    expect(agendasExtraDesde(JSON.stringify([andres, { ...andres, nombre: "Otro" }])).map((a) => a.nombre)).toEqual(["Andrés", "Otro"]);
  });
  it("vacía, mal formada o que no es lista: ninguna; una entrada incompleta se salta y las demás siguen", () => {
    expect(agendasExtraDesde(undefined)).toEqual([]);
    expect(agendasExtraDesde("")).toEqual([]);
    expect(agendasExtraDesde("{no es json")).toEqual([]);
    expect(agendasExtraDesde(JSON.stringify({ ...andres }))).toEqual([]);
    expect(agendasExtraDesde(JSON.stringify([{ nombre: "Sin jwt", clientId: "a", clientSecret: "b" }, andres, null, 7]))).toEqual([andres]);
    expect(agendasExtraDesde(JSON.stringify([{ ...andres, jwt: "  " }]))).toEqual([]);
  });
  it("la traza dice en qué agendas quedó; sin agendas, solo el nombre", () => {
    expect(notaDelGuardado("Andres Ugarte WA BRO", ["Careers", "Andrés"])).toBe("Andres Ugarte WA BRO · Careers, Andrés");
    expect(notaDelGuardado("Andres Ugarte WA BRO", [])).toBe("Andres Ugarte WA BRO");
    expect(AGENDA_DEL_SERVIDOR).toBe("Careers");
  });
});

describe("el servidor escribe en la agenda de Careers Y en cada agenda extra, cada una con sus credenciales", () => {
  it("el helper de RingCentral acepta credenciales por llamada (token, agenda y alta); sin ellas, las del servidor", () => {
    const rc = leer("src/lib/ringcentral.ts");
    expect(rc).toContain("export async function ringcentralToken(creds?: { clientId: string; clientSecret: string; jwt: string }): Promise<string> {");
    expect(rc).toContain("const id = creds?.clientId ?? process.env.RINGCENTRAL_CLIENT_ID!;");
    expect(rc).toContain("const jwt = creds?.jwt ?? process.env.RINGCENTRAL_JWT!;");
    expect(rc).toContain("export async function ringcentralContacts(creds?: { clientId: string; clientSecret: string; jwt: string }): Promise<Record<string, unknown>[]> {\n  const token = await ringcentralToken(creds);");
    expect(rc).toContain("export async function ringcentralAddContact(contact: Record<string, string>, creds?: { clientId: string; clientSecret: string; jwt: string }): Promise<void> {\n  const token = await ringcentralToken(creds);");
  });
  it("la ruta recorre Careers + las extras, cada una aparte (allSettled), no duplica por teléfono en ninguna, y dice agendas y fallos", () => {
    const ruta = leer("src/app/api/recruiting/rc-contact/route.ts");
    expect(ruta).toContain("const extras = agendasExtraDesde(process.env.RINGCENTRAL_AGENDAS_EXTRA);");
    expect(ruta).toContain("guardarEn(AGENDA_DEL_SERVIDOR, cuerpo, c.phone),\n    ...extras.map((a) => guardarEn(a.nombre, cuerpo, c.phone, a)),");
    expect(ruta).toContain("const resultados = await Promise.allSettled([");
    expect(ruta).toContain("if (yaEstaEnLaAgenda(agenda, phone)) return { nombre, created: false };\n  await ringcentralAddContact(cuerpo, creds);");
    expect(ruta).toContain('if (agendas.length === 0) return NextResponse.json({ error: fallos.join(" · ") }, { status: 502 });');
    expect(ruta).toContain("return NextResponse.json({ ok: true, created, display, agendas, fallos });");
  });
  it("el proveedor deja la traza con las agendas y avisa los fallos sin perder lo que sí se guardó", () => {
    const prov = leer("src/lib/recruiting-data-provider.tsx");
    expect(prov).toContain("...contactoDelGuardado(notaDelGuardado(b.display ?? \"\", agendas))");
    expect(prov).toContain('if (Array.isArray(b.fallos) && b.fallos.length) notify("RingCentral: " + b.fallos.join(" · "));');
  });
});
