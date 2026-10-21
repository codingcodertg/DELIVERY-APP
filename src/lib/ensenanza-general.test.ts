import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  COOKIE_ENSENANZA, RPC_QUE_ESCRIBEN, RPC_QUE_SOLO_LEEN, avisoGeneralEnLaRuta, cookieDeEnsenanza, ensenanzaDeLasCookies,
  escrituraBloqueadaEnEnsenanza, fetchDeEnsenanza,
} from "./ensenanza-general";
import { escribeEnsenanza, igualaCookieDeEnsenanza } from "./boton-general";
import { COOKIE_CAPACITACION } from "./timetracker/capacitacion";

// D-626 (2026-10-21) · el dueño: «el hub y erp no se le prende el modo enseñanza arregla eso que todas esas opciones
// sean a nivel general del app».

const galleta = vi.hoisted(() => ({ valor: undefined as string | undefined, falla: false }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (galleta.falla) throw new Error("fuera de una petición");
    return { get: (n: string) => (n === "rtg_ensenanza" && galleta.valor !== undefined ? { name: n, value: galleta.valor } : undefined) };
  },
}));

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const SB = "https://abc.supabase.co";

/** Un `document` de mentira: guarda lo asignado y contesta `cookie` como el navegador (Max-Age=0 la borra). */
function documento() {
  const tarro = new Map<string, string>();
  const asignadas: string[] = [];
  return {
    asignadas,
    get cookie() { return [...tarro].map(([k, v]) => `${k}=${v}`).join("; "); },
    set cookie(linea: string) {
      asignadas.push(linea);
      const [par] = linea.split(";");
      const i = par.indexOf("=");
      const k = par.slice(0, i).trim();
      if (/Max-Age=0/.test(linea)) tarro.delete(k); else tarro.set(k, par.slice(i + 1));
    },
  };
}
const almacen = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};

describe("qué se corta en enseñanza", () => {
  it("leer pasa; escribir en los datos de cualquier app, no", () => {
    expect(escrituraBloqueadaEnEnsenanza("GET", `${SB}/rest/v1/products?select=*`)).toBe(false);
    expect(escrituraBloqueadaEnEnsenanza("HEAD", `${SB}/rest/v1/candidates`)).toBe(false);
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/rest/v1/products`)).toBe(true);
    expect(escrituraBloqueadaEnEnsenanza("PATCH", `${SB}/rest/v1/candidates?id=eq.1`)).toBe(true);
    expect(escrituraBloqueadaEnEnsenanza("DELETE", `${SB}/rest/v1/profiles?id=eq.1`)).toBe(true);
    expect(escrituraBloqueadaEnEnsenanza(undefined, `${SB}/rest/v1/products`)).toBe(false);
  });

  it("las funciones: las que solo leen pasan, las que escriben y las desconocidas no", () => {
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/rest/v1/rpc/catalog_facets`)).toBe(false);
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/rest/v1/rpc/tutorials?x=1`)).toBe(false);
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/rest/v1/rpc/adjust_inventory`)).toBe(true);
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/rest/v1/rpc/una_nueva`)).toBe(true);
  });

  it("el chat, la ayuda, la campana, el teléfono y el registro de seguridad siguen; sus adjuntos también", () => {
    for (const t of ["chat_messages", "help_messages", "help_reads", "help_requests", "device_tokens", "notifications", "security_events"]) {
      expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/rest/v1/${t}`), t).toBe(false);
    }
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/storage/v1/object/help-files/u/1.png`)).toBe(false);
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/storage/v1/object/resumes/cv.pdf`)).toBe(true);
    expect(escrituraBloqueadaEnEnsenanza("DELETE", `${SB}/storage/v1/object/po-docs/a.pdf`)).toBe(true);
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/storage/v1/object/sign/resumes/cv.pdf`)).toBe(false);
  });

  it("la sesión pasa; crear, cambiar o borrar cuentas desde Usuarios, no", () => {
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/auth/v1/token?grant_type=refresh_token`)).toBe(false);
    expect(escrituraBloqueadaEnEnsenanza("POST", `${SB}/auth/v1/admin/users`)).toBe(true);
    expect(escrituraBloqueadaEnEnsenanza("PUT", `${SB}/auth/v1/admin/users/1`)).toBe(true);
    expect(escrituraBloqueadaEnEnsenanza("DELETE", `${SB}/auth/v1/admin/users/1`)).toBe(true);
    expect(escrituraBloqueadaEnEnsenanza("GET", `${SB}/auth/v1/admin/users`)).toBe(false);
  });
});

