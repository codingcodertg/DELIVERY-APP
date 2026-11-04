import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  documentosDelHilo, enlaceParaCopiar, esIdDeSolicitud, esImagen, escapaHtml, extensionDe, fechaParaClaude,
  htmlDelCorreoDeAyuda, htmlParaClaude, idCorto, imagenesDelHilo, nombreDeDescarga, rutaParaCopiar, textoParaClaude,
  textoParaClaudeCode, type DatosParaClaude,
} from "./ayuda-para-claude";

/**
 * «Copiar para Claude» (D-NEXT).
 *
 * Lo que se decide sin navegador —el texto, el HTML, los nombres de descarga, el enlace del correo— se prueba aquí.
 * El portapapeles, el lienzo y la descarga viven en la pantalla y NO se prueban: vitest no tiene portapapeles, y una
 * prueba que lo finja no podría fallar. De la pantalla se mira que llame a esto y que esté detrás de la puerta.
 *
 * **Ningún correo sale de aquí**: la ruta se prueba con `fetch` doblado, como en `help-attachments.test.ts`.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const ID = "3f2a9c1e-7b44-4d0a-9e21-0c5d8a6b1f00";

const datos = (extra: Partial<DatosParaClaude> = {}): DatosParaClaude => ({
  solicitud: {
    id: ID, created_at: "2026-11-04T16:32:00.000Z", sender_name: "Ana Pérez", sender_email: "ana@empresa.test",
    role_label: "Chofer", page: "https://rtg-hub.vercel.app/driver", app_version: "deliveries 1.300.0", lang: "es",
    message: "No me deja marcar la entrega <b>como hecha</b> & se queda girando.\n\nYa lo intenté dos veces.",
  },
  mensajes: [],
  imagenes: 1,
  ...extra,
});

describe("rutas y enlace", () => {
  it("la pantalla cuelga de las solicitudes del admin, y el correo la lleva absoluta", () => {
    expect(rutaParaCopiar(ID)).toBe(`/home/solicitudes-de-ayuda/${ID}/copiar`);
    expect(enlaceParaCopiar("https://rtg-hub.vercel.app", ID)).toBe(`https://rtg-hub.vercel.app/home/solicitudes-de-ayuda/${ID}/copiar`);
    expect(enlaceParaCopiar("https://rtg-hub.vercel.app/", ID)).toBe(`https://rtg-hub.vercel.app/home/solicitudes-de-ayuda/${ID}/copiar`);
  });

  it("solo un UUID pasa como id", () => {
    expect(esIdDeSolicitud(ID)).toBe(true);
    for (const malo of ["", null, undefined, "abc", `${ID}x`, "../../etc", `${ID.slice(0, 35)}`]) {
      expect(esIdDeSolicitud(malo), String(malo)).toBe(false);
    }
  });
});

describe("nombres de descarga", () => {
  it("ayuda-<id corto>-<n>.<ext>, con la extensión del original", () => {
    expect(idCorto(ID)).toBe("3f2a9c1e");
    expect(nombreDeDescarga(ID, 1, { path: "u/2026-captura.png", nombre: "captura-2026-11-04.png" })).toBe("ayuda-3f2a9c1e-1.png");
    expect(nombreDeDescarga(ID, 2, { path: "u/x.JPEG", nombre: "Foto.JPEG" })).toBe("ayuda-3f2a9c1e-2.jpg");
    expect(nombreDeDescarga(ID, 3, { path: "u/x.webp", nombre: "" })).toBe("ayuda-3f2a9c1e-3.webp");
    // Sin extensión en ningún lado: png, que es lo que hace la captura de Ayuda.
    expect(nombreDeDescarga(ID, 1, { path: "u/sin", nombre: "sin" })).toBe("ayuda-3f2a9c1e-1.png");
  });

  it("la extensión se lee bien, y lo raro no cuenta", () => {
    expect(extensionDe("a.PNG")).toBe("png");
    expect(extensionDe("carpeta/b.tar.gz")).toBe("gz");
    expect(extensionDe(".oculto")).toBe("");
    expect(extensionDe("punto.")).toBe("");
    expect(extensionDe("")).toBe("");
  });
});

describe("qué es una captura", () => {
  const hilo = [
    { files: [{ path: "u/1-a.png", nombre: "a.png" }, { path: "u/1-f.pdf", nombre: "factura.pdf" }] },
    { files: [{ path: "admin/2-b.jpg", nombre: "b.jpg" }, { path: "u/1-a.png", nombre: "a.png" }] },
    { files: null },
    { files: [{ path: "u/3-c.heic", nombre: "" }, { path: "u/3-d.xlsx", nombre: "d.xlsx" }] },
  ];

  it("las imágenes del hilo, en orden y sin repetir; la de la solicitud va primero", () => {
    expect(imagenesDelHilo(hilo).map((a) => a.path)).toEqual(["u/1-a.png", "admin/2-b.jpg", "u/3-c.heic"]);
  });
  it("los documentos, aparte", () => {
    expect(documentosDelHilo(hilo).map((a) => a.nombre)).toEqual(["factura.pdf", "d.xlsx"]);
  });
  it("se mira el nombre y, si no dice nada, la ruta", () => {
    expect(esImagen({ path: "u/x", nombre: "pantalla.WEBP" })).toBe(true);
    expect(esImagen({ path: "u/x.png", nombre: "" })).toBe(true);
    expect(esImagen({ path: "u/x.pdf", nombre: "x.pdf" })).toBe(false);
  });
});

describe("el texto para Claude", () => {
  it("lleva quién, rol, página, versión, fecha, el id y el mensaje entero tal cual", () => {
    const texto = textoParaClaude(datos());
    expect(texto.startsWith("Arregla este problema que reportaron en RTG Hub")).toBe(true);
    expect(texto).toContain("De: Ana Pérez <ana@empresa.test>");
    expect(texto).toContain("Rol: Chofer");
    expect(texto).toContain("Página: https://rtg-hub.vercel.app/driver");
    expect(texto).toContain("Versión de la app: deliveries 1.300.0");
    expect(texto).toContain("2026-11-04T16:32:00.000Z");
    expect(texto).toContain(`Id de la solicitud: ${ID}`);
    // Tal cual: sin escapar, sin traducir, con sus saltos.
    expect(texto).toContain("No me deja marcar la entrega <b>como hecha</b> & se queda girando.\n\nYa lo intenté dos veces.");
    expect(texto).toContain("Te pego la captura de pantalla que mandó.");
  });

  it("con conversación, va después del mensaje, con quién y cuándo; los mensajes vacíos no", () => {
    const texto = textoParaClaude(datos({
      mensajes: [
        { author_name: "Andrés", body: "¿En qué orden?", created_at: "2026-11-04T17:00:00.000Z" },
        { author_name: "Ana Pérez", body: "  ", created_at: "2026-11-04T17:01:00.000Z" },
        { author_name: "Ana Pérez", body: "La 4512", created_at: "2026-11-04T17:05:00.000Z" },
      ],
    }));
    expect(texto).toContain("Conversación después de la solicitud:");
    expect(texto.indexOf("Conversación")).toBeGreaterThan(texto.indexOf("Ya lo intenté"));
    expect(texto).toMatch(/— Andrés \(.*2026-11-04T17:00:00\.000Z\)\):\n¿En qué orden\?/);
    expect(texto).toContain("La 4512");
    expect(texto.match(/— Ana Pérez/g)).toHaveLength(1);
  });

  it("sin capturas no promete ninguna; con varias, dice cuántas", () => {
    expect(textoParaClaude(datos({ imagenes: 0 }))).not.toContain("captura");
    expect(textoParaClaude(datos({ imagenes: 3 }))).toContain("Mandó 3 capturas de pantalla");
  });

  it("lo que falta se dice con una raya, no se inventa", () => {
    const texto = textoParaClaude(datos({
      solicitud: { ...datos().solicitud, sender_name: null, sender_email: null, role_label: null, page: null, app_version: null, lang: null, message: "" },
    }));
    expect(texto).toContain("De: (sin nombre)");
    expect(texto).toContain("Rol: —");
    expect(texto).toContain("(sin texto, solo la captura)");
    expect(texto).not.toContain("Idioma");
  });

  it("los otros adjuntos se nombran", () => {
    expect(textoParaClaude(datos({ documentos: ["factura.pdf"] }))).toContain("Otros adjuntos (no imagen): factura.pdf");
  });

  it("la fecha, en hora del Centro y con el instante exacto", () => {
    expect(fechaParaClaude("2026-11-04T16:32:00.000Z")).toMatch(/10:32.*hora del Centro; 2026-11-04T16:32:00\.000Z/);
    expect(fechaParaClaude("no-es-fecha")).toBe("no-es-fecha");
  });
});

describe("el HTML del portapapeles", () => {
  it("el mismo texto, escapado, en párrafos, con la imagen dentro", () => {
    const html = htmlParaClaude(textoParaClaude(datos()), "data:image/png;base64,iVBORw0KGgo=");
    expect(html).toContain("&lt;b&gt;como hecha&lt;/b&gt; &amp; se queda girando.");
    expect(html).not.toContain("<b>como hecha</b>");
    expect(html).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain("<br>");
  });
  it("sin imagen, o con algo que no es una imagen en data:, no hay <img>", () => {
    expect(htmlParaClaude("hola", null)).toBe("<div><p>hola</p></div>");
    expect(htmlParaClaude("hola", "javascript:alert(1)")).not.toContain("<img");
    expect(htmlParaClaude("hola", "https://x.test/a.png")).not.toContain("<img");
  });
  it("escapa las cinco", () => {
    expect(escapaHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("la línea para Claude Code", () => {
  it("una sola línea con el id y la herramienta que la lee", () => {
    expect(textoParaClaudeCode(ID, 0)).toBe(`Arregla la solicitud de ayuda ${ID} de RTG Hub (léela con ayuda-lee.mjs)`);
    expect(textoParaClaudeCode(ID, 1)).toBe(`Arregla la solicitud de ayuda ${ID} de RTG Hub (léela con ayuda-lee.mjs; su captura está en el cubo help-files)`);
    expect(textoParaClaudeCode(ID, 2)).toContain("sus 2 capturas están en el cubo help-files");
    expect(textoParaClaudeCode(ID, 2)).not.toContain("\n");
  });
});

describe("el HTML del correo", () => {
  const base = {
    mensaje: "No carga <script>",
    contexto: ["From: Ana <ana@empresa.test> (Chofer)", "Page: /driver"],
    adjuntos: [
      { nombre: "captura.png", url: "https://firmado.example/a.png?token=1&x=2" },
      { nombre: "factura.pdf", url: "https://firmado.example/f.pdf" },
      { nombre: "rota.jpg", url: null },
    ],
    enlaceParaCopiar: `https://rtg-hub.vercel.app/home/solicitudes-de-ayuda/${ID}/copiar`,
  };

  it("el botón arriba, el mensaje escapado, el contexto y los adjuntos; la foto pintada dentro", () => {
    const html = htmlDelCorreoDeAyuda(base);
    expect(html.indexOf("📋 Copy for Claude")).toBeLessThan(html.indexOf("No carga"));
    expect(html).toContain(`href="https://rtg-hub.vercel.app/home/solicitudes-de-ayuda/${ID}/copiar"`);
    expect(html).toContain("No carga &lt;script&gt;");
    expect(html).toContain("From: Ana &lt;ana@empresa.test&gt; (Chofer)");
    expect(html).toContain('<img src="https://firmado.example/a.png?token=1&amp;x=2"');
    expect(html).toContain('<a href="https://firmado.example/f.pdf">factura.pdf</a>');
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain("rota.jpg: (link could not be created)");
  });

  it("sin colores a pelo", () => {
    expect(htmlDelCorreoDeAyuda(base)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsl\(/i);
  });

  it("sin enlace, sin botón", () => {
    expect(htmlDelCorreoDeAyuda({ ...base, enlaceParaCopiar: null })).not.toContain("Copy for Claude");
  });
});

// ---- La ruta del correo, con el proveedor doblado -------------------------------------------------------------

const falso = vi.hoisted(() => ({
  enviados: [] as { url: string; cuerpo: Record<string, unknown> }[],
  firmar: vi.fn(async () => ({ data: { signedUrl: "https://firmado.example/x.png" }, error: null as unknown })),
}));

vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => ({
    ok: true,
    user: { id: "usuario-1", email: "ana@empresa.test" },
    supabase: {
      from: () => ({
        insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "3f2a9c1e-7b44-4d0a-9e21-0c5d8a6b1f00" }, error: null }) }) }),
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrl: falso.firmar }) },
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  }),
}));

import { POST as pideAyuda } from "@/app/api/help/route";

describe("el correo de ayuda lleva «📋 Copy for Claude»", () => {
  beforeEach(() => {
    falso.enviados = [];
    process.env.RESEND_API_KEY = "llave-de-prueba";
    process.env.NOTIFY_FROM_EMAIL = "Soporte <soporte@example.test>";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "rtg-hub.vercel.app";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      falso.enviados.push({ url: String(url), cuerpo: JSON.parse(init.body) });
      return { ok: true, json: async () => ({}), text: async () => "" } as unknown as Response;
    }));
  });

  it("en el texto y en el HTML, con el dominio de producción aunque la petición llegue por otro", async () => {
    const res = await pideAyuda(new Request("https://preview-abc.vercel.app/api/help", {
      method: "POST",
      body: JSON.stringify({ message: "No carga", archivos: [{ path: "usuario-1/2026-a.png", nombre: "a.png" }] }),
    }));
    expect(await res.json()).toMatchObject({ ok: true });
    const cuerpo = falso.enviados[0].cuerpo as { text: string; html: string };
    const enlace = `https://rtg-hub.vercel.app/home/solicitudes-de-ayuda/${ID}/copiar`;
    expect(cuerpo.text).toContain(`📋 Copy for Claude: ${enlace}`);
    // Lo de siempre sigue: el mensaje, quién, y el enlace firmado del adjunto.
    expect(cuerpo.text).toContain("No carga");
    expect(cuerpo.text).toContain("From: ");
    expect(cuerpo.text).toContain("a.png: https://firmado.example/x.png");
    expect(cuerpo.html).toContain(`href="${enlace}"`);
    expect(cuerpo.html).toContain('<img src="https://firmado.example/x.png"');
  });
});

describe("la pantalla", () => {
  const RUTA = "src/app/home/solicitudes-de-ayuda/[id]/copiar/page.tsx";
  const pagina = leer(RUTA);

  it("vive debajo del layout de solicitudes, que es solo del admin", () => {
    expect(existsSync(RUTA)).toBe(true);
    expect(leer("src/app/home/solicitudes-de-ayuda/layout.tsx")).toContain('if (perfil.role !== "admin") redirect(landingRoute(perfil));');
  });

  it("copia texto, HTML e imagen PNG en un solo ClipboardItem, sin await antes de escribir", () => {
    expect(pagina).toContain('"text/plain": new Blob([texto], { type: "text/plain" }),');
    expect(pagina).toContain('"text/html": new Blob([htmlParaClaude(texto, dataUrl)], { type: "text/html" }),');
    expect(pagina).toContain('if (primeraPng) partes["image/png"] = primeraPng;');
    expect(pagina).toContain("await navigator.clipboard.write([new ClipboardItem(partes)]);");
  });

  it("las capturas salen del cubo privado con la sesión, y bajan solas una vez con su nombre", () => {
    expect(pagina).toContain("createClient().storage.from(CUBO_DE_ADJUNTOS)");
    expect(pagina).toContain("almacen.download(adjunto.path)");
    expect(pagina).not.toContain("getPublicUrl");
    expect(pagina).toContain("descargaUrl(url, nombreDeDescarga(id, i + 1, c.adjunto))");
    expect(pagina).toContain("descargada.current = true;");
  });

  it("y la bandeja enlaza a ella", () => {
    expect(leer("src/app/home/solicitudes-de-ayuda/page.tsx")).toContain("<Link href={rutaParaCopiar(s.id)}");
  });
});
