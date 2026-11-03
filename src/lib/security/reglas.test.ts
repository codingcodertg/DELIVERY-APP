import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  COOKIE_DISPOSITIVO, ROLES_SIN_LIMITE, ROLES_SOLO_ESCRITORIO, RUTA_BLOQUEADO, RUTA_SOLO_ESCRITORIO, appsEnElTelefono, decideAcceso, decideWeb, idDeDispositivoValido,
  nombrePorAgente, tipoPorAgente, type PuertaDeDispositivo,
} from "./reglas";
import { isPublicPath } from "@/lib/route-guard";

/**
 * D-811: la regla de acceso por dispositivo. El dueño: «solo usen el desktop app para evitar que se puedan loguear
 * desde su casa»; salespeople desde su teléfono registrado solo al Time Tracker, y Quote Builder al salir a visitar
 * un cliente; warehouse y driver sin límite. Y nace apagada: «hasta que te dé el comando se va a activar».
 */
const puerta = (extra: Partial<PuertaDeDispositivo> = {}): PuertaDeDispositivo =>
  ({ enforced: true, role: "sales", device_status: "approved", device_kind: "desktop", visit_open: false, ...extra });

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

describe("apagada, no hace nada", () => {
  it("con enforced=false pasa todo el mundo desde cualquier sitio", () => {
    expect(decideAcceso("/", puerta({ enforced: false, device_status: "none" }))).toEqual({ kind: "next" });
    expect(decideAcceso("/leads", puerta({ enforced: false, device_status: "revoked", role: "manager" }))).toEqual({ kind: "next" });
  });
  it("sin puerta (la 229 sin aplicar, un fallo de red) pasa: la dirección segura de la 107", () => {
    expect(decideAcceso("/customers", null)).toEqual({ kind: "next" });
    expect(decideAcceso("/customers", undefined)).toEqual({ kind: "next" });
  });
  it("la 229 nace con la política en false", () => {
    const sql = leer("supabase/migrations/229_security_dispositivos.sql");
    expect(sql).toContain("insert into public.security_policy (id, enforced) values (1, false)");
    expect(sql).toContain("raise exception '229: la política no nació apagada'");
  });
});

describe("encendida: quién pasa", () => {
  it("admin, warehouse y driver, desde cualquier dispositivo, aunque no esté registrado", () => {
    expect(ROLES_SIN_LIMITE).toEqual(["admin", "warehouse", "driver"]);
    for (const role of ROLES_SIN_LIMITE) {
      expect(decideAcceso("/", puerta({ role, device_status: "none" }))).toEqual({ kind: "next" });
      expect(decideAcceso("/my-route", puerta({ role, device_status: "revoked", device_kind: "phone" }))).toEqual({ kind: "next" });
    }
  });
  it("manager, sales, office y logistics desde una computadora APROBADA: todo", () => {
    for (const role of ["manager", "sales", "accounting", "logistics"]) {
      expect(decideAcceso("/customers", puerta({ role, device_kind: "desktop" }))).toEqual({ kind: "next" });
      expect(decideAcceso("/leads", puerta({ role, device_kind: "browser" }))).toEqual({ kind: "next" });
    }
  });
  it("desde un dispositivo pendiente, revocado o desconocido: a /device-blocked", () => {
    for (const device_status of ["pending", "revoked", "none", null]) {
      expect(decideAcceso("/", puerta({ device_status }))).toEqual({ kind: "redirect", to: RUTA_BLOQUEADO, motivo: "no_autorizado" });
    }
  });
  it("…y /device-blocked se sirve, que si no es un bucle", () => {
    expect(decideAcceso(RUTA_BLOQUEADO, puerta({ device_status: "none" }))).toEqual({ kind: "next" });
    expect(isPublicPath(RUTA_BLOQUEADO)).toBe(true);
  });
});

