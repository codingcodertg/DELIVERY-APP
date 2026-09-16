import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { empaquetar } from "./impersonation-cookie";

/**
 * «Cerrar sesión» cierra ESTE equipo, no la cuenta en todos (D-264).
 *
 * En `@supabase/auth-js` 2.112.4 —la instalada— `signOut()` sin argumentos es
 * `signOut({ scope: 'global' })`: revoca todas las sesiones de la cuenta. Cerrar sesión en la web
 * sacaba al dueño de la app de escritorio del Time Tracker. Y en las dos rutas de vuelta de
 * «entrar como», la sesión que se cerraba podía ser la del VENDEDOR impersonado, que salía de su
 * teléfono y de su PC.
 *
 * Dos clases de prueba:
 *   1. Se importan las rutas y se llaman, con Supabase, cookies, rastro y revocación falsos.
 *      Nada de esto llama a Auth de verdad. Lo que se mira es con qué argumentos se llamó a
 *      `signOut`, que es exactamente lo que decide el alcance.
 *   2. Se barre el código de `src/` buscando CADA llamada a `signOut`, aunque esté partida en
 *      varias líneas, para que una nueva sin alcance no entre sin que nadie la vea. El botón de
 *      «Cerrar sesión en todos los dispositivos» del Time Tracker es global a propósito, y la
 *      prueba lo exige así.
 */

const falso = vi.hoisted(() => ({
  signOut: vi.fn(async (_opciones?: unknown) => ({ error: null })),
  refreshSession: vi.fn(async (_args?: unknown) => ({ error: null as null | { message: string } })),
  getSession: vi.fn(async () => ({ data: { session: { access_token: "token-de-la-sesion-ajena" } } })),
  galletaRetorno: null as string | null,
  borradas: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signOut: falso.signOut, refreshSession: falso.refreshSession, getSession: falso.getSession },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (falso.galletaRetorno === null ? undefined : { value: falso.galletaRetorno }),
    delete: (nombre: string) => { falso.borradas.push(nombre); },
  }),
}));

// Las dos escriben en Supabase con la llave de servicio: fuera de la prueba, siempre.
vi.mock("@/lib/impersonation-log", () => ({ apuntarImpersonacion: vi.fn(async () => {}) }));
vi.mock("@/lib/impersonation-revoke", () => ({ revocarSesionImpersonada: vi.fn(async () => true) }));

import { POST as salir } from "@/app/auth/signout/route";
import { POST as volver } from "@/app/api/impersonate/return/route";
import { GET as volverSolo } from "@/app/api/impersonate/auto-return/route";

// Una cookie de retorno con la forma real, hecha con la misma función que la escribe.
const retornoValido = () =>
  empaquetar({ refresh: "refresh-del-admin", adminId: "admin-1", comoId: "vendedor-1", inicio: Date.now() - 60_000 });

const SOLO_ESTE_EQUIPO = [[{ scope: "local" }]];

beforeEach(() => {
  falso.signOut.mockClear();
  falso.refreshSession.mockClear();
  falso.refreshSession.mockImplementation(async () => ({ error: null }));
  falso.galletaRetorno = null;
  falso.borradas = [];
});

describe("«Cerrar sesión» cierra este equipo, no la cuenta en todos", () => {
  it("la ruta a la que postean los botones de «Cerrar sesión»", async () => {
    const r = await salir(new Request("http://localhost/auth/signout", { method: "POST" }));
    expect(falso.signOut.mock.calls).toEqual(SOLO_ESTE_EQUIPO);
    // Control de que la ruta corrió entera, no solo la primera línea.
    expect(r.status).toBe(303);
  });
});

describe("la vuelta de «entrar como» no saca al vendedor de sus otros equipos", () => {
  it("vuelta manual sin cookie de retorno: sale, pero solo de aquí", async () => {
    const r = await volver(new Request("http://localhost/api/impersonate/return", { method: "POST", body: "{}" }));
    expect(await r.json()).toEqual({ ok: false, salida: "login" });
    expect(falso.signOut.mock.calls).toEqual(SOLO_ESTE_EQUIPO);
  });

  it("vuelta manual con el refresh del admin caducado: la sesión que se cierra es la ajena, y solo aquí", async () => {
    falso.galletaRetorno = retornoValido();
    falso.refreshSession.mockImplementation(async () => ({ error: { message: "refresh caducado" } }));
    const r = await volver(new Request("http://localhost/api/impersonate/return", { method: "POST", body: "{}" }));
    expect(await r.json()).toEqual({ ok: false, salida: "login" });
    expect(falso.refreshSession).toHaveBeenCalledTimes(1); // control: llegó a intentar la vuelta
    expect(falso.signOut.mock.calls).toEqual(SOLO_ESTE_EQUIPO);
  });

  it("vuelta automática sin cookie de retorno", async () => {
    const r = await volverSolo(new Request("http://localhost/api/impersonate/auto-return?motivo=cutoff"));
    expect(r.headers.get("location")).toBe("http://localhost/login");
    expect(falso.signOut.mock.calls).toEqual(SOLO_ESTE_EQUIPO);
  });

  it("vuelta automática con el refresh del admin caducado", async () => {
    falso.galletaRetorno = retornoValido();
    falso.refreshSession.mockImplementation(async () => ({ error: { message: "refresh caducado" } }));
    const r = await volverSolo(new Request("http://localhost/api/impersonate/auto-return?motivo=expired"));
    expect(r.headers.get("location")).toBe("http://localhost/login");
    expect(falso.refreshSession).toHaveBeenCalledTimes(1);
    expect(falso.signOut.mock.calls).toEqual(SOLO_ESTE_EQUIPO);
  });

  it("control: si la vuelta sale bien, no se cierra ninguna sesión con signOut", async () => {
    // Sin esto, las pruebas de arriba podrían estar pasando por un camino que llama a signOut
    // siempre. Aquí el refresh vale y la sesión ajena la revoca el servidor, no este cliente.
    falso.galletaRetorno = retornoValido();
    const r = await volver(new Request("http://localhost/api/impersonate/return", { method: "POST", body: "{}" }));
    expect((await r.json()).ok).toBe(true);
    expect(falso.signOut).not.toHaveBeenCalled();
  });
});

