import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Quién puede mandar un SMS y llamar por la centralita, y con qué número de origen (D-505).
 *
 * `/api/notify` y `/api/call` valían para **cualquier** sesión: tras `requireUser()` solo se
 * comprobaba que los campos existieran, y detrás estaba el proveedor de verdad — RingCentral,
 * Resend— con el número y el dominio de la empresa. Y en `/api/call` el número de ORIGEN lo
 * elegía el cliente (hallazgo S-5, `docs/AUDIT-2026-10-09.md`).
 *
 * **Nada de esto sale de la máquina.** El proveedor está stubbeado: `proveedorReal` y
 * `ringcentral` son dobles, y lo que se mide es con qué se les habría llamado — o que no se les
 * llamó. Es la forma que exige la regla permanente del proyecto (ver CLAUDE.md), y la que no se
 * respetó al verificar D-172, cuando una prueba con sesión inició un RingOut real.
 */

const ORIGEN_DEL_SERVIDOR = "+15550000000"; // inventado, y nunca se marca: el proveedor es un doble.

const falso = vi.hoisted(() => ({
  usuario: null as { id: string } | null,
  perfil: { data: null as Record<string, unknown> | null, error: null as { message: string } | null },
  sms: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, proveedor: "ringcentral" })),
  correo: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  ringOut: vi.fn(async (..._a: unknown[]) => ({ id: "llamada-1", status: "InProgress" })),
  ringOutStatus: vi.fn(async (..._a: unknown[]) => ({ callStatus: "InProgress" })),
  ringOutCancel: vi.fn(async (..._a: unknown[]) => undefined),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: falso.usuario } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => falso.perfil }) }) }),
  }),
}));
vi.mock("@/lib/mensajeria", () => ({ proveedorReal: { sms: falso.sms, correo: falso.correo } }));
vi.mock("@/lib/email", () => ({ emailConfigured: () => false }));
vi.mock("@/lib/ringcentral", () => ({
  ringcentralConfigured: () => true,
  ringcentralRingOut: falso.ringOut,
  ringcentralRingOutStatus: falso.ringOutStatus,
  ringcentralRingOutCancel: falso.ringOutCancel,
}));

import { GET as notifyGET, POST as notifyPOST } from "@/app/api/notify/route";
import { DELETE as callDELETE, GET as callGET, POST as callPOST } from "@/app/api/call/route";

const avisa = (cuerpo: unknown) =>
  notifyPOST(new Request("http://localhost/api/notify", { method: "POST", body: JSON.stringify(cuerpo) }));
const llama = (cuerpo: unknown) =>
  callPOST(new Request("http://localhost/api/call", { method: "POST", body: JSON.stringify(cuerpo) }));

/** Quién llama: su rol de Entregas y los módulos que tiene concedidos. */
function sesion(role: string, module_access: string[] | null) {
  falso.usuario = { id: "quien-llama" };
  falso.perfil = { data: { role, module_access }, error: null };
}

const ninguno = () => [falso.sms, falso.correo, falso.ringOut].every((d) => d.mock.calls.length === 0);

