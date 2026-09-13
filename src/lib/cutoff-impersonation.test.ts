import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { updateSession, type PuertaDeSesion } from "@/lib/supabase/middleware";
import { COOKIE_RETORNO, empaquetar } from "@/lib/impersonation-cookie";
import { IMPERSONACION_MINUTOS } from "@/lib/impersonation";

// Donde se cruzan las dos ramas: el corte de las 18:30 (D-248) pillando a un admin dentro de la
// sesión de otra persona (D-243). Mandarlo al login COMO EL VENDEDOR sería dejarlo fuera de su
// propia cuenta por una regla que ni siquiera es suya — y es justo lo que «entrar como» promete
// que no pasa.
const AUTO = "https://hub.test/api/impersonate/auto-return";

const pedir = (cookie?: string) => {
  const req = new NextRequest(new URL("https://hub.test/home"));
  req.cookies.set("sb-access-token", "x");
  if (cookie) req.cookies.set(COOKIE_RETORNO, cookie);
  return req;
};
const vuelta = (inicio: number) => empaquetar({ refresh: "rt", adminId: "a1", comoId: "v1", inicio });

const manana = new Date("2026-09-11T14:00:00Z"); // 09:00 en Chicago: el último corte es el de ayer
const puerta = (p: Partial<PuertaDeSesion>): PuertaDeSesion => ({
  session_created_at: "2026-09-10T15:00:00Z", deliveries_role: "sales", clockin_role: null, ...p,
});

describe("el corte de las 18:30 sobre una sesión impersonada", () => {
  it("devuelve al admin a su cuenta en vez de mandarlo al login como el vendedor", async () => {
    const r = await updateSession(pedir(vuelta(Date.now())), {
      getUser: async () => true, ahora: manana, gate: async () => puerta({}),
    });
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe(`${AUTO}?motivo=cutoff`);
  });

  it("y NO le borra la cookie de retorno por el camino", async () => {
    // El fallo que esto fija: si el corte barre las `sb-` y de paso la de retorno, el
    // restaurador llega sin nada de donde restaurar y acaba mandando al admin al login igual.
    // La cookie se borra al FINAL del retorno, no al principio del corte.
    const r = await updateSession(pedir(vuelta(Date.now())), {
      getUser: async () => true, ahora: manana, gate: async () => puerta({}),
    });
    const puestas = r.cookies.getAll().map((c) => c.name);
    expect(puestas).not.toContain(COOKIE_RETORNO);
    expect(puestas).not.toContain("sb-access-token");
  });

  it("sin impersonación, el corte sigue haciendo lo de siempre", async () => {
    // El control: si el desvío se aplicara siempre, esta caería.
    const r = await updateSession(pedir(), {
      getUser: async () => true, ahora: manana, gate: async () => puerta({}),
    });
    expect(r.headers.get("location")).toBe("https://hub.test/login?next=%2Fhome");
    expect(r.cookies.getAll().map((c) => c.name)).toContain("sb-access-token");
  });

  it("y a un admin impersonando NO le aplica el corte del vendedor si el rol dice que no", async () => {
    // La puerta lee el rol de la sesión ACTUAL, que es la del impersonado. Si esa persona
    // estuviera exenta, no hay corte y no hay nada que devolver.
    const r = await updateSession(pedir(vuelta(Date.now())), {
      getUser: async () => true, ahora: manana, gate: async () => puerta({ deliveries_role: "admin" }),
    });
    expect(r.status).not.toBe(307);
  });
});

describe("el orden de las dos comprobaciones", () => {
  it("la caducidad de los 60 min manda sobre el corte de las 18:30", async () => {
    // Las dos aplican a la vez: sesión impersonada vieja Y hora de cierre pasada. La de los 60
    // minutos va primero porque es la que sabe que hay una impersonación; con el orden al revés
    // se resolvería como un corte cualquiera y el motivo del rastro sería el equivocado.
    const vieja = Date.now() - (IMPERSONACION_MINUTOS + 1) * 60_000;
    const r = await updateSession(pedir(vuelta(vieja)), {
      getUser: async () => true, ahora: manana, gate: async () => puerta({}),
    });
    expect(r.headers.get("location")).toBe(`${AUTO}?motivo=expired`);
  });

  it("y ninguna de las dos deja pasar el barrido de huérfana por delante", async () => {
    // En el instante del corte SÍ hay usuario, así que `sinUsuarioConfirmado` es falso y el
    // barrido no toca la cookie. Si lo hiciera, la borraría justo antes de restaurar.
    const r = await updateSession(pedir(vuelta(Date.now())), {
      getUser: async () => true, ahora: manana, gate: async () => puerta({}),
    });
    expect(r.cookies.getAll().map((c) => c.name)).not.toContain(COOKIE_RETORNO);
  });
});

