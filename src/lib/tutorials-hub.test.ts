import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HUB_TOOLS } from "./constants";
import {
  agrupaTutoriales, appDeTutorial, guardaTutoriales, nuevoTutorial, puedeGestionarTutoriales,
  type ClienteDeAjustes,
} from "./tutorials-hub";
import type { Tutorial } from "./types";

/**
 * Los tutoriales en el hub (D-268).
 *
 * Tres clases de prueba:
 *   1. Lo que se decide con datos: agrupación, General, buscador, quién gestiona y el tutorial nuevo.
 *      Los datos tienen la forma con la que se guardan hoy en `settings.tutorials`: objetos de la 037
 *      sin `app`, con `added_by` y `added_at`.
 *   2. Guardar, con un cliente falso: se relee lo que hay, se exige una fila, y no se pierden campos.
 *   3. Los caminos y la 113, leyendo el código que ejecuta.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*(\/\/|--)/.test(l) ? "" : l.replace(/\s(\/\/|--\s).*$/, ""))).join("\n");

// Como los guarda la sección vieja (037 + TutorialsSection): sin `app`.
const guardado = (id: string, title: string, extra: Partial<Tutorial> = {}): Tutorial => ({
  id, title, description: null, url: `https://youtu.be/${id}`, added_by: "admin-1", added_at: "2026-09-01T10:00:00.000Z", ...extra,
});

describe("agrupar por app", () => {
  // El orden de la lista va A PROPÓSITO al revés del orden de los grupos: el ERP primero y Entregas
  // al final. Con datos ya ordenados, agrupar en el orden de llegada pasaría igual.
  const lista = [
    guardado("e1", "Buscar un producto", { app: "erp" }),
    guardado("g1", "Entrar al hub"),
    guardado("t1", "Registrar horas", { app: "timetracker" }),
    guardado("d2", "Crear una orden", { app: "deliveries" }),
    guardado("d1", "Asignar chofer", { app: "deliveries" }),
    guardado("c1", "Fichar con foto", { app: "clockin" }),
    guardado("r1", "Mover un candidato", { app: "recruiting" }),
  ];

  it("los grupos van en el orden de las apps, con General al final", () => {
    expect(agrupaTutoriales(lista).map((g) => g.app)).toEqual(["deliveries", "recruiting", "timetracker", "clockin", "erp", "general"]);
  });

  it("dentro de un grupo, el orden en que los puso el admin, no el alfabético", () => {
    // «Crear» se añadió antes que «Asignar»: alfabéticamente iría detrás.
    expect(agrupaTutoriales(lista)[0].tutoriales.map((t) => t.id)).toEqual(["d2", "d1"]);
  });

  it("lo que ya está guardado sin app va a General, y no se pierde nadie", () => {
    const grupos = agrupaTutoriales(lista);
    expect(grupos.find((g) => g.app === "general")?.tutoriales.map((t) => t.id)).toEqual(["g1"]);
    expect(grupos.reduce((n, g) => n + g.tutoriales.length, 0)).toBe(lista.length);
  });

  it("una app que no existe, o vacía, también va a General", () => {
    expect(appDeTutorial({ app: "ventas" as Tutorial["app"] })).toBe("general");
    expect(appDeTutorial({ app: null })).toBe("general");
    expect(appDeTutorial({})).toBe("general");
  });

  it("no enseña grupos vacíos", () => {
    expect(agrupaTutoriales([guardado("g1", "Entrar al hub")]).map((g) => g.app)).toEqual(["general"]);
    expect(agrupaTutoriales([])).toEqual([]);
  });

  it("el buscador mira el título, sin acentos ni mayúsculas, y sigue agrupando", () => {
    const conAcento = [...lista, guardado("d3", "Cómo cancelar", { app: "deliveries" })];
    expect(agrupaTutoriales(conAcento, "COMO").flatMap((g) => g.tutoriales.map((t) => t.id))).toEqual(["d3"]);
    expect(agrupaTutoriales(conAcento, "  ").reduce((n, g) => n + g.tutoriales.length, 0)).toBe(conAcento.length);
  });
});

describe("quién gestiona y el tutorial nuevo", () => {
  it("solo el admin gestiona", () => {
    expect(puedeGestionarTutoriales("admin")).toBe(true);
    for (const rol of ["manager", "sales", "warehouse", "driver", "logistics", "accounting", "", null, undefined]) {
      expect(puedeGestionarTutoriales(rol), String(rol)).toBe(false);
    }
  });

  it("sin título o sin enlace no hay tutorial", () => {
    const cuando = new Date("2026-09-17T12:00:00.000Z");
    expect(nuevoTutorial({ title: "  ", url: "https://youtu.be/x", app: "erp" }, { id: "a" }, cuando, "n1")).toBeNull();
    expect(nuevoTutorial({ title: "Algo", url: " ", app: "erp" }, { id: "a" }, cuando, "n1")).toBeNull();
  });

  it("se guarda limpio, con autor y fecha, y General sin app", () => {
    const cuando = new Date("2026-09-17T12:00:00.000Z");
    expect(nuevoTutorial({ title: " Fichar ", url: " https://youtu.be/x ", description: "  ", app: "clockin" }, { id: "admin-1" }, cuando, "n1"))
      // roles: [] desde D-269: sin audiencia, el video es para todos.
      .toEqual({ id: "n1", title: "Fichar", description: null, url: "https://youtu.be/x", app: "clockin", roles: [], added_by: "admin-1", added_at: "2026-09-17T12:00:00.000Z" });
    expect(nuevoTutorial({ title: "Hub", url: "https://youtu.be/y", app: "general" }, { id: "admin-1" }, cuando, "n2")?.app).toBeNull();
  });
});

describe("guardar contra lo que hay en la base", () => {
  function cliente(base: { tutorials: unknown; errorLectura?: unknown; filas?: unknown[] | null; errorEscritura?: unknown }) {
    const escrito: Tutorial[][] = [];
    const c: ClienteDeAjustes = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: base.errorLectura ? null : { tutorials: base.tutorials }, error: base.errorLectura ?? null }) }) }),
        update: (v) => ({ eq: () => ({ select: async () => { escrito.push(v.tutorials); return { data: base.filas === undefined ? [{ id: 1 }] : base.filas, error: base.errorEscritura ?? null }; } }) }),
      }),
    };
    return { c, escrito };
  }

  it("añade sobre lo que HAY, y conserva added_by y added_at de los que ya estaban", async () => {
    // Lo que había en la base tiene campos que `public.tutorials()` no devuelve: si se reescribiera
    // desde la lista de la pantalla, se perderían.
    const enLaBase = [guardado("g1", "Entrar al hub")];
    const { c, escrito } = cliente({ tutorials: enLaBase });
    const nuevo = guardado("n1", "Nuevo", { app: "erp" });
    const r = await guardaTutoriales(c, (actual) => [...actual, nuevo]);
    expect(r).toEqual({ ok: true, tutoriales: [enLaBase[0], nuevo] });
    expect(escrito).toEqual([[enLaBase[0], nuevo]]);
    expect(escrito[0][0].added_by).toBe("admin-1");
  });

  it("quitar quita solo ese", async () => {
    const { c, escrito } = cliente({ tutorials: [guardado("a", "A"), guardado("b", "B")] });
    await guardaTutoriales(c, (actual) => actual.filter((t) => t.id !== "a"));
    expect(escrito[0].map((t) => t.id)).toEqual(["b"]);
  });

  it("si el update no toca ninguna fila (la política no deja), NO cuenta como guardado", async () => {
    const { c } = cliente({ tutorials: [], filas: [] });
    expect(await guardaTutoriales(c, (a) => a)).toEqual({ ok: false, motivo: "sin_permiso" });
  });

  it("si falla la lectura no se escribe nada", async () => {
    const { c, escrito } = cliente({ tutorials: [], errorLectura: { message: "permission denied" } });
    expect(await guardaTutoriales(c, (a) => [...a, guardado("x", "X")])).toEqual({ ok: false, motivo: "lectura" });
    expect(escrito).toEqual([]);
  });

  it("si la escritura falla, se dice", async () => {
    const { c } = cliente({ tutorials: [], errorEscritura: { message: "boom" } });
    expect(await guardaTutoriales(c, (a) => a)).toEqual({ ok: false, motivo: "escritura" });
  });

  it("una columna rara se trata como vacía, no rompe", async () => {
    const { c, escrito } = cliente({ tutorials: { no: "es una lista" } });
    await guardaTutoriales(c, (actual) => [...actual, guardado("x", "X")]);
    expect(escrito[0].map((t) => t.id)).toEqual(["x"]);
  });
});

describe("los caminos hasta los tutoriales", () => {
  it("la herramienta del hub es para todos los roles, chofer incluido", () => {
    const tool = HUB_TOOLS.find((t) => t.key === "tutorials");
    expect(tool?.href).toBe("/home/tutorials");
    for (const role of ["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"] as const) {
      expect(tool?.visible({ role }), role).toBe(true);
    }
  });

  it("la puerta solo pide sesión: el chofer, que no entra al lobby (D-173), llega", () => {
    const puerta = sinComentarios(leer("src/app/home/tutorials/layout.tsx"));
    expect(puerta).toContain("auth.getUser()");
    expect(puerta).toContain('redirect("/login?next=/home/tutorials")');
    expect(puerta).not.toContain("canReachHub");
    expect(puerta).not.toMatch(/role\s*[!=]==?\s*"/);
  });

  it("la página decide quién gestiona con la regla de admin, del perfil de la sesión", () => {
    const pagina = sinComentarios(leer("src/app/home/tutorials/page.tsx"));
    expect(pagina).toMatch(/puedeGestionar=\{puedeGestionarTutoriales\(perfil\?\.role\)\}/);
  });

  it("la lista sale de la función de la 113, no de settings", () => {
    const hub = sinComentarios(leer("src/components/tutorials/TutorialsHub.tsx"));
    expect(hub).toContain('.rpc("tutorials")');
    expect(hub).not.toMatch(/\.from\("settings"\)/);
    // Y guardar pasa por la función que relee y exige una fila.
    expect(hub).toMatch(/guardaTutoriales\(/);
  });

  it("Entregas ya no tiene la sección, y lleva al hub", () => {
    // Hasta D-274 el camino era la Cuenta de Entregas; ahora la Cuenta redirige a Mi perfil y el
    // camino es el menú del nombre, que lo enseña a quien no ve la casa (el chofer, D-173).
    const barra = sinComentarios(leer("src/components/TopBar.tsx"));
    expect(barra).not.toContain("TutorialsSection");
    expect(barra).not.toContain("tutorialEmbed");
    expect(barra).toContain('href="/home/tutorials"');
    expect(sinComentarios(leer("src/app/(app)/account/page.tsx"))).not.toContain("TutorialsSection");
  });

  it("la vista del video no está duplicada: un solo sitio usa tutorialEmbed", () => {
    for (const f of ["src/components/TopBar.tsx", "src/app/home/tutorials/page.tsx"]) {
      expect(sinComentarios(leer(f)), f).not.toContain("tutorialEmbed(");
    }
    expect(sinComentarios(leer("src/components/tutorials/TutorialsHub.tsx"))).toContain("tutorialEmbed(");
  });
});

describe("113_tutorials_for_everyone.sql", () => {
  const sql = leer("supabase/migrations/113_tutorials_for_everyone.sql");
  const ejecutable = sinComentarios(sql);
  const cuerpo = ejecutable.slice(ejecutable.indexOf("create or replace function public.tutorials()"), ejecutable.indexOf("$$;"));

  it("la función está (control)", () => {
    expect(cuerpo).toContain("create or replace function public.tutorials()");
    expect(cuerpo.length).toBeGreaterThan(300);
  });

  it("devuelve lo que la página pinta, y nada de quién ni cuándo", () => {
    const bloque = cuerpo.slice(cuerpo.indexOf("returns table ("), cuerpo.indexOf(")\nlanguage sql"));
    expect([...bloque.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1])).toEqual(["id", "title", "description", "url", "app"]);
    expect(cuerpo).not.toMatch(/added_by|added_at/);
  });

  it("lee solo los tutoriales de la fila de Ajustes, en su orden", () => {
    expect(cuerpo).toContain("where cfg.id = 1");
    expect(cuerpo).toContain("order by t.ordinality");
    const referencias = [...cuerpo.matchAll(/\bcfg\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(referencias)).toEqual(new Set(["tutorials", "id"]));
  });

  it("es security definer con search_path, y solo la ejecuta quien tiene sesión", () => {
    expect(cuerpo).toContain("security definer");
    expect(cuerpo).toContain("set search_path = public, pg_temp");
    expect(ejecutable).toContain("revoke execute on function public.tutorials() from public, anon;");
    expect(ejecutable).toContain("grant  execute on function public.tutorials() to authenticated;");
  });

  it("no toca la RLS de settings ni escribe nada", () => {
    expect(ejecutable).not.toMatch(/create\s+policy|drop\s+policy|alter\s+policy/i);
    expect(ejecutable).not.toMatch(/\bupdate\s+public\.settings\b|\binsert\s+into\s+public\.settings\b/i);
  });

  it("se auto-registra en el ledger y no lleva el marcador sin numerar", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain("113_tutorials_for_everyone.sql");
    expect(sql).not.toContain("D-" + "NEXT");
  });
});