beforeEach(() => {
  vi.stubEnv("RINGCENTRAL_RINGOUT_FROM", ORIGEN_DEL_SERVIDOR);
  vi.stubEnv("RINGCENTRAL_FROM", "+15550000001");
  falso.usuario = null;
  falso.perfil = { data: null, error: null };
  for (const d of [falso.sms, falso.correo, falso.ringOut, falso.ringOutStatus, falso.ringOutCancel]) d.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("POST /api/notify", () => {
  it("sin sesión: 401 y no se manda nada", async () => {
    expect((await avisa({ channel: "sms", to: "+15551234567", message: "x" })).status).toBe(401);
    expect(ninguno()).toBe(true);
  });

  it("con sesión pero SIN el módulo de Entregas: 403 y el SMS no sale", async () => {
    // El caso de la auditoría: alguien que solo ficha. Tiene sesión, y con eso le bastaba.
    sesion("sales", ["timetracker"]);
    const r = await avisa({ channel: "sms", to: "+15551234567", message: "x" });
    expect(r.status).toBe(403);
    expect(ninguno()).toBe(true);
  });

  it("tampoco sale el correo sin el módulo", async () => {
    sesion("sales", ["timetracker"]);
    expect((await avisa({ channel: "email", to: "x@y.z", subject: "s", message: "m" })).status).toBe(403);
    expect(falso.correo).not.toHaveBeenCalled();
  });

  it("con el módulo de Entregas: el SMS sale por el proveedor de siempre", async () => {
    sesion("sales", ["deliveries"]);
    const r = await avisa({ channel: "sms", to: "+15551234567", message: "su entrega va en camino" });
    expect(r.status).toBe(200);
    expect(falso.sms.mock.calls).toEqual([["+15551234567", "su entrega va en camino"]]);
  });

  it("un admin pasa aunque no tenga la casilla marcada", async () => {
    // El mismo espejo que `has_deliveries_access()` (083): el admin entra siempre.
    sesion("admin", null);
    expect((await avisa({ channel: "sms", to: "+15551234567", message: "x" })).status).toBe(200);
    expect(falso.sms).toHaveBeenCalledTimes(1);
  });

  it("el chofer también manda: el seguimiento se comparte desde su ficha", async () => {
    sesion("driver", ["deliveries"]);
    expect((await avisa({ channel: "sms", to: "+15551234567", message: "x" })).status).toBe(200);
  });

  it("si no se pudo LEER el perfil: 503, no un 403 que diga que no tiene permiso", async () => {
    // Mismo criterio que la geocerca de D-505: no conceder nada, pero no afirmar lo que no se midió.
    falso.usuario = { id: "quien-llama" };
    falso.perfil = { data: null, error: { message: "canceling statement due to statement timeout" } };
    const r = await avisa({ channel: "sms", to: "+15551234567", message: "x" });
    expect(r.status).toBe(503);
    expect(ninguno()).toBe(true);
  });

  it("sin fila de perfil: 403 — eso sí se midió", async () => {
    falso.usuario = { id: "quien-llama" };
    falso.perfil = { data: null, error: null };
    expect((await avisa({ channel: "sms", to: "+15551234567", message: "x" })).status).toBe(403);
  });
});

describe("GET /api/notify", () => {
  it("sin el módulo no dice ni qué proveedor hay puesto", async () => {
    sesion("sales", ["timetracker"]);
    expect((await notifyGET()).status).toBe(403);
  });

  it("con el módulo, contesta la configuración", async () => {
    sesion("manager", ["deliveries"]);
    const r = await notifyGET();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ email: false });
  });
});

describe("POST /api/call", () => {
  it("el número de ORIGEN lo pone el servidor: el del cliente se ignora", async () => {
    sesion("manager", ["deliveries"]);
    const r = await llama({ to: "+15551234567", from: "+19999999999" });
    expect(r.status).toBe(200);
    expect(falso.ringOut.mock.calls).toEqual([[ORIGEN_DEL_SERVIDOR, "+15551234567"]]);
    expect(JSON.stringify(falso.ringOut.mock.calls)).not.toContain("+19999999999");
  });

  it("sin el módulo de Entregas: 403 y no se marca ningún número", async () => {
    sesion("sales", ["timetracker"]);
    expect((await llama({ to: "+15551234567" })).status).toBe(403);
    expect(falso.ringOut).not.toHaveBeenCalled();
  });

  it("un chofer con Entregas sí llama: el botón está en su ficha de orden", async () => {
    sesion("driver", ["deliveries"]);
    expect((await llama({ to: "+15551234567" })).status).toBe(200);
    expect(falso.ringOut).toHaveBeenCalledTimes(1);
  });

  it("sin sesión: 401 y no se marca nada", async () => {
    expect((await llama({ to: "+15551234567" })).status).toBe(401);
    expect(falso.ringOut).not.toHaveBeenCalled();
  });

  it("sin destino: 400 antes de tocar el proveedor", async () => {
    sesion("manager", ["deliveries"]);
    expect((await llama({})).status).toBe(400);
    expect(falso.ringOut).not.toHaveBeenCalled();
  });
});

describe("GET y DELETE /api/call", () => {
  it("sin el módulo, el GET no filtra el número de la empresa", async () => {
    sesion("sales", ["timetracker"]);
    const r = await callGET(new Request("http://localhost/api/call"));
    expect(r.status).toBe(403);
    expect(JSON.stringify(await r.json())).not.toContain(ORIGEN_DEL_SERVIDOR);
  });

  it("sin el módulo, el DELETE no cuelga la llamada de otro", async () => {
    sesion("sales", ["timetracker"]);
    expect((await callDELETE(new Request("http://localhost/api/call?id=llamada-1", { method: "DELETE" }))).status).toBe(403);
    expect(falso.ringOutCancel).not.toHaveBeenCalled();
  });

  it("con el módulo, el estado de una llamada se consulta igual que antes", async () => {
    sesion("manager", ["deliveries"]);
    const r = await callGET(new Request("http://localhost/api/call?id=llamada-1"));
    expect(r.status).toBe(200);
    expect(falso.ringOutStatus.mock.calls).toEqual([["llamada-1"]]);
  });
});
