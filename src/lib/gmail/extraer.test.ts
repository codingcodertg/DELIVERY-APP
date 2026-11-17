import { describe, expect, it } from "vitest";
import { correosDeIndeedEnMensaje } from "./extraer";

const enc = (s: string) => Buffer.from(s.replace(/\n/g, "\r\n"), "utf8");

/** Un correo de Indeed redirigido por la regla de Outlook: lo que llega a Gmail con la firma de Indeed y la huella. */
const REDIRIGIDO = `From: Indeed <noreply@indeed.com>
To: owner@gmail.com
Subject: New application: Cashier - Maria Lopez
Message-ID: <solicitud-1@indeed.com>
Date: Sun, 01 Mar 2026 09:00:00 +0000
Authentication-Results: mx.google.com; dkim=pass header.i=@indeed.com header.s=s1; spf=softfail smtp.mailfrom=bounce.example
Received: from BN8NAM12FT012.mail.protection.outlook.com (10.1.2.3) by mx.google.com
Content-Type: text/html; charset=utf-8

<html><body><p>Name: Maria Lopez</p><p>Phone: (956) 555-0182</p>
<a href="https://www.indeed.com/applications/abc">See full application</a></body></html>
`;

/** Mismo correo, reenviado en lote desde careers@ como adjunto .eml. */
const EN_LOTE = `From: Careers <careers@rdztilegroup.net>
To: owner@gmail.com
Subject: Fwd: New application: Cashier - Maria Lopez
Message-ID: <reenvio-1@rdztilegroup.net>
Date: Mon, 02 Mar 2026 10:00:00 +0000
Authentication-Results: mx.google.com; dkim=pass header.i=@rdztilegroup.net header.s=selector1
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="LIMITE"

--LIMITE
Content-Type: text/plain; charset=utf-8

Reenviado.
--LIMITE
Content-Type: message/rfc822
Content-Disposition: attachment; filename="solicitud.eml"

From: Indeed <noreply@indeed.com>
To: careers@rdztilegroup.net
Subject: New application: Cashier - Maria Lopez
Message-ID: <solicitud-1@indeed.com>
Date: Sun, 01 Mar 2026 09:00:00 +0000
Content-Type: text/plain; charset=utf-8

Name: Maria Lopez
Phone: (956) 555-0182
--LIMITE--
`;

describe("correosDeIndeedEnMensaje", () => {
  it("un correo redirigido de Indeed da un correo listo para el pipeline, con clave por Message-ID", async () => {
    const r = await correosDeIndeedEnMensaje(enc(REDIRIGIDO), { uidvalidity: 5, uid: 40, fechaRespaldo: null });
    expect(r).toHaveLength(1);
    const it = r[0];
    expect(it.ok).toBe(true);
    if (!it.ok) return;
    expect(it.via).toBe("redirigido");
    expect(it.mensaje.clave).toBe("gmail:solicitud-1@indeed.com");
    expect(it.mensaje.fromAddress).toBe("noreply@indeed.com");
    expect(it.mensaje.subject).toContain("New application");
    expect(it.mensaje.bodyText).toContain("See full application");
    expect(it.mensaje.verificacion?.ok).toBe(true);
  });

  it("un reenvío en lote da el correo interior de Indeed, con la misma clave que el redirigido", async () => {
    const r = await correosDeIndeedEnMensaje(enc(EN_LOTE), { uidvalidity: 5, uid: 41, fechaRespaldo: null });
    expect(r).toHaveLength(1);
    const it = r[0];
    expect(it.ok).toBe(true);
    if (!it.ok) return;
    expect(it.via).toBe("reenvio-en-lote");
    expect(it.mensaje.clave).toBe("gmail:solicitud-1@indeed.com");
    expect(it.mensaje.fromAddress).toBe("noreply@indeed.com");
    expect(it.mensaje.bodyText).toContain("Maria Lopez");
  });

  it("un reenvío en lote cuyo exterior no tiene firma de la empresa se rechaza", async () => {
    const falso = EN_LOTE.replace("dkim=pass header.i=@rdztilegroup.net header.s=selector1", "dkim=none");
    const r = await correosDeIndeedEnMensaje(enc(falso), { uidvalidity: 5, uid: 42, fechaRespaldo: null });
    expect(r).toEqual([expect.objectContaining({ ok: false })]);
  });

  it("un adjunto .eml que no es de Indeed no se acepta", async () => {
    const otro = EN_LOTE.replace("From: Indeed <noreply@indeed.com>", "From: Persona <persona@gmail.com>");
    const r = await correosDeIndeedEnMensaje(enc(otro), { uidvalidity: 5, uid: 43, fechaRespaldo: null });
    expect(r).toEqual([expect.objectContaining({ ok: false, motivo: "adjunto .eml que no es de Indeed" })]);
  });

  it("un correo de Gmail normal no produce nada", async () => {
    const normal = `From: Persona <persona@gmail.com>
To: owner@gmail.com
Subject: Hola
Message-ID: <x@gmail.com>
Authentication-Results: mx.google.com; dkim=pass header.d=gmail.com
Content-Type: text/plain

Hola.
`;
    expect(await correosDeIndeedEnMensaje(enc(normal), { uidvalidity: 5, uid: 44, fechaRespaldo: null })).toEqual([]);
  });

  it("un Indeed directo sin huella de la empresa se rechaza con motivo", async () => {
    const directo = REDIRIGIDO.replace("Received: from BN8NAM12FT012.mail.protection.outlook.com (10.1.2.3) by mx.google.com\n", "");
    const r = await correosDeIndeedEnMensaje(enc(directo), { uidvalidity: 5, uid: 45, fechaRespaldo: null });
    expect(r).toEqual([expect.objectContaining({ ok: false })]);
  });
});