// ---- Donde `hasUser` y «ausencia confirmada» SÍ se separan --------------------------------
// Al entregar el rebase dije que el barrido habría funcionado igual con `hasUser` a secas, «por
// casualidad». La auditoría midió la secuencia entera y no es verdad: las dos formas se separan
// un paso antes, y hacen falta DOS navegaciones para verlo — que es justo lo que ninguna prueba
// de una sola petición enseña.
describe("un parpadeo de red antes del corte no le quita la vuelta al admin", () => {
  it("la cookie sobrevive al fallo, y la navegación siguiente acaba en el restaurador", async () => {
    const cookie = vuelta(Date.now());

    // 1) Después de las 18:30, con impersonación viva, y `getUser` que NO puede contestar.
    //    Con `!hasUser` a secas esto barrería la cookie; con ausencia confirmada, no.
    const r1 = await updateSession(pedir(cookie), {
      getUser: async () => null, ahora: manana, gate: async () => puerta({}),
    });
    expect(r1.cookies.getAll().map((c) => c.name)).not.toContain(COOKIE_RETORNO);

    // 2) Vuelve la red. Como la cookie sigue ahí, el corte la encuentra y devuelve al admin.
    //    Sin ella habría acabado en el login COMO EL VENDEDOR, y con las `sb-` borradas.
    const r2 = await updateSession(pedir(cookie), {
      getUser: async () => true, ahora: manana, gate: async () => puerta({}),
    });
    expect(r2.headers.get("location")).toBe(`${AUTO}?motivo=cutoff`);
  });

  it("y con una ausencia CONFIRMADA sí se barre, que es el control", async () => {
    const r = await updateSession(pedir(vuelta(Date.now())), {
      getUser: async () => false, ahora: manana, gate: async () => puerta({}),
    });
    expect(r.cookies.getAll().map((c) => c.name)).toContain(COOKIE_RETORNO);
  });
});

// ---- La vuelta automática cierra la sesión ajena igual que la manual (D-245, al rebasar) -----
// Esta ruta no existía cuando se escribió el endurecimiento: es de esta rama. Sin esto, volver
// por el corte de las 18:30 o por los 60 minutos dejaba viva la sesión del vendedor, y volver
// pulsando el botón no. La misma acción con dos finales distintos según por dónde se llegara.
describe("auto-return revoca la sesión ajena, en el orden y esperándola", () => {
  const src = readFileSync("src/app/api/impersonate/auto-return/route.ts", "utf8");
  const codigo = src.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

  it("toma el token de la sesión impersonada ANTES de restaurar al admin", () => {
    const iToken = codigo.indexOf("getSession()");
    const iRestaurar = codigo.indexOf("refreshSession(");
    expect(iToken).toBeGreaterThan(-1);
    expect(iRestaurar).toBeGreaterThan(-1);
    expect(iToken).toBeLessThan(iRestaurar);
  });

  it("y la espera, porque esto acaba en un redirect y la función se puede congelar", () => {
    expect(codigo).toMatch(/await revocarSesionImpersonada\(/);
    expect(codigo).not.toMatch(/void revocarSesionImpersonada\(/);
    expect(codigo).toMatch(/await apuntarImpersonacion\(/);
    expect(codigo).not.toMatch(/void apuntarImpersonacion\(/);
  });

  it("las dos vueltas hacen lo mismo: ninguna se queda sin revocar", () => {
    // El control de que no vuelva a haber una sola de las dos arreglada.
    const manual = readFileSync("src/app/api/impersonate/return/route.ts", "utf8");
    for (const [nombre, s] of [["manual", manual], ["automática", src]] as const) {
      expect(s, nombre).toContain("revocarSesionImpersonada");
    }
  });
});
