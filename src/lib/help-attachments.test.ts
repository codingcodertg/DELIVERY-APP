import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import {
  CUBO_DE_ADJUNTOS, LIMITES_DE_ADJUNTOS, VALIDEZ_DEL_ENLACE, esMiRuta, lineasDeAdjuntos,
  mensajeDeAdjunto, nombreSaneado, rutaDeAdjunto, validaAdjuntos,
} from "./help-attachments";

/**
 * Documentos y fotos en la solicitud de ayuda (D-NEXT).
 *
 * **Ningún correo sale de aquí.** La ruta se prueba con el proveedor simulado: `fetch` es un doble, así
 * que Resend no se llama nunca, y lo que se mira es el cuerpo que la ruta habría mandado.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const t = (_en: string, es: string) => es;
const fichero = (name: string, size = 1024, type = "image/png") => ({ name, size, type });

const falso = vi.hoisted(() => ({
  sesion: { ok: true as boolean, id: "usuario-1", email: "ana@empresa.test" as string | undefined },
  firmar: vi.fn(async (_ruta?: string, _seg?: number) => ({ data: { signedUrl: "https://firmado.example/x" }, error: null as unknown })),
  from: vi.fn((_cubo?: string) => ({ createSignedUrl: falso.firmar })),
  enviados: [] as { url: string; cuerpo: Record<string, unknown> }[],
}));

vi.mock("@/lib/api-auth", () => ({
  requireUser: async () =>
    falso.sesion.ok
      ? { ok: true, user: { id: falso.sesion.id, email: falso.sesion.email }, supabase: {} }
      : { ok: false, response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: falso.from } }) }));

import { POST as pideAyuda } from "@/app/api/help/route";

const pide = (cuerpo: unknown) =>
  pideAyuda(new Request("http://localhost/api/help", { method: "POST", body: JSON.stringify(cuerpo) }));

beforeEach(() => {
  falso.sesion = { ok: true, id: "usuario-1", email: "ana@empresa.test" };
  falso.enviados = [];
  falso.firmar.mockClear();
  falso.from.mockClear();
  process.env.RESEND_API_KEY = "llave-de-prueba";
  process.env.NOTIFY_FROM_EMAIL = "Soporte <soporte@example.test>";
  // El doble de `fetch`: aquí muere cualquier intento de mandar un correo de verdad.
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    falso.enviados.push({ url: String(url), cuerpo: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ id: "correo-1" }), text: async () => "" } as unknown as Response;
  }));
});

describe("qué se acepta", () => {
  it("nada elegido, y lo normal, pasan", () => {
    expect(validaAdjuntos([])).toBeNull();
    expect(validaAdjuntos([fichero("captura.png"), fichero("factura.pdf", 2048, "application/pdf")])).toBeNull();
  });

  it("más de cinco, no", () => {
    expect(validaAdjuntos(Array.from({ length: 6 }, (_, i) => fichero(`f${i}.png`)))).toEqual({ motivo: "cuantos" });
    expect(validaAdjuntos(Array.from({ length: 5 }, (_, i) => fichero(`f${i}.png`)))).toBeNull();
  });

  it("más de 10 MB, no; justo 10 MB, sí", () => {
    expect(validaAdjuntos([fichero("gorda.png", LIMITES_DE_ADJUNTOS.maxBytes + 1)])).toEqual({ motivo: "tamano", fichero: "gorda.png" });
    expect(validaAdjuntos([fichero("justa.png", LIMITES_DE_ADJUNTOS.maxBytes)])).toBeNull();
  });

  it("lo que no es foto ni documento, no", () => {
    expect(validaAdjuntos([fichero("programa.exe", 10, "application/x-msdownload")])).toEqual({ motivo: "tipo", fichero: "programa.exe" });
    expect(validaAdjuntos([fichero("sin-tipo", 10, "")])).toEqual({ motivo: "tipo", fichero: "sin-tipo" });
  });

  it("el aviso dice qué pasa y con cuál", () => {
    expect(mensajeDeAdjunto({ motivo: "cuantos" }, t)).toContain("5");
    expect(mensajeDeAdjunto({ motivo: "tamano", fichero: "gorda.png" }, t)).toContain("gorda.png");
    expect(mensajeDeAdjunto({ motivo: "tamano", fichero: "x" }, t)).toContain("10 MB");
    expect(mensajeDeAdjunto({ motivo: "tipo", fichero: "programa.exe" }, t)).toContain("programa.exe");
  });
});

describe("con qué nombre y en qué carpeta se guarda", () => {
  it("el nombre pierde la ruta, los acentos y los espacios, y conserva la extensión", () => {
    expect(nombreSaneado("C:\\Users\\ana\\Mi Captura.PNG")).toBe("Mi-Captura.PNG");
    expect(nombreSaneado("José a̶ño.pdf")).toBe("Jose-ano.pdf");
    expect(nombreSaneado("../../etc/passwd")).toBe("passwd");
    expect(nombreSaneado("")).toBe("archivo");
    expect(nombreSaneado("a".repeat(200) + ".png").length).toBeLessThanOrEqual(80);
  });

  it("la carpeta es quien sube, que es de lo que vive la política del cubo", () => {
    const ruta = rutaDeAdjunto("usuario-1", "Mi Captura.png", new Date("2026-09-17T15:04:05.000Z"));
    expect(ruta.startsWith("usuario-1/")).toBe(true);
    expect(ruta).toContain("Mi-Captura.png");
    expect(ruta).not.toContain(":"); // los dos puntos no valen en una clave de Storage
  });

  it("y por eso se comprueba antes de firmar nada", () => {
    expect(esMiRuta("usuario-1/2026-x.png", "usuario-1")).toBe(true);
    expect(esMiRuta("usuario-2/2026-x.png", "usuario-1")).toBe(false);
    expect(esMiRuta("usuario-1/../usuario-2/x.png", "usuario-1")).toBe(false);
    expect(esMiRuta("", "usuario-1")).toBe(false);
    expect(esMiRuta("usuario-1/x.png", "")).toBe(false);
  });
});

describe("las líneas del correo", () => {
  it("sin adjuntos no hay sección", () => {
    expect(lineasDeAdjuntos([])).toEqual([]);
  });

  it("con adjuntos, uno por línea, y el que no se pudo firmar lo dice", () => {
    const l = lineasDeAdjuntos([{ nombre: "a.png", url: "https://x/1" }, { nombre: "b.pdf", url: null }]);
    expect(l.join("\n")).toContain("Attachments (2)");
    expect(l.join("\n")).toContain("a.png: https://x/1");
    expect(l.join("\n")).toContain("b.pdf: (link could not be created)");
  });
});

describe("la ruta firma lo mío y nada más", () => {
  const cuerpoDelCorreo = () => String((falso.enviados[0]?.cuerpo as { text?: string })?.text ?? "");

  it("un adjunto propio viaja como enlace firmado del cubo privado, de larga validez", async () => {
    const res = await pide({ message: "No carga", archivos: [{ path: "usuario-1/2026-a.png", nombre: "a.png" }] });
    expect(await res.json()).toMatchObject({ ok: true });
    expect(falso.from).toHaveBeenCalledWith(CUBO_DE_ADJUNTOS);
    expect(falso.firmar).toHaveBeenCalledWith("usuario-1/2026-a.png", VALIDEZ_DEL_ENLACE);
    expect(VALIDEZ_DEL_ENLACE).toBe(60 * 60 * 24 * 30);
    expect(cuerpoDelCorreo()).toContain("a.png: https://firmado.example/x");
  });

  it("la ruta de otra persona no se firma ni sale en el correo", async () => {
    await pide({ message: "No carga", archivos: [{ path: "usuario-2/2026-secreto.pdf", nombre: "secreto.pdf" }] });
    expect(falso.firmar).not.toHaveBeenCalled();
    expect(cuerpoDelCorreo()).not.toContain("secreto.pdf");
    expect(cuerpoDelCorreo()).not.toContain("Attachments");
  });

  it("nunca más de cinco, aunque el cliente mande diez", async () => {
    await pide({
      message: "No carga",
      archivos: Array.from({ length: 10 }, (_, i) => ({ path: `usuario-1/${i}.png`, nombre: `${i}.png` })),
    });
    expect(falso.firmar).toHaveBeenCalledTimes(LIMITES_DE_ADJUNTOS.maxFicheros);
  });

  it("si firmar falla, la solicitud se manda igual y el correo lo dice", async () => {
    falso.firmar.mockImplementationOnce(async () => { throw new Error("storage caído"); });
    const res = await pide({ message: "No carga", archivos: [{ path: "usuario-1/2026-a.png", nombre: "a.png" }] });
    expect(await res.json()).toMatchObject({ ok: true });
    expect(cuerpoDelCorreo()).toContain("a.png: (link could not be created)");
  });

  it("sin adjuntos, ni se toca el almacén", async () => {
    await pide({ message: "No carga" });
    expect(falso.from).not.toHaveBeenCalled();
    expect(cuerpoDelCorreo()).not.toContain("Attachments");
  });

  it("y el correo se manda a Resend, con el mensaje dentro (control de que el doble se usa)", async () => {
    await pide({ message: "No carga la pantalla" });
    expect(falso.enviados).toHaveLength(1);
    expect(falso.enviados[0].url).toBe("https://api.resend.com/emails");
    expect(cuerpoDelCorreo()).toContain("No carga la pantalla");
  });
});

describe("la pantalla sube al mismo sitio y con las mismas reglas", () => {
  const boton = leer("src/components/HelpButton.tsx");

  it("valida antes de subir, con la función compartida", () => {
    expect(boton).toContain("const fallo = validaAdjuntos(juntos);");
    expect(boton).toContain("notify(mensajeDeAdjunto(fallo, t));");
  });

  it("sube al cubo privado, con la ruta que empieza por el id de quien sube", () => {
    expect(boton).toContain(`createClient().storage.from(CUBO_DE_ADJUNTOS)`);
    expect(boton).toContain("const path = rutaDeAdjunto(me.id, f.name, new Date());");
  });

  it("si una subida falla, no se manda la solicitud", () => {
    expect(boton).toContain("const archivos = await subeFicheros();");
    expect(boton).toContain("if (!archivos) { setBusy(false); return; }");
  });

  it("y las rutas viajan a la ruta de ayuda", () => {
    expect(boton).toContain("archivos,");
  });
});

describe("la migración del cubo", () => {
  const sql = leer("supabase/migrations/119_help_files_bucket.sql");

  it("el cubo es privado, con el mismo tope que la pantalla", () => {
    expect(sql).toContain("'help-files', 'help-files', false, 10485760");
    expect(LIMITES_DE_ADJUNTOS.maxBytes).toBe(10485760);
  });

  it("cada uno escribe y lee en su carpeta, y el admin lee todo", () => {
    // Por política, no por fichero: la carpeta propia tiene que estar en LAS TRES que la necesitan.
    // Mirando el fichero entero, quitarla de una sola pasaba desapercibido (lo cazó un mutante).
    const politica = (nombre: string) => {
      const ini = sql.indexOf(`create policy "${nombre}"`);
      expect(ini, nombre).toBeGreaterThan(0);
      return sql.slice(ini, sql.indexOf(";", ini));
    };
    for (const nombre of ["help files insert own", "help files read own", "help files delete own"]) {
      expect(politica(nombre), nombre).toContain("(storage.foldername(name))[1] = (select auth.uid())::text");
    }
    expect(politica("help files read admin")).toContain("(select public.is_admin())");
    expect(politica("help files read admin")).not.toContain("foldername");
  });

  it("los tipos del cubo son los de la pantalla", () => {
    for (const tipo of LIMITES_DE_ADJUNTOS.tipos) expect(sql, tipo).toContain(`'${tipo}'`);
  });

  it("se comprueba a sí misma y se inscribe en el registro", () => {
    expect(sql).toContain("raise exception 'el cubo help-files no quedo privado con su limite'");
    expect(sql).toContain("-- @ledger-below");
    expect(sql).toContain("insert into public.schema_migrations (name, checksum) values ('119_help_files_bucket.sql'");
  });
});