// ---- Cada llamada a signOut en src/, con su alcance ---------------------------------------

/** Ficheros de código de `src/`, sin pruebas. */
function codigoDeSrc(dir = "src"): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return codigoDeSrc(ruta);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(nombre) && !/\.test\./.test(nombre) ? [ruta.split("\\").join("/")] : [];
  });
}

/** El código sin comentarios de línea ni de bloque: un comentario que nombra `signOut()` no es una llamada. */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, "")))
    .join("\n");
}

/**
 * Cada `signOut(` con su argumento completo, contando paréntesis: una llamada partida en varias
 * líneas sale entera, y un grep de una línea no la vería.
 */
function llamadasASignOut(src: string): { argumentos: string; delante: string }[] {
  const codigo = sinComentarios(src);
  const salida: { argumentos: string; delante: string }[] = [];
  const re = /signOut\s*\(/g;
  for (let m = re.exec(codigo); m; m = re.exec(codigo)) {
    let profundidad = 1;
    let i = m.index + m[0].length;
    const inicio = i;
    while (i < codigo.length && profundidad > 0) {
      if (codigo[i] === "(") profundidad++;
      else if (codigo[i] === ")") profundidad--;
      i++;
    }
    salida.push({
      argumentos: codigo.slice(inicio, i - 1).replace(/\s+/g, " ").trim(),
      delante: codigo.slice(Math.max(0, m.index - 20), m.index).replace(/\s+/g, " "),
    });
  }
  return salida;
}

describe("cada signOut de src/ dice su alcance", () => {
  const encontradas = codigoDeSrc().flatMap((f) =>
    llamadasASignOut(readFileSync(f, "utf8")).map((l) => ({ fichero: f, ...l })),
  );

  it("el detector ve una llamada partida en varias líneas, y no ve un comentario (control)", () => {
    const partida = "await supabase.auth\n  .signOut(\n    { scope: \"local\" },\n  );\n// signOut() en un comentario";
    expect(llamadasASignOut(partida).map((l) => l.argumentos)).toEqual(["{ scope: \"local\" },"]);
  });

  it("las que se conocen están todas, y no hay ninguna más", () => {
    const porFichero = encontradas.map((l) => l.fichero).sort();
    expect(porFichero).toEqual([
      "src/app/api/impersonate/auto-return/route.ts",
      "src/app/api/impersonate/auto-return/route.ts",
      "src/app/api/impersonate/return/route.ts",
      "src/app/api/impersonate/return/route.ts",
      // «Mi perfil» (D-265): cierra la sesión de COMPROBACIÓN de la contraseña actual, local.
      "src/app/api/profile/password/route.ts",
      "src/app/auth/signout/route.ts",
      "src/app/no-access/SignOut.tsx",
      "src/lib/impersonation-revoke.ts",
      "src/lib/timetracker-data-provider.tsx",
    ]);
  });

  it("todas son de este equipo, menos el botón de «todos los dispositivos»", () => {
    for (const l of encontradas) {
      const donde = `${l.fichero}: signOut(${l.argumentos})`;
      if (l.fichero === "src/lib/timetracker-data-provider.tsx") {
        // «Cerrar sesión en todos los dispositivos»: global a propósito.
        expect(l.argumentos, donde).toBe("{ scope: \"global\" }");
      } else if (l.delante.includes("admin.")) {
        // La API de admin recibe el alcance como segundo argumento (D-245).
        expect(l.argumentos, donde).toMatch(/,\s*"local"$/);
      } else {
        // Con o sin coma final y en una o varias líneas: lo que se exige es el alcance, no el formato.
        expect(l.argumentos, donde).toMatch(/^\{\s*scope:\s*["']local["']\s*,?\s*\}$/);
      }
    }
  });
});
