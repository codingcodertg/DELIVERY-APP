import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSession } from "./session-guard";

// El fallo del dueño: «Tu sesión caducó» le salta muy seguido MIENTRAS FICHA, con el
// temporizador corriendo y capturas sin sincronizar. La sesión no había caducado.
//
// Esta app monta CINCO clientes de navegador (Entregas + los cuatro con esquema propio que
// obliga D-185), todos con la misma llave de almacenamiento y cada uno con su refresco
// automático. Supabase ROTA el token de refresco: si dos refrescan a la vez, el segundo recibe
// `400 Invalid Refresh Token: Already Used` — sobre una sesión que acaba de renovarse.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const ahora = () => Math.floor(Date.now() / 1000);

/** Un doble de supabase: qué hay guardado antes y después de intentar refrescar. */
function sonda(opts: {
  antes: { expires_at: number } | null;
  refresco?: { session?: unknown; status?: number };
  despues?: { expires_at: number } | null;
}) {
  let lecturas = 0;
  const probe = {
    auth: {
      async getSession() {
        lecturas += 1;
        // La primera lectura ve lo que había; la segunda —la relectura tras el 4xx— ve lo que
        // haya dejado el cliente que ganó la carrera.
        const s = lecturas === 1 ? opts.antes : (opts.despues !== undefined ? opts.despues : opts.antes);
        return { data: { session: s } };
      },
      async refreshSession() {
        if (opts.refresco?.session) return { data: { session: opts.refresco.session }, error: null };
        return { data: { session: null }, error: { status: opts.refresco?.status } };
      },
    },
  };
  return { probe, lecturas: () => lecturas };
}

const VIVA = () => ({ expires_at: ahora() + 3600 });
const MUERTA = () => ({ expires_at: ahora() - 10 });

describe("EL FALLO: «Already Used» no es una sesión muerta", () => {
  it("400 tras el refresco, pero otro cliente ya la renovó → `ok`", () => {
    // El caso exacto del dueño: pierde la carrera del refresco y la sesión está viva.
    return expect(checkSession(sonda({
      antes: MUERTA(),
      refresco: { status: 400 },
      despues: VIVA(),
    }).probe)).resolves.toBe("ok");
  });
  it("y para saberlo hace falta VOLVER A LEER: dos lecturas, no una", async () => {
    const s = sonda({ antes: MUERTA(), refresco: { status: 400 }, despues: VIVA() });
    await checkSession(s.probe);
    expect(s.lecturas()).toBe(2);
  });
  it("401 y 403 igual: el veredicto del servidor no es el estado de la sesión", async () => {
    for (const status of [400, 401, 403, 422]) {
      const s = sonda({ antes: MUERTA(), refresco: { status }, despues: VIVA() });
      expect(await checkSession(s.probe), String(status)).toBe("ok");
    }
  });
});

describe("pero una sesión muerta sigue estando muerta", () => {
  it("4xx y en el almacenamiento sigue el mismo token caducado → `gone`", async () => {
    // Sin esto, el arreglo se comería el caso real que D-088/D-099 vinieron a resolver: la
    // sesión que caduca de verdad al dormir el ordenador.
    expect(await checkSession(sonda({ antes: MUERTA(), refresco: { status: 400 }, despues: MUERTA() }).probe)).toBe("gone");
  });
  it("4xx y ya no hay nada guardado → `gone`", async () => {
    expect(await checkSession(sonda({ antes: MUERTA(), refresco: { status: 400 }, despues: null }).probe)).toBe("gone");
  });
  it("la relectura exige el MISMO margen de vida: 30 s no bastan", async () => {
    // Un token que caduca en medio minuto caduca a media petición. Es el mismo listón que
    // aplica la primera lectura, y por eso no se puede aflojar solo aquí.
    const casi = { expires_at: ahora() + 30 };
    expect(await checkSession(sonda({ antes: MUERTA(), refresco: { status: 400 }, despues: casi }).probe)).toBe("gone");
    const sobrado = { expires_at: ahora() + 61 };
    expect(await checkSession(sonda({ antes: MUERTA(), refresco: { status: 400 }, despues: sobrado }).probe)).toBe("ok");
  });
  it("sin sesión guardada de entrada no hay nada que refrescar → `gone`", async () => {
    expect(await checkSession(sonda({ antes: null, refresco: { status: 400 } }).probe)).toBe("gone");
  });
});

