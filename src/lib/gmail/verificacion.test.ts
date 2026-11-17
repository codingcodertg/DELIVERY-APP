import { describe, expect, it } from "vitest";
import {
  dkimPasaCon,
  direccionDeFrom,
  esCorreoDeIndeedReenviado,
  esReenvioEnLoteDeCompania,
  primeraAuthResults,
  type CabeceraDeCorreo,
} from "./verificacion";

const c = (name: string, value: string): CabeceraDeCorreo => ({ name: name.toLowerCase(), value });

const GMAIL_OK = "mx.google.com; dkim=pass header.i=@indeed.com header.s=s1 header.b=abc; spf=neutral smtp.mailfrom=x";
const HUELLA_EMPRESA = c("Received", "from BN8NAM12FT012.mail.protection.outlook.com (10.1.2.3) by mx.google.com");

describe("esCorreoDeIndeedReenviado (redirigido por la regla de Outlook)", () => {
  it("acepta un correo de Indeed redirigido: firma de Indeed en Gmail y paso por la empresa", () => {
    const r = esCorreoDeIndeedReenviado([
      c("From", "Indeed <noreply@indeed.com>"),
      c("Authentication-Results", GMAIL_OK),
      HUELLA_EMPRESA,
      c("Received", "from mail.indeed.com (mail.indeed.com [1.2.3.4]) by mx.google.com"),
    ]);
    expect(r.ok).toBe(true);
  });

  it("acepta un subdominio de Indeed (match.indeed.com) con firma de ese subdominio", () => {
    const r = esCorreoDeIndeedReenviado([
      c("From", "Indeed <jobs@match.indeed.com>"),
      c("Authentication-Results", "mx.google.com; dkim=pass header.d=match.indeed.com; spf=pass"),
      HUELLA_EMPRESA,
    ]);
    expect(r.ok).toBe(true);
  });

  it("acepta la huella de la empresa en X-MS-Exchange-Organization-*", () => {
    const r = esCorreoDeIndeedReenviado([
      c("From", "noreply@indeedemail.com"),
      c("Authentication-Results", "mx.google.com; dkim=pass header.d=indeedemail.com"),
      c("X-MS-Exchange-Organization-AuthSource", "bn8nam12.rdztilegroup.net"),
    ]);
    expect(r.ok).toBe(true);
  });

  it("rechaza un correo de Indeed sin huella de la empresa (llegó directo, o es falso)", () => {
    const r = esCorreoDeIndeedReenviado([
      c("From", "Indeed <noreply@indeed.com>"),
      c("Authentication-Results", GMAIL_OK),
      c("Received", "from mail.indeed.com by mx.google.com"),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/empresa/);
  });

  it("rechaza un From de Indeed sin firma de Indeed válida en Gmail (suplantación)", () => {
    const r = esCorreoDeIndeedReenviado([
      c("From", "Indeed <noreply@indeed.com>"),
      c("Authentication-Results", "mx.google.com; dkim=none; spf=fail smtp.mailfrom=evil.example"),
      HUELLA_EMPRESA,
    ]);
    expect(r.ok).toBe(false);
  });

  it("rechaza si la firma de Indeed la hizo otro dominio (dkim=pass d=evil.com)", () => {
    const r = esCorreoDeIndeedReenviado([
      c("From", "Indeed <noreply@indeed.com>"),
      c("Authentication-Results", "mx.google.com; dkim=pass header.d=evil.com"),
      HUELLA_EMPRESA,
    ]);
    expect(r.ok).toBe(false);
  });

  it("rechaza si la primera Authentication-Results no es la de Gmail (la del remitente va debajo y no se fía)", () => {
    const r = esCorreoDeIndeedReenviado([
      c("From", "Indeed <noreply@indeed.com>"),
      c("Authentication-Results", "mx.atacante.example; dkim=pass header.d=indeed.com"),
      c("Authentication-Results", GMAIL_OK),
      HUELLA_EMPRESA,
    ]);
    expect(r.ok).toBe(false);
  });

  it("rechaza sin ninguna Authentication-Results", () => {
    expect(esCorreoDeIndeedReenviado([c("From", "Indeed <noreply@indeed.com>"), HUELLA_EMPRESA]).ok).toBe(false);
  });

  it("rechaza un correo de Gmail normal (no es de Indeed), aunque tenga firma y huella", () => {
    const r = esCorreoDeIndeedReenviado([
      c("From", "Persona <persona@gmail.com>"),
      c("Authentication-Results", "mx.google.com; dkim=pass header.d=gmail.com"),
      HUELLA_EMPRESA,
    ]);
    expect(r.ok).toBe(false);
  });

  it("rechaza un From que imita a Indeed con dominio parecido (indeed.com.evil.example)", () => {
    const r = esCorreoDeIndeedReenviado([
      c("From", "Indeed <noreply@indeed.com.evil.example>"),
      c("Authentication-Results", "mx.google.com; dkim=pass header.d=indeed.com.evil.example"),
      HUELLA_EMPRESA,
    ]);
    expect(r.ok).toBe(false);
  });
});

describe("esReenvioEnLoteDeCompania (bandeja careers@ con adjuntos .eml)", () => {
  it("acepta el mensaje exterior de careers@ con firma de rdztilegroup.net en Gmail", () => {
    const r = esReenvioEnLoteDeCompania([
      c("From", "Careers <careers@rdztilegroup.net>"),
      c("Authentication-Results", "mx.google.com; dkim=pass header.i=@rdztilegroup.net header.s=selector1"),
    ]);
    expect(r.ok).toBe(true);
  });

  it("acepta la firma del dominio onmicrosoft de la empresa", () => {
    const r = esReenvioEnLoteDeCompania([
      c("From", "careers@rdztilegroup.net"),
      c("Authentication-Results", "mx.google.com; dkim=pass header.i=@rdztilegroup.onmicrosoft.com"),
    ]);
    expect(r.ok).toBe(true);
  });

  it("rechaza un exterior que se hace pasar por careers@ sin firma de la empresa", () => {
    const r = esReenvioEnLoteDeCompania([
      c("From", "careers@rdztilegroup.net"),
      c("Authentication-Results", "mx.google.com; dkim=none"),
    ]);
    expect(r.ok).toBe(false);
  });

  it("rechaza otra bandeja aunque esté en el mismo dominio", () => {
    const r = esReenvioEnLoteDeCompania([
      c("From", "ventas@rdztilegroup.net"),
      c("Authentication-Results", "mx.google.com; dkim=pass header.d=rdztilegroup.net"),
    ]);
    expect(r.ok).toBe(false);
  });

  it("rechaza si la firma es de un dominio ajeno", () => {
    const r = esReenvioEnLoteDeCompania([
      c("From", "careers@rdztilegroup.net"),
      c("Authentication-Results", "mx.google.com; dkim=pass header.d=rdztilegroup.net.evil.example"),
    ]);
    expect(r.ok).toBe(false);
  });
});

describe("piezas de lectura", () => {
  it("direccionDeFrom saca la dirección con nombre o sin él, en minúsculas", () => {
    expect(direccionDeFrom([c("From", "Indeed <NoReply@Indeed.com>")])).toBe("noreply@indeed.com");
    expect(direccionDeFrom([c("From", "noreply@indeed.com")])).toBe("noreply@indeed.com");
    expect(direccionDeFrom([])).toBeNull();
  });

  it("primeraAuthResults toma la primera, no la de más abajo", () => {
    const ar = primeraAuthResults([c("Authentication-Results", "mx.google.com; dkim=pass"), c("Authentication-Results", "otro; dkim=fail")]);
    expect(ar?.authserv).toBe("mx.google.com");
  });

  it("dkimPasaCon ignora dkim=fail y comentarios entre paréntesis", () => {
    expect(dkimPasaCon("dkim=fail header.d=indeed.com; dkim=pass (good) header.d=indeed.com", (d) => d === "indeed.com")).toBe(true);
    expect(dkimPasaCon("dkim=fail header.d=indeed.com", () => true)).toBe(false);
  });
});
