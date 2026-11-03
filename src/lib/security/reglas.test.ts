import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  COOKIE_DISPOSITIVO, ROLES_SIN_LIMITE, RUTA_BLOQUEADO, appsEnElTelefono, decideAcceso, idDeDispositivoValido,
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
