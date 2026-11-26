import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// Estado de los mocks de Supabase: `vi.hoisted` porque las fábricas de vi.mock se evalúan antes que el resto del fichero.
const estado = vi.hoisted(() => ({
  usuario: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  rol: "sales" as string | null,
  lanza: false,
  rpc: null as unknown as ReturnType<typeof vi.fn>,
  rpcAdmin: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (estado.lanza) throw new Error("sin cookies");
    return {
      auth: { getUser: async () => ({ data: { user: estado.usuario } }) },
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { role: estado.rol }, error: null }) }),
        }),
      }),
      rpc: estado.rpc,
    };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: estado.rpcAdmin }),
}));

import { POST } from "@/app/api/fallas/route";
import { conRegistroDeFallas, registradaComo } from "@/lib/fallas/servidor";

const leer = (r: string) => readFileSync(r, "utf8");

function peticion(cuerpo: unknown, cabeceras: Record<string, string> = {}, crudo?: string): Request {
  return new Request("http://localhost/api/fallas", {
    method: "POST",
    headers: { "content-type": "application/json", ...cabeceras },
    body: crudo ?? JSON.stringify(cuerpo),
  });
}

beforeEach(() => {
  estado.usuario = { id: "11111111-1111-4111-8111-111111111111" };
  estado.rol = "sales";
  estado.lanza = false;
  estado.rpc = vi.fn(async () => ({ error: null }));
  estado.rpcAdmin = vi.fn(async () => ({ error: null }));
});

describe("POST /api/fallas", () => {
  const falla = { origen: "cliente", ruta: "/timetracker/x", mensaje: "boom", pila: "Error: boom\n    at f (a.ts:1:1)" };

  it("escribe con la llave de servicio, y el usuario y el rol son los de la SESIÓN; el cuerpo no los decide", async () => {
    const res = await POST(peticion({ fallas: [{ ...falla, user_id: "evil", p_usuario: "evil", rol: "admin" }] }, { "user-agent": "UA-prueba" }));
    expect(res.status).toBe(204);
    expect(estado.rpc).not.toHaveBeenCalled();
    expect(estado.rpcAdmin).toHaveBeenCalledTimes(1);
    const args = estado.rpcAdmin.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_usuario).toBe("11111111-1111-4111-8111-111111111111");
    expect(args.p_rol).toBe("sales");
    expect(args.p_navegador).toBe("UA-prueba");
    expect(args.p_app).toBe("timetracker");
    expect(args.p_origen).toBe("cliente");
    expect(JSON.stringify(args)).not.toContain("evil");
  });

  it("del navegador solo entra el origen cliente: los demás se descartan sin llamar a la base", async () => {
    for (const origen of ["servidor", "accion", "api", "cron"]) {
      estado.rpcAdmin.mockClear();
      const res = await POST(peticion({ fallas: [{ ...falla, origen }] }));
      expect(res.status, origen).toBe(204);
      expect(estado.rpcAdmin, origen).not.toHaveBeenCalled();
    }
  });

  it("sin sesión no guarda nada y responde 204", async () => {
    estado.usuario = null;
    const res = await POST(peticion({ fallas: [falla] }));
    expect(res.status).toBe(204);
    expect(estado.rpcAdmin).not.toHaveBeenCalled();
  });

  it("si la función no existe (sin la 352) corta al primer error, sin lanzar", async () => {
    estado.rpcAdmin = vi.fn(async () => ({ error: { code: "PGRST202", message: "not found" } }));
    const res = await POST(peticion({ fallas: [falla, falla, falla] }));
    expect(res.status).toBe(204);
    expect(estado.rpcAdmin).toHaveBeenCalledTimes(1);
  });

  it("nunca lanza: si Supabase revienta, responde 204", async () => {
    estado.lanza = true;
    await expect(POST(peticion({ fallas: [falla] }))).resolves.toHaveProperty("status", 204);
  });

  it("cuerpo mal formado o demasiado grande: 204 y nada guardado", async () => {
    expect((await POST(peticion(null, {}, "{no es json"))).status).toBe(204);
    expect((await POST(peticion(null, {}, "x".repeat(40_001)))).status).toBe(204);
    expect(estado.rpcAdmin).not.toHaveBeenCalled();
  });

  it("ignora las fallas que no sirven y guarda las buenas", async () => {
    await POST(peticion({ fallas: [{ origen: "nada", mensaje: "x" }, falla] }));
    expect(estado.rpcAdmin).toHaveBeenCalledTimes(1);
  });
});