describe("el fetch de los clientes", () => {
  const real = () => vi.fn(async () => new Response("[]", { status: 200 }));

  it("apagado deja pasar todo; encendido devuelve 403 sin llamar y en el idioma de la persona", async () => {
    const f = real();
    expect((await fetchDeEnsenanza(f, () => null)(`${SB}/rest/v1/products`, { method: "POST" })).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    const g = real();
    const r = await fetchDeEnsenanza(g, () => "es")(`${SB}/rest/v1/products`, { method: "POST" });
    expect(r.status).toBe(403);
    expect(g).not.toHaveBeenCalled();
    const cuerpo = await r.json();
    expect(cuerpo.code).toBe("ENSENANZA");
    expect(cuerpo.message).toContain("Modo enseñanza: esto no se puede practicar");
    const h = real();
    expect((await fetchDeEnsenanza(h, async () => "en" as const)(`${SB}/rest/v1/products`, { method: "GET" })).status).toBe(200);
    expect(h).toHaveBeenCalledTimes(1);
    // Encendido, lo que la lista general deja pasar sale: una función que solo lee y el chat (Time Tracker las cortaría).
    const k = real();
    expect((await fetchDeEnsenanza(k, () => "es")(`${SB}/rest/v1/rpc/catalog_facets`, { method: "POST" })).status).toBe(200);
    expect((await fetchDeEnsenanza(k, () => "es")(`${SB}/rest/v1/chat_messages`, { method: "POST" })).status).toBe(200);
    expect(k).toHaveBeenCalledTimes(2);
  });

  it("el del servidor lee la cookie de la petición; sin petición (un cron) no corta", async () => {
    const { fetchDeEnsenanzaDeLaPeticion } = await import("./ensenanza-servidor");
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("[]", { status: 200 }));
    try {
      galleta.valor = "en"; galleta.falla = false;
      const r = await fetchDeEnsenanzaDeLaPeticion()(`${SB}/rest/v1/products`, { method: "PATCH" });
      expect(r.status).toBe(403);
      expect((await r.json()).message).toContain("Teaching mode: this can't be practiced");
      expect(espia).not.toHaveBeenCalled();
      galleta.falla = true;
      expect((await fetchDeEnsenanzaDeLaPeticion()(`${SB}/rest/v1/products`, { method: "PATCH" })).status).toBe(200);
      galleta.falla = false; galleta.valor = undefined;
      expect((await fetchDeEnsenanzaDeLaPeticion()(`${SB}/rest/v1/products`, { method: "PATCH" })).status).toBe(200);
      expect(espia).toHaveBeenCalledTimes(2);
    } finally {
      espia.mockRestore();
    }
  });
});