describe("encendida: el teléfono aprobado de un vendedor", () => {
  const tel = (extra: Partial<PuertaDeDispositivo> = {}) => puerta({ device_kind: "phone", ...extra });
  it("Time Tracker entero, el hub y lo de su cuenta: sí", () => {
    for (const p of ["/timetracker", "/timetracker/clock-in", "/timetracker/reports", "/home", "/change-password", "/no-access"]) {
      expect(decideAcceso(p, tel())).toEqual({ kind: "next" });
    }
  });
  it("Quote Builder solo con una visita abierta", () => {
    expect(decideAcceso("/estimator", tel())).toEqual({ kind: "redirect", to: "/timetracker", motivo: "solo_telefono" });
    expect(decideAcceso("/estimator", tel({ visit_open: true }))).toEqual({ kind: "next" });
    expect(decideAcceso("/estimator/abc", tel({ visit_open: true }))).toEqual({ kind: "next" });
  });
  it("leads, clientes, entregas y lo demás: a /timetracker, aunque haya visita", () => {
    for (const p of ["/", "/leads", "/customers", "/orders", "/promos", "/recruiting", "/erp/catalog"]) {
      expect(decideAcceso(p, tel({ visit_open: true }))).toEqual({ kind: "redirect", to: "/timetracker", motivo: "solo_telefono" });
    }
  });
  it("y el hub solo le enseña esas apps", () => {
    expect(appsEnElTelefono(tel())).toEqual(["timetracker"]);
    expect(appsEnElTelefono(tel({ visit_open: true }))).toEqual(["timetracker", "estimator"]);
    expect(appsEnElTelefono(puerta())).toBeNull();
    expect(appsEnElTelefono(puerta({ enforced: false, device_kind: "phone" }))).toBeNull();
    expect(appsEnElTelefono(tel({ role: "warehouse" }))).toBeNull();
  });
  it("/timetrackerx no es /timetracker", () => {
    expect(decideAcceso("/timetrackerx", tel())).toEqual({ kind: "redirect", to: "/timetracker", motivo: "solo_telefono" });
  });
});

describe("qué es el dispositivo, por su agente", () => {
  it("la app de escritorio, un móvil, un navegador", () => {
    expect(tipoPorAgente("Mozilla/5.0 (Windows NT 10.0) Chrome/130 RTGHub/1.1.1")).toBe("desktop");
    expect(tipoPorAgente("Mozilla/5.0 (Windows NT 10.0) Chrome/130 RDZHub/1.0.0")).toBe("desktop");
    expect(tipoPorAgente("Mozilla/5.0 (Linux; Android 14) Mobile Chrome/130")).toBe("phone");
    expect(tipoPorAgente("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1")).toBe("phone");
    expect(tipoPorAgente("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36")).toBe("browser");
    expect(tipoPorAgente(null)).toBe("browser");
  });
  it("un nombre legible mientras el admin no le pone uno", () => {
    expect(nombrePorAgente("Mozilla/5.0 (Windows NT 10.0) Chrome/130 RTGHub/1.1.1")).toBe("RTG Hub · Windows");
    expect(nombrePorAgente("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36")).toBe("Chrome · Windows");
    expect(nombrePorAgente("Mozilla/5.0 (iPhone) Safari/604.1")).toBe("Safari · iPhone");
  });
  it("el id: lo que genera el cliente; ni vacío, ni basura, ni gigante", () => {
    expect(idDeDispositivoValido("5b2c0d4e-1f2a-4b3c-9d8e-7f6a5b4c3d2e")).toBe(true);
    expect(idDeDispositivoValido("")).toBe(false);
    expect(idDeDispositivoValido("abc")).toBe(false);
    expect(idDeDispositivoValido("x".repeat(65))).toBe(false);
    expect(idDeDispositivoValido("a b; drop")).toBe(false);
    expect(COOKIE_DISPOSITIVO).toBe("rtg_device");
  });
});

describe("dónde está enchufado", () => {
  it("el middleware pregunta la puerta con la cookie y aplica la decisión antes del guard", () => {
    const src = leer("src/lib/supabase/middleware.ts");
    expect(src).toContain('supabase.rpc("security_gate", { p_device: dispositivo })');
    expect(src).toContain("decideAcceso(path, puertaDeDispositivo)");
  });
  it("el registro (security_touch_device) lo llama la ruta /api/security/seen con la sesión de quien entra", () => {
    const src = leer("src/app/api/security/seen/route.ts");
    expect(src).toContain('rpc("security_touch_device"');
    expect(src).toContain("requireUser()");
  });
  it("la identidad del dispositivo se monta una vez, en el layout raíz", () => {
    expect(leer("src/app/layout.tsx")).toContain("<IdentidadDelDispositivo />");
  });
  it("la 229: tres tablas con RLS, solo admin; las dos funciones security definer solo para authenticated", () => {
    const sql = leer("supabase/migrations/229_security_dispositivos.sql");
    for (const t of ["public.security_devices", "public.security_device_users", "public.security_policy"]) expect(sql).toMatch(new RegExp(`alter table ${t.replace(".", "[.]")} +enable row level security`));
    expect(sql).toContain("revoke execute on function public.security_gate(text) from public, anon");
    expect(sql).toContain("revoke execute on function public.security_touch_device(text, text, text, boolean) from public, anon");
    expect(sql).toContain("t.employee_id = auth.uid() and t.ended_at is null");
    expect(sql).not.toMatch(/^\s*(begin|commit);/m);
  });
});

// ---------------------------------------------------------------------------
// D-816: la web bloqueada para manager, sales y logistics (231)
// ---------------------------------------------------------------------------
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const APP = `${CHROME} RTGHub/1.1.1`;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const web = (extra: Partial<PuertaDeDispositivo> = {}): PuertaDeDispositivo => puerta({ enforced: false, device_status: "none", device_kind: null, web_blocked: true, ...extra });

