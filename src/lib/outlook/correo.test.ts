import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cuerpoDeCorreo, listarPaginaDeBandeja } from "./correo";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

type Llamada = { url: string; headers: Record<string, string> };

/** Un `fetch` de mentira que graba la URL y las cabeceras, y responde con `cuerpo`. */
function fetchDoble(cuerpo: unknown, status = 200) {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init?: { headers?: Record<string, string> }) => {
    llamadas.push({ url: String(url), headers: init?.headers ?? {} });
    return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

const mensajeDeLista = {
  value: [
    {
      id: "m1",
      internetMessageId: "<a@b>",
      subject: "Johnathon Garza applied",
      from: { emailAddress: { address: "NoReply@Indeed.com", name: "Indeed" } },
      replyTo: [],
      receivedDateTime: "2026-11-16T10:00:00Z",
      hasAttachments: false,
      internetMessageHeaders: [{ name: "Authentication-Results", value: "spf=pass" }],
    },
  ],
};

describe("listarPaginaDeBandeja: la lista no pide el cuerpo", () => {
  it("el $select no lleva body y sí lleva las cabeceras que necesita la verificación de Indeed", async () => {
    const { f, llamadas } = fetchDoble(mensajeDeLista);
    const pagina = await listarPaginaDeBandeja("tok", { desdeIso: "2026-11-01T00:00:00Z", saltar: 0, tope: 50 }, f);
    const url = decodeURIComponent(llamadas[0].url);
    const select = /\$select=([^&]+)/.exec(url)?.[1] ?? "";
    expect(select.split(",")).not.toContain("body");
    expect(select.split(",")).toContain("internetMessageHeaders");
    expect(select.split(",")).toContain("from");
    expect(llamadas[0].headers.prefer).toBeUndefined();
    expect(pagina.mensajes[0].bodyText).toBe("");
    expect(pagina.mensajes[0].fromAddress).toBe("noreply@indeed.com");
    expect(pagina.mensajes[0].cabeceras).toEqual([{ name: "Authentication-Results", value: "spf=pass" }]);
  });
});

describe("cuerpoDeCorreo: el cuerpo de un solo correo, en texto", () => {
  it("pide ese correo con $select=body y devuelve su contenido", async () => {
    const { f, llamadas } = fetchDoble({ body: { contentType: "text", content: "Hola Ana" } });
    expect(await cuerpoDeCorreo("tok", "m 1", f)).toBe("Hola Ana");
    expect(llamadas[0].url).toMatch(/\/me\/messages\/m%201\?\$select=body$/);
    expect(llamadas[0].headers.prefer).toBe('outlook.body-content-type="text"');
  });

  it("sin cuerpo devuelve cadena vacía; un HTTP de error lanza", async () => {
    expect(await cuerpoDeCorreo("tok", "m1", fetchDoble({}).f)).toBe("");
    await expect(cuerpoDeCorreo("tok", "m1", fetchDoble({}, 500).f)).rejects.toThrow();
  });
});

describe("sincronizar: el cuerpo solo se pide para remitentes de Indeed", () => {
  const src = leer("src/lib/outlook/sincronizar.ts");

  it("cada llamada a cuerpoDeCorreo va justo después del filtro de Indeed (dos sitios: revisión y lote antiguo)", () => {
    const patron = /if \(!esCorreoDeIndeed\(m\.from\)\) continue;[\s\S]{0,200}?await cuerpoDeCorreo\(/g;
    expect(src.match(patron)?.length ?? 0).toBe(2);
    expect(src.split("await cuerpoDeCorreo(").length - 1).toBe(2);
  });
});
