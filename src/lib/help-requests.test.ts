import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import {
  adjuntosDe, diaLocal, filtraSolicitudes, parcheDeEstado, personasDeSolicitudes, quienEscribe,
  resumenDelEnvio, type SolicitudDeAyuda,
} from "./help-requests";
import { HUB_TOOLS } from "./constants";

/**
 * El historial de solicitudes de ayuda (D-285).
 *
 * **Ningún correo sale de aquí**: `fetch` es un doble. Y ninguna prueba toca la base: el cliente de la
 * sesión y el de servicio son dobles, y lo que se mira es lo que la ruta habría escrito.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const t = (_en: string, es: string) => es;

const fila = (extra: Partial<SolicitudDeAyuda> = {}): SolicitudDeAyuda => ({
  id: "s1", created_at: "2026-09-17T15:00:00.000Z", user_id: "u1", sender_name: "Ana", sender_email: "ana@x.test",
  role_label: "Ventas", page: "/map", app_version: "1.0.0", lang: "es", message: "No carga", files: [],
  email_to: "soporte@x.test", email_ok: true, email_error: null, status: "pendiente", attended_by: null,
  attended_at: null, ...extra,
});

describe("quién escribió y con qué se filtra", () => {
  it("el nombre guardado; si falta, el correo; si falta todo, una raya", () => {
    expect(quienEscribe(fila())).toBe("Ana");
    expect(quienEscribe(fila({ sender_name: "  " }))).toBe("ana@x.test");
    expect(quienEscribe(fila({ sender_name: null, sender_email: null }))).toBe("—");
  });

  it("las personas salen sin repetir y en orden", () => {
    const filas = [fila({ sender_name: "Zoe" }), fila({ sender_name: "Ana" }), fila({ sender_name: "Zoe" })];
    expect(personasDeSolicitudes(filas)).toEqual(["Ana", "Zoe"]);
  });

  it("el día es el local de quien mira, no el prefijo del texto", () => {
    // Dos instantes elegidos para que la prueba valga en cualquier huso, porque el de esta máquina y el
    // del CI no son el mismo: uno de madrugada en UTC (que aquí, con desfase, cae el día anterior) y
    // otro escrito con desfase (que en un huso a cero cae el día siguiente). En los dos, el día es el
    // que dicen los métodos locales de `Date`.
    const p = (n: number) => String(n).padStart(2, "0");
    const casos = ["2026-09-18T02:00:00.000Z", "2026-09-17T23:30:00-06:00"];
    for (const iso of casos) {
      const d = new Date(iso);
      expect(diaLocal(iso), iso).toBe(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
    // Y el atajo de cortar el texto no sirve: en el huso que sea, al menos uno de los dos no coincide.
    expect(casos.some((iso) => diaLocal(iso) !== iso.slice(0, 10))).toBe(true);
    expect(diaLocal("no es fecha")).toBe("");
  });

  // El filtro ya NO separa por estado: las atendidas se van al archivo, y de eso se encarga
  // `separaPorEstado` (D-301, probada en `ayuda-atendida.test.ts`). Aquí queda lo que el filtro sí hace.
  it("filtra por persona y por días (los dos extremos entran), y no mira el estado", () => {
    const dia = diaLocal("2026-09-17T15:00:00.000Z");
    const otroDia = diaLocal("2026-09-10T15:00:00.000Z");
    const filas = [
      fila({ id: "a", sender_name: "Ana" }),
      fila({ id: "b", sender_name: "Zoe", created_at: "2026-09-10T15:00:00.000Z" }),
      fila({ id: "c", sender_name: "Ana", status: "atendida", attended_by: "admin", attended_at: "2026-09-17T16:00:00.000Z" }),
    ];
    expect(filtraSolicitudes(filas, {}).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(filtraSolicitudes(filas, { persona: "Ana" }).map((s) => s.id)).toEqual(["a", "c"]);
    // La atendida («c») sigue saliendo del filtro: quitarla de la vista es cosa del archivo, no de aquí.
    expect(filtraSolicitudes(filas, { persona: "Ana" }).some((s) => s.status === "atendida")).toBe(true);
    expect(filtraSolicitudes(filas, { desde: dia }).map((s) => s.id)).toEqual(["a", "c"]);
    expect(filtraSolicitudes(filas, { hasta: otroDia }).map((s) => s.id)).toEqual(["b"]);
    // El mismo día en los dos extremos incluye lo de ese día.
    expect(filtraSolicitudes(filas, { desde: dia, hasta: dia }).map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("qué pasó con el correo", () => {
  it("salió, no salió con su motivo, o no se sabe", () => {
    expect(resumenDelEnvio(fila({ email_ok: true }), t)).toContain("soporte@x.test");
    expect(resumenDelEnvio(fila({ email_ok: false, email_error: "dominio sin verificar" }), t)).toContain("dominio sin verificar");
    expect(resumenDelEnvio(fila({ email_ok: false, email_error: null }), t)).toContain("sin detalle");
    expect(resumenDelEnvio(fila({ email_ok: null }), t)).toContain("Sin saber");
  });
});

describe("atender una solicitud", () => {
  it("al atenderla se guarda quién y cuándo, que es lo que exige la 120", () => {
    const ahora = new Date("2026-09-17T18:00:00.000Z");
    expect(parcheDeEstado("atendida", "admin-1", ahora)).toEqual({
      status: "atendida", attended_by: "admin-1", attended_at: ahora.toISOString(),
    });
  });

  it("al devolverla a pendiente se limpia la firma", () => {
    expect(parcheDeEstado("pendiente", "admin-1", new Date())).toEqual({
      status: "pendiente", attended_by: null, attended_at: null,
    });
  });

  it("los adjuntos guardados son siempre una lista, y solo los que tienen clave", () => {
    expect(adjuntosDe(fila({ files: null }))).toEqual([]);
    expect(adjuntosDe(fila({ files: [{ path: "u1/a.png", nombre: "a.png" }] }))).toHaveLength(1);
    expect(adjuntosDe(fila({ files: [{ nombre: "sin clave" }] as never }))).toEqual([]);
  });
});

// ---- La ruta guarda la solicitud ----------------------------------------------------------------

const falso = vi.hoisted(() => ({
  insertado: null as Record<string, unknown> | null,
  tablaDondeGuardo: "",
  errorAlInsertar: null as null | { message: string },
  actualizado: [] as { id: unknown; parche: Record<string, unknown> }[],
  enviados: [] as { url: string; cuerpo: Record<string, unknown> }[],
  respuestaDelCorreo: { ok: true, status: 200 },
}));

const insertFalso = (valores: Record<string, unknown>) => {
  falso.insertado = valores;
  return { select: () => ({ maybeSingle: async () => ({ data: falso.errorAlInsertar ? null : { id: "fila-1" }, error: falso.errorAlInsertar }) }) };
};

vi.mock("@/lib/api-auth", () => ({
  requireUser: async () => ({
    ok: true,
    user: { id: "usuario-1", email: "ana@empresa.test" },
    supabase: { from: (tabla: string) => { falso.tablaDondeGuardo = tabla; return { insert: insertFalso }; } },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://firmado/x" }, error: null }) }) },
    from: (_tabla: string) => ({
      update: (parche: Record<string, unknown>) => ({ eq: async (_c: string, id: unknown) => { falso.actualizado.push({ id, parche }); return { error: null }; } }),
    }),
  }),
}));

import { POST as pideAyuda } from "@/app/api/help/route";

const pide = (cuerpo: unknown) =>
  pideAyuda(new Request("http://localhost/api/help", { method: "POST", body: JSON.stringify(cuerpo) }));

beforeEach(() => {
  falso.insertado = null;
  falso.tablaDondeGuardo = "";
  falso.errorAlInsertar = null;
  falso.actualizado = [];
  falso.enviados = [];
  falso.respuestaDelCorreo = { ok: true, status: 200 };
  process.env.RESEND_API_KEY = "llave-de-prueba";
  process.env.NOTIFY_FROM_EMAIL = "Soporte <soporte@example.test>";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    falso.enviados.push({ url: String(url), cuerpo: JSON.parse(init.body) });
    return { ok: falso.respuestaDelCorreo.ok, status: falso.respuestaDelCorreo.status, json: async () => ({}), text: async () => "detalle" } as unknown as Response;
  }));
});

describe("la ruta guarda la solicitud antes de mandar el correo", () => {
  it("guarda quién, dónde, el mensaje y los adjuntos por su clave", async () => {
    await pide({
      message: "No carga", page: "/map", senderName: "Ana", role: "Ventas", appVersion: "1.2.3", lang: "es",
      archivos: [{ path: "usuario-1/2026-a.png", nombre: "a.png" }],
    });
    expect(falso.tablaDondeGuardo).toBe("help_requests");
    expect(falso.insertado).toMatchObject({
      user_id: "usuario-1", sender_name: "Ana", role_label: "Ventas", page: "/map", app_version: "1.2.3",
      lang: "es", message: "No carga",
      files: [{ path: "usuario-1/2026-a.png", nombre: "a.png" }],
    });
  });

  it("y la fila se escribe ANTES de llamar al correo", () => {
    const ruta = leer("src/app/api/help/route.ts");
    expect(ruta.indexOf('.from("help_requests")')).toBeLessThan(ruta.indexOf("https://api.resend.com/emails"));
  });

  it("no guarda los adjuntos de otra persona", async () => {
    await pide({ message: "No carga", archivos: [{ path: "usuario-2/secreto.pdf", nombre: "secreto.pdf" }] });
    expect(falso.insertado?.files).toEqual([]);
  });

  it("si no se pudo guardar, no se manda el correo: la solicitud no se puede perder", async () => {
    falso.errorAlInsertar = { message: "rls" };
    const res = await pide({ message: "No carga" });
    expect(res.status).toBe(500);
    expect(falso.enviados).toHaveLength(0);
  });

  it("el correo que sale queda anotado en la fila", async () => {
    await pide({ message: "No carga" });
    expect(falso.actualizado).toEqual([{ id: "fila-1", parche: { email_ok: true, email_error: null } }]);
  });

  it("el correo que falla también, con su motivo, y la solicitud sigue guardada", async () => {
    falso.respuestaDelCorreo = { ok: false, status: 403 };
    const res = await pide({ message: "No carga" });
    expect(res.status).toBe(502);
    expect(falso.actualizado[0].parche.email_ok).toBe(false);
    expect(String(falso.actualizado[0].parche.email_error)).toContain("403");
  });

  it("sin proveedor de correo, la solicitud se guarda y queda dicho que no salió", async () => {
    delete process.env.RESEND_API_KEY;
    const res = await pide({ message: "No carga" });
    expect(await res.json()).toMatchObject({ dryRun: true });
    expect(falso.insertado).not.toBeNull();
    expect(falso.actualizado[0].parche).toEqual({ email_ok: false, email_error: "email provider not configured" });
  });
});

describe("la herramienta del hub", () => {
  it("está en el registro, solo para el admin", () => {
    const tool = HUB_TOOLS.find((x) => x.key === "help-requests");
    expect(tool?.href).toBe("/home/solicitudes-de-ayuda");
    expect(tool?.visible({ role: "admin" })).toBe(true);
    for (const rol of ["manager", "sales", "logistics", "accounting", "warehouse", "driver"] as const) {
      expect(tool?.visible({ role: rol }), rol).toBe(false);
    }
  });

  it("y su puerta de servidor deja pasar solo al admin", () => {
    const puerta = leer("src/app/home/solicitudes-de-ayuda/layout.tsx");
    expect(puerta).toContain("auth.getUser()");
    expect(puerta).toContain('if (perfil.role !== "admin") redirect(landingRoute(perfil));');
    expect(puerta.indexOf("redirect(landingRoute(perfil))")).toBeLessThan(puerta.indexOf("{children}"));
  });

  it("la pantalla filtra y atiende con las funciones de arriba, y firma los adjuntos al abrirlos", () => {
    const pagina = leer("src/app/home/solicitudes-de-ayuda/page.tsx");
    expect(pagina).toContain("filtraSolicitudes(filas ?? []");
    // El canario se movió con el código: ahora el sentido se decide una vez, en `atiende`, porque el
    // aviso al remitente necesita saberlo (D-301).
    expect(pagina).toContain('const atiende = s.status !== "atendida";');
    expect(pagina).toContain('parcheDeEstado(atiende ? "atendida" : "pendiente", sesion.user.id, new Date())');
    expect(pagina).toContain("createSignedUrl(path, VALIDEZ_AL_ABRIR)");
    expect(pagina).toContain("const VALIDEZ_AL_ABRIR = 300;");
    // Un UPDATE de cero filas no es haber guardado.
    expect(pagina).toContain('.select("id")');
    expect(pagina).toContain("data.length !== 1");
  });
});

describe("la migración 120", () => {
  const sql = leer("supabase/migrations/120_help_requests.sql");
  const politica = (nombre: string) => sql.slice(sql.indexOf(`create policy "${nombre}"`), sql.indexOf(";", sql.indexOf(`create policy "${nombre}"`)));

  it("la tabla guarda el historial y los adjuntos por su clave", () => {
    expect(sql).toContain("create table if not exists public.help_requests");
    expect(sql).toContain("files        jsonb not null default '[]'::jsonb");
    expect(sql).toContain("sender_name  text");
  });

  it("RLS encendida: escribe cada uno lo suyo, lee el admin todo, y solo el admin actualiza", () => {
    expect(sql).toContain("alter table public.help_requests enable row level security;");
    expect(politica("help_requests insert own")).toContain("user_id = (select auth.uid())");
    expect(politica("help_requests select")).toContain("(select public.is_admin()) or user_id = (select auth.uid())");
    expect(politica("help_requests update admin")).toContain("(select public.is_admin())");
    expect(politica("help_requests update admin")).not.toContain("auth.uid()");
  });

  it("el historial no se reescribe, ni con la llave de servicio", () => {
    const guardia = sql.slice(sql.indexOf("create or replace function public.guard_help_request_immutable"), sql.indexOf("drop trigger"));
    for (const col of ["message", "files", "user_id", "created_at", "page"]) {
      expect(guardia, col).toContain(`NEW.${col} `);
    }
    // La condición empieza por la comparación, no por una constante: un `if false and …` dejaría el
    // guardia mudo sin quitar una sola línea (lo cazó un mutante).
    expect(guardia).toContain("if NEW.user_id is distinct from OLD.user_id");
    expect(guardia).not.toContain("false");
    expect(guardia).toContain("raise exception");
    expect(sql).toContain("before update on public.help_requests");
  });

  it("se comprueba a sí misma, trae la matriz por rol con ROLLBACK y se inscribe en el registro", () => {
    expect(sql).toContain("raise exception 'help_requests quedo sin RLS'");
    expect(sql).toContain("Ensayo por rol, con ROLLBACK");
    expect((sql.match(/rollback;/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("-- @ledger-below");
    expect(sql).toContain("values ('120_help_requests.sql'");
  });
});