describe("D-816: la web bloqueada", () => {
  it("apagada, o sin puerta, o sin el campo (la 229 sola): pasa todo el mundo", () => {
    expect(decideWeb("/leads", web({ web_blocked: false }), CHROME)).toEqual({ kind: "next" });
    expect(decideWeb("/leads", null, CHROME)).toEqual({ kind: "next" });
    expect(decideWeb("/leads", puerta({ enforced: false }), CHROME)).toEqual({ kind: "next" });
  });
  it("los roles: manager, sales y logistics; accounting, admin, warehouse y driver no", () => {
    expect([...ROLES_SOLO_ESCRITORIO]).toEqual(["manager", "sales", "logistics"]);
    for (const role of ROLES_SOLO_ESCRITORIO) expect(decideWeb("/leads", web({ role }), CHROME)).toEqual({ kind: "redirect", to: RUTA_SOLO_ESCRITORIO, motivo: "solo_escritorio" });
    for (const role of ["admin", "warehouse", "driver", "accounting"]) expect(decideWeb("/leads", web({ role }), CHROME)).toEqual({ kind: "next" });
  });
  it("la app de escritorio pasa a todo, también la 1.1.1 (la pantalla de D-814 la obliga a actualizar); esté o no aprobado el dispositivo", () => {
    expect(decideWeb("/leads", web(), APP)).toEqual({ kind: "next" });
    expect(decideWeb("/leads", web({ device_status: "revoked" }), APP)).toEqual({ kind: "next" });
  });
  it("un navegador de computadora: fuera, salvo la pantalla del bloqueo y lo de la cuenta", () => {
    expect(decideWeb("/", web(), CHROME)).toEqual({ kind: "redirect", to: RUTA_SOLO_ESCRITORIO, motivo: "solo_escritorio" });
    expect(decideWeb("/timetracker", web(), CHROME).kind).toBe("redirect");
    expect(decideWeb("/home", web(), CHROME).kind).toBe("redirect");
    for (const p of [RUTA_SOLO_ESCRITORIO, RUTA_BLOQUEADO, "/change-password", "/no-access"]) expect(decideWeb(p, web(), CHROME)).toEqual({ kind: "next" });
    expect(isPublicPath(RUTA_SOLO_ESCRITORIO)).toBe(true);
  });
  it("un teléfono: solo Time Tracker, el hub y la cuenta; Quote Builder con visita abierta; lo demás a /timetracker", () => {
    expect(decideWeb("/timetracker/punch", web(), IPHONE)).toEqual({ kind: "next" });
    expect(decideWeb("/home", web(), IPHONE)).toEqual({ kind: "next" });
    expect(decideWeb("/leads", web(), IPHONE)).toEqual({ kind: "redirect", to: "/timetracker", motivo: "solo_telefono" });
    expect(decideWeb("/estimator", web(), IPHONE)).toEqual({ kind: "redirect", to: "/timetracker", motivo: "solo_telefono" });
    expect(decideWeb("/estimator", web({ visit_open: true }), IPHONE)).toEqual({ kind: "next" });
    expect(appsEnElTelefono(web(), IPHONE)).toEqual(["timetracker"]);
    expect(appsEnElTelefono(web({ visit_open: true }), IPHONE)).toEqual(["timetracker", "estimator"]);
    expect(appsEnElTelefono(web(), CHROME)).toBeNull();
    expect(appsEnElTelefono(web({ role: "admin" }), IPHONE)).toBeNull();
  });
  it("la 231: el campo nace en false, security_gate lo devuelve; el middleware la aplica tras la regla por dispositivo; el interruptor en Security y en el script", () => {
    const sql = leer("supabase/migrations/231_security_web_bloqueada.sql");
    expect(sql).toContain("add column if not exists web_blocked boolean not null default false");
    expect(sql).toContain("visit_open boolean, web_blocked boolean)");
    expect(sql).toContain("grant  execute on function public.security_gate(text) to authenticated");
    expect(sql).not.toMatch(/(^|\s)(begin|commit);/);
    const mw = leer("src/lib/supabase/middleware.ts");
    expect(mw).toContain(`decideWeb(path, puertaDeDispositivo, request.headers.get("user-agent"))`);
    expect(leer("src/app/security/PanelDeSeguridad.tsx")).toContain("cambiaPoliticaWeb(!webBloqueada)");
    expect(leer("scripts/db/security-policy.mjs")).toContain("--web-on");
    const pantalla = leer("src/app/web-blocked/BloqueadoEnWeb.tsx");
    expect(pantalla).toContain("La web app ya no está disponible");
    expect(pantalla).toContain("/api/desktop-update/");
  });
});
