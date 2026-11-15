import { describe, expect, it } from "vitest";
import { verificadoComoIndeed } from "./verificacion";
import { enlaceConTexto, enlaceSeguro, extraerEmailsLineal, textoPlanoLineal, TOPE_CUERPO } from "./html-lineal";
import { enFase, seleccionaNuevos, avanzaCursor, FASES_BACKFILL } from "./sincronizar";

const h = (value: string) => [{ name: "Authentication-Results", value }];
const F = "noreply@indeed.com";

describe("verificación del remitente (no basta con el From)", () => {
  it("dmarc=pass → verificado", () => {
    expect(verificadoComoIndeed(h("spf=pass; dkim=pass header.d=indeed.com; dmarc=pass action=none header.from=indeed.com"), F).ok).toBe(true);
  });
  it("dkim=pass con header.d de Indeed → verificado", () => {
    expect(verificadoComoIndeed(h("mx.example; dkim=pass header.d=indeed.com header.s=s1"), F).ok).toBe(true);
  });
  it("dkim=pass de un subdominio de Indeed → verificado", () => {
    expect(verificadoComoIndeed(h("dkim=pass header.d=mail.indeedemail.com"), F).ok).toBe(true);
  });
  it("dkim=pass con d= (sin header.) de Indeed → verificado", () => {
    expect(verificadoComoIndeed(h("dkim=pass (1024-bit key) header.i=@indeedmail.com d=indeedmail.com"), F).ok).toBe(true);
  });
  it("dominio que solo termina parecido → NO verificado", () => {
    expect(verificadoComoIndeed(h("dkim=pass header.d=indeed.com.evil.net"), F).ok).toBe(false);
    expect(verificadoComoIndeed(h("dkim=pass header.d=notindeed.com"), F).ok).toBe(false);
  });
  it("dkim=pass de otro dominio → NO verificado (suplantación)", () => {
    expect(verificadoComoIndeed(h("dkim=pass header.d=gmail.com; dmarc=none"), F).ok).toBe(false);
  });
  it("solo spf=pass, o fallos → NO verificado", () => {
    expect(verificadoComoIndeed(h("spf=pass smtp.mailfrom=indeed.com"), F).ok).toBe(false);
    expect(verificadoComoIndeed(h("dmarc=fail; dkim=fail header.d=indeed.com"), F).ok).toBe(false);
  });
  it("sin cabecera de autenticación → NO verificado", () => {
    expect(verificadoComoIndeed([], F).ok).toBe(false);
    expect(verificadoComoIndeed([{ name: "Subject", value: "x" }], F).ok).toBe(false);
    expect(verificadoComoIndeed(null, F).ok).toBe(false);
  });
  it("solo cuenta la cabecera de arriba (la de Microsoft); una de más abajo, traída por el remitente, no", () => {
    const falsa = [
      { name: "Authentication-Results", value: "spf=fail smtp.mailfrom=evil.net; dmarc=fail header.from=indeed.com" },
      { name: "authentication-results", value: "dmarc=pass header.from=indeed.com" },
    ];
    expect(verificadoComoIndeed(falsa, F).ok).toBe(false);
    const buena = [
      { name: "authentication-results", value: "dkim=pass header.d=indeed.com; dmarc=pass header.from=indeed.com" },
      { name: "Authentication-Results", value: "spf=fail" },
    ];
    expect(verificadoComoIndeed(buena, F).ok).toBe(true);
  });
  it("dmarc=pass de OTRO dominio no vale, aunque el From diga Indeed", () => {
    expect(verificadoComoIndeed(h("dmarc=pass header.from=evil.net"), F).ok).toBe(false);
    expect(verificadoComoIndeed(h("dmarc=pass"), F).ok).toBe(false);
  });
  it("el From tiene que ser de Indeed, aunque la cabecera pase", () => {
    expect(verificadoComoIndeed(h("dkim=pass header.d=indeed.com; dmarc=pass header.from=indeed.com"), "x@evil.net").ok).toBe(false);
    expect(verificadoComoIndeed(h("dkim=pass header.d=indeed.com"), "Indeed <x@evil.net>").ok).toBe(false);
  });
});