describe("un solo interruptor", () => {
  it("la cookie: en todo el sitio, con el idioma; apagar la borra", () => {
    expect(COOKIE_ENSENANZA).toBe("rtg_ensenanza");
    expect(cookieDeEnsenanza("es")).toBe("rtg_ensenanza=es; Path=/; SameSite=Lax");
    expect(cookieDeEnsenanza(null)).toContain("Max-Age=0");
    expect(ensenanzaDeLasCookies("a=1; rtg_ensenanza=es; b=2")).toBe("es");
    expect(ensenanzaDeLasCookies("a=1")).toBe(null);
    expect(ensenanzaDeLasCookies("rtg_ensenanza=")).toBe(null);
  });

  it("encender escribe la bandera de Entregas, la cookie general y la de Time Tracker; apagar, las tres fuera", () => {
    const a = almacen();
    const d = documento();
    escribeEnsenanza(a, true, { doc: d, idioma: "es" });
    expect(a.m.get("rtg_teaching")).toBe("1");
    expect(ensenanzaDeLasCookies(d.cookie)).toBe("es");
    expect(d.cookie).toContain(`${COOKIE_CAPACITACION}=es`);
    escribeEnsenanza(a, false, { doc: d, idioma: "es" });
    expect(a.m.has("rtg_teaching")).toBe(false);
    expect(d.cookie).toBe("");
    // Sin `doc` (como antes) solo la bandera: nada de cookies.
    const d2 = documento();
    escribeEnsenanza(a, true);
    expect(d2.asignadas).toEqual([]);
  });

  it("la cookie general sigue a la bandera; Time Tracker no se toca", () => {
    const a = almacen();
    const d = documento();
    a.setItem("rtg_teaching", "1");
    expect(igualaCookieDeEnsenanza(a, d, "en")).toBe(true);
    expect(ensenanzaDeLasCookies(d.cookie)).toBe("en");
    expect(igualaCookieDeEnsenanza(a, d, "en")).toBe(false);
    a.removeItem("rtg_teaching");
    d.cookie = `${COOKIE_CAPACITACION}=es; Path=/timetracker`;
    expect(igualaCookieDeEnsenanza(a, d, "en")).toBe(true);
    expect(ensenanzaDeLasCookies(d.cookie)).toBe(null);
    expect(d.cookie).toContain(`${COOKIE_CAPACITACION}=es`);
    expect(igualaCookieDeEnsenanza(a, null, "en")).toBe(false);
  });

  it("el aviso general sale donde no hay otro: el hub sí, Entregas y Time Tracker no", () => {
    for (const p of ["/home", "/home/users", "/erp", "/erp/catalog", "/recruiting", "/customers", "/leads", "/surveys", "/promos", "/estimator"]) {
      expect(avisoGeneralEnLaRuta(p), p).toBe(true);
    }
    for (const p of ["/", "/driver", "/routes", "/timetracker", "/timetracker/clock-in", "/login", null]) {
      expect(avisoGeneralEnLaRuta(p), String(p)).toBe(false);
    }
  });
});

describe("puertas", () => {
  it("cada .rpc(\"…\") de src/ está clasificada en una sola de las dos listas", () => {
    const archivos: string[] = [];
    const anda = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) anda(p);
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)) archivos.push(p);
      }
    };
    anda("src");
    const llamadas = new Set<string>();
    for (const a of archivos) for (const m of readFileSync(a, "utf8").matchAll(/\.rpc\(\s*"([a-z_0-9]+)"/g)) llamadas.add(m[1]);
    expect(llamadas.size).toBeGreaterThan(50);
    const lee = new Set<string>(RPC_QUE_SOLO_LEEN);
    const escribe = new Set<string>(RPC_QUE_ESCRIBEN);
    for (const n of lee) expect(escribe.has(n), n).toBe(false);
    for (const n of llamadas) expect(lee.has(n) || escribe.has(n), `${n} sin clasificar`).toBe(true);
  });

  it("los clientes de Supabase llevan el corte: navegador, sesión del servidor y servicio", () => {
    // Los del navegador llevan la práctica desde D-628 (`practica/fetch-de-practica.test.ts`).
    for (const p of ["src/lib/supabase/client.ts", "src/lib/erp/supabase/client.ts", "src/lib/recruiting/supabase/client.ts"]) {
      expect(leer(p), p).toContain("global: { fetch: fetchDePracticaDelNavegador() },");
    }
    for (const p of ["src/lib/supabase/server.ts", "src/lib/erp/supabase/server.ts", "src/lib/recruiting/supabase/server.ts"]) {
      const s = leer(p);
      expect(s, p).toContain("const ensenanza = valorDeEnsenanza(cookieStore.get(COOKIE_ENSENANZA)?.value);");
      expect(s, p).toContain("...(ensenanza ? { global: { fetch: fetchDeEnsenanzaConValor(ensenanza) } } : {}),");
    }
    for (const p of ["src/lib/supabase/admin.ts", "src/lib/erp/supabase/admin.ts"]) {
      expect(leer(p), p).toContain("global: { fetch: fetchDeEnsenanzaDeLaPeticion() },");
    }
  });

  it("el aviso está en el layout raíz, y la burbuja y Entregas escriben las cookies", () => {
    expect(leer("src/app/layout.tsx")).toContain("<AvisoDeEnsenanza />\n          {children}");
    expect(leer("src/components/AvisoDeEnsenanza.tsx")).toContain("const conAviso = encendido && avisoGeneralEnLaRuta(pathname);");
    expect(leer("src/components/BotonGeneral.tsx")).toContain("escribeEnsenanza(localStorage, nuevo, { doc: document, idioma: lang });");
    expect(leer("src/lib/data-provider.tsx")).toContain("escribeEnsenanza(localStorage, v, { doc: document, idioma: lang });");
  });
});