describe("lo que ya estaba bien y no se toca", () => {
  it("un fallo de red (sin status) sigue siendo `offline`", async () => {
    // Cerrarle la app a alguien porque se le cayó el wifi un segundo sería peor que la
    // pantalla vacía. Y con `offline` los reintentos siguen teniendo sentido.
    expect(await checkSession(sonda({ antes: MUERTA(), refresco: {} }).probe)).toBe("offline");
  });
  it("un 5xx es del servidor, no un veredicto sobre la sesión → `offline`", async () => {
    for (const status of [500, 502, 503]) {
      expect(await checkSession(sonda({ antes: MUERTA(), refresco: { status } }).probe), String(status)).toBe("offline");
    }
  });
  it("una excepción es la red o una navegación cancelada → `offline`", async () => {
    const roto = { auth: {
      getSession: async () => { throw new Error("network"); },
      refreshSession: async () => ({ data: { session: null }, error: null }),
    } };
    expect(await checkSession(roto)).toBe("offline");
  });
  it("con sesión sobrada no se refresca siquiera: una sola lectura", async () => {
    const s = sonda({ antes: VIVA() });
    expect(await checkSession(s.probe)).toBe("ok");
    expect(s.lecturas()).toBe(1);
  });
  it("un refresco que SÍ funciona sigue dando `ok` sin releer", async () => {
    const s = sonda({ antes: MUERTA(), refresco: { session: { expires_at: ahora() + 3600 } } });
    expect(await checkSession(s.probe)).toBe("ok");
    expect(s.lecturas()).toBe(1);
  });
});

describe("por qué el arreglo funciona: los cinco clientes comparten el almacén", () => {
  const clientes = [
    "src/lib/supabase/client.ts",
    "src/lib/clockin/supabase/client.ts",
    "src/lib/erp/supabase/client.ts",
    "src/lib/recruiting/supabase/client.ts",
    "src/lib/timetracker/supabase/client.ts",
  ];
  it("ninguno declara `storageKey` propio: misma entrada de `localStorage`", () => {
    // ES LA DEPENDENCIA QUE HACE FUNCIONAR EL ARREGLO. El cliente que pierde la carrera recibe
    // el 400, pero el token nuevo YA está en el almacén, escrito por el que ganó — por eso la
    // relectura lo encuentra vivo. Si alguien «aislara» el almacenamiento por cliente creyendo
    // que mejora algo, la relectura dejaría de ver nada y volvería el fallo.
    for (const c of clientes) expect(leer(c), c).not.toContain("storageKey");
  });
  it("ninguno apaga su refresco automático: por eso hay carrera", () => {
    for (const c of clientes) expect(leer(c), c).not.toContain("autoRefreshToken: false");
  });
  it("y los cuatro con esquema propio siguen con `isSingleton: false` (D-185)", () => {
    // Tocarlo sería volver a que HR y TT se robaran el cliente. La carrera es el precio de
    // aquello, y se paga absorbiéndola, no deshaciéndola.
    for (const c of clientes.slice(1)) expect(leer(c), c).toContain("isSingleton: false");
  });
});

describe("se puede volver de «gone», y en los TRES proveedores", () => {
  const proveedores = [
    "src/lib/data-provider.tsx",
    "src/lib/recruiting-data-provider.tsx",
    "src/lib/timetracker-data-provider.tsx",
  ];
  it("una comprobación con sesión viva retira el aviso", () => {
    // Antes `authGoneRef` era un camino de ida: se ponía a `true` y no lo bajaba nadie, así que
    // un aviso levantado por la carrera se quedaba puesto hasta recargar la página.
    for (const p of proveedores) {
      const src = leer(p);
      expect(src, p).toContain('else if (estado === "ok" && authGoneRef.current) { authGoneRef.current = false; setAuthGone(false); }');
    }
  });
  it("volver a la ventana vuelve a preguntar, incluso dada por muerta", () => {
    // Es el momento exacto del fallo: la máquina despierta y los cinco temporizadores disparan
    // a la vez.
    for (const p of proveedores) {
      const src = leer(p);
      expect(src, p).toContain("if (authGoneRef.current) {");
      expect(src, p).toContain("void ensureSessionRef.current().then((ok) => { if (ok) void reloadRef.current(); });");
    }
  });
  it("y con la pestaña ocultándose tampoco pregunta", () => {
    // `visibilitychange` dispara también al IRSE. Con la sesión dada por muerta, el coste del
    // arreglo es una petición fallida por evento; ahorrar la de «me estoy ocultando» es media
    // línea y no la aprovecha nadie.
    for (const p of proveedores) {
      expect(leer(p), p).toContain('if (typeof document !== "undefined" && document.visibilityState === "hidden") return;');
    }
  });
  it("pero el latido de 15 s NO sondea una sesión muerta", () => {
    // Sería una llamada de refresco cada quince segundos contra un token que no va a revivir.
    // El reintento periódico sigue saliéndose temprano cuando la sesión está dada por muerta.
    for (const p of proveedores) {
      const src = leer(p);
      const retry = src.slice(src.indexOf("const retry = () => {"), src.indexOf("const fresh = () => {"));
      expect(retry, p).toContain("if (authGoneRef.current) return;");
    }
  });
  it("el ERP no entra: no usa `checkSession`", () => {
    // Va por componentes de servidor con `getSessionInfo`. Son tres proveedores, no cuatro.
    const usos = ["src/lib/data-provider.tsx", "src/lib/recruiting-data-provider.tsx", "src/lib/timetracker-data-provider.tsx"];
    for (const p of usos) expect(leer(p), p).toContain("await checkSession(supabase)");
    expect(leer("src/lib/erp/auth.ts")).not.toContain("checkSession");
  });
});