describe("enlaces: solo https y solo indeed.com", () => {
  it("acepta https de indeed.com y de sus subdominios", () => {
    expect(enlaceSeguro("https://www.indeed.com/applications/x")).toBe("https://www.indeed.com/applications/x");
    expect(enlaceSeguro("https://indeed.com/resume/y")).toBe("https://indeed.com/resume/y");
  });
  it("rechaza http, otros hosts y trucos de dominio", () => {
    expect(enlaceSeguro("http://www.indeed.com/x")).toBeNull();
    expect(enlaceSeguro("https://www.indeed.com.evil.net/x")).toBeNull();
    expect(enlaceSeguro("https://evil.com/indeed.com")).toBeNull();
    expect(enlaceSeguro("https://notindeed.com/x")).toBeNull();
    expect(enlaceSeguro("javascript:alert(1)")).toBeNull();
    expect(enlaceSeguro("not a url")).toBeNull();
  });
  it("un ancla con texto correcto pero host ajeno no se guarda", () => {
    const cuerpo = '<a href="https://evil.example/fake">See full application</a><a href="https://www.indeed.com/ok">See full application</a>';
    expect(enlaceConTexto(cuerpo, /See full application/i)).toBe("https://www.indeed.com/ok");
    expect(enlaceConTexto('<a href="https://evil.example/fake">See full application</a>', /See full application/i)).toBeNull();
  });
});

describe("HTML a texto: lineal, sin scripts ni estilos", () => {
  it("quita script y style con su contenido, conserva el texto y los saltos de bloque", () => {
    const t = textoPlanoLineal("<style>.x{color:red}</style><p>Name: Ana</p><script>alert('no')</script><p>Phone: 9565550144</p>");
    expect(t).toBe("Name: Ana\nPhone: 9565550144");
  });
  it("un script sin cerrar no se come el resto del correo en un bucle", () => {
    // Un <script> sin </script> es contenido de script hasta el final: no sale nada, y no se cuelga.
    expect(textoPlanoLineal("<script>var x=1; <p>Name: Ana</p>")).toBe("");
  });
});

describe("ReDoS: entradas adversariales terminan rápido", () => {
  const rapido = (fn: () => unknown, limiteMs = 1500) => {
    const t0 = performance.now();
    fn();
    expect(performance.now() - t0).toBeLessThan(limiteMs);
  };

  it("muchas etiquetas <a sin cerrar", () => {
    const malo = "<a href=\"https://www.indeed.com/x\" ".repeat(8000);
    rapido(() => enlaceConTexto(malo, /See full application/i));
  });
  it("muchos < sin '>' y etiquetas anidadas", () => {
    rapido(() => textoPlanoLineal("<".repeat(200_000)));
    rapido(() => textoPlanoLineal("<div ".repeat(40_000)));
  });
  it("correos: un @ rodeado de letras y muchos @", () => {
    rapido(() => extraerEmailsLineal("a".repeat(200_000) + "@" + "b".repeat(200_000)));
    rapido(() => extraerEmailsLineal("@".repeat(200_000)));
  });
  it("espacios y comas en cadena (la ubicación y los saltos)", () => {
    rapido(() => textoPlanoLineal("Name:" + " ".repeat(200_000) + "x"));
  });
  it("cuerpo gigante: solo se leen los primeros 200 KB", () => {
    const cola = "Phone: 9565550199";
    const cuerpo = "x".repeat(TOPE_CUERPO) + "\n" + cola;
    expect(textoPlanoLineal(cuerpo)).not.toContain("9565550199");
  });
});

describe("backfill: orden y no duplicar", () => {
  it("primero solicitudes, después mensajes", () => {
    expect([...FASES_BACKFILL]).toEqual(["solicitud", "mensaje"]);
  });
  it("una solicitud nunca se procesa en la fase de mensajes, y un mensaje nunca en la de solicitudes", () => {
    expect(enFase("application", "solicitud")).toBe(true);
    expect(enFase("application", "mensaje")).toBe(false);
    expect(enFase("message", "mensaje")).toBe(true);
    expect(enFase("message", "solicitud")).toBe(false);
    expect(enFase("other", "solicitud")).toBe(true);
    expect(enFase("other", "mensaje")).toBe(false);
  });
  it("una segunda pasada sobre el mismo rango no crea nada: lo ya visto se descarta", () => {
    const primera = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const vistos = new Set(primera.map((x) => x.id)); // quedaron reclamados en la primera pasada
    expect(seleccionaNuevos(primera, vistos)).toEqual([]);
    expect(seleccionaNuevos([...primera, { id: "d" }], vistos)).toEqual([{ id: "d" }]);
  });
  it("el cursor solo avanza: un rango antiguo no lo mueve hacia atrás", () => {
    const actual = "2026-11-13T10:00:00.000Z";
    expect(avanzaCursor(actual, ["2026-10-01T10:00:00Z"])).toBe(actual);
    expect(avanzaCursor(actual, ["2026-11-14T10:00:00Z", "2026-11-13T11:00:00Z"])).toBe("2026-11-14T10:00:00.000Z");
    expect(avanzaCursor(null, [])).toBeNull();
  });
});