describe("conRegistroDeFallas y registradaComo", () => {
  it("devuelve el resultado cuando no hay error, sin registrar nada", async () => {
    await expect(conRegistroDeFallas("x", async () => 7)).resolves.toBe(7);
    expect(estado.rpcAdmin).not.toHaveBeenCalled();
  });

  it("registra con origen y nombre, y VUELVE A LANZAR el mismo error", async () => {
    const error = new Error("fallo de prueba");
    await expect(conRegistroDeFallas("clockIn", async () => { throw error; }, { origen: "accion", app: "timetracker" }))
      .rejects.toBe(error);
    expect(estado.rpcAdmin).toHaveBeenCalledTimes(1);
    const args = estado.rpcAdmin.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_origen).toBe("accion");
    expect(args.p_componente).toBe("clockIn");
    expect(args.p_mensaje).toBe("fallo de prueba");
    expect(args.p_usuario).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("si anotar también falla, el error original sigue siendo el que llega", async () => {
    estado.rpcAdmin = vi.fn(async () => { throw new Error("base caída"); });
    const error = new Error("original");
    await expect(conRegistroDeFallas("x", async () => { throw error; })).rejects.toBe(error);
  });

  it("registradaComo envuelve un handler: mismo resultado en el camino bueno, mismo error en el malo", async () => {
    const ok = registradaComo("/api/x", "GET", async (a: number) => a * 2, "cron");
    await expect(ok(21)).resolves.toBe(42);
    const error = new Error("cron roto");
    const malo = registradaComo("/api/cron/x", "GET", async () => { throw error; }, "cron");
    await expect(malo()).rejects.toBe(error);
    const args = estado.rpcAdmin.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_origen).toBe("cron");
    expect(args.p_ruta).toBe("/api/cron/x");
  });
});

describe("cableado en el código", () => {
  it("el layout raíz monta el detector y el disparador de prueba, una vez", () => {
    const layout = leer("src/app/layout.tsx");
    expect(layout.match(/<DetectorDeFallas \/>/g)).toHaveLength(1);
    expect(layout).toContain('import { DetectorDeFallas } from "@/components/DetectorDeFallas";');
  });

  it("el detector escucha errores no capturados y promesas rechazadas", () => {
    const d = leer("src/components/DetectorDeFallas.tsx");
    expect(d).toContain('"error"');
    expect(d).toContain('"unhandledrejection"');
  });

  it("la pantalla de error de segmento y la global informan la falla y ofrecen reintentar", () => {
    for (const f of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
      const s = leer(f);
      expect(s).toContain("informarFalla(");
      expect(s).toContain("reset()");
    }
  });

  it("el gancho de Next anota cada error de servidor con su origen: cron, api, accion o servidor", async () => {
    const previo = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = "nodejs";
    try {
      const { onRequestError } = await import("@/instrumentation");
      const base = { routerKind: "App Router" as const, revalidateReason: undefined };
      await onRequestError(new Error("a"), { path: "/api/cron/rc-comms", method: "GET" }, { ...base, routePath: "/api/cron/rc-comms", routeType: "route" });
      await onRequestError(new Error("b"), { path: "/api/route-plan", method: "POST" }, { ...base, routePath: "/api/route-plan", routeType: "route" });
      await onRequestError(new Error("c"), { path: "/timetracker/clock-in", method: "POST" }, { ...base, routePath: "/timetracker/clock-in", routeType: "action" });
      await onRequestError(new Error("d"), { path: "/home", method: "GET" }, { ...base, routePath: "/home", routeType: "render" });
      const origenes = estado.rpcAdmin.mock.calls.map((c) => (c[1] as Record<string, unknown>).p_origen);
      expect(origenes).toEqual(["cron", "api", "accion", "servidor"]);
      const rutas = estado.rpcAdmin.mock.calls.map((c) => (c[1] as Record<string, unknown>).p_ruta);
      expect(rutas[0]).toBe("/api/cron/rc-comms");
    } finally {
      if (previo === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = previo;
    }
  });

  it("no anota dos veces el mismo error, ni las redirecciones de Next", async () => {
    const previo = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = "nodejs";
    try {
      const { onRequestError } = await import("@/instrumentation");
      const ctx = { routerKind: "App Router" as const, revalidateReason: undefined, routePath: "/api/x", routeType: "route" as const };
      const error = new Error("una vez");
      await conRegistroDeFallas("x", async () => { throw error; }, { origen: "api" }).catch(() => undefined);
      await onRequestError(error, { path: "/api/x", method: "GET" }, ctx);
      expect(estado.rpcAdmin).toHaveBeenCalledTimes(1);
      const redireccion = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
      await onRequestError(redireccion, { path: "/x", method: "GET" }, ctx);
      expect(estado.rpcAdmin).toHaveBeenCalledTimes(1);
    } finally {
      if (previo === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = previo;
    }
  });

  it("si la base falla al anotar, el gancho no lanza", async () => {
    const previo = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = "nodejs";
    try {
      estado.rpcAdmin = vi.fn(async () => { throw new Error("caída"); });
      const { onRequestError } = await import("@/instrumentation");
      const ctx = { routerKind: "App Router" as const, revalidateReason: undefined, routePath: "/api/x", routeType: "route" as const };
      await expect(onRequestError(new Error("y"), { path: "/api/x", method: "GET" }, ctx)).resolves.toBeUndefined();
    } finally {
      if (previo === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = previo;
    }
  });

  it("las rutas que exportan el envoltorio y las acciones se quedan como estaban (sin tocar sus fuentes)", () => {
    const route = leer("src/app/api/route-plan/route.ts");
    expect(route).toMatch(/^export async function POST\(req: Request\)/m);
    expect(leer("src/app/timetracker/clock-in/actions/clock.ts")).not.toContain("conRegistroDeFallas");
  });

  it("el hub lista la pantalla de fallas solo para el admin real", () => {
    const c = leer("src/lib/constants.ts");
    expect(c).toContain('href: "/home/fallas"');
    expect(c).toMatch(/key: "fallas"[\s\S]*?visible: \(me\) => soloAdminReal\(me\)/);
  });
});
