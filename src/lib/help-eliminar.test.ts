import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  COLUMNAS_CON_ELIMINACION, COLUMNAS_DE_SOLICITUD, COLUMNAS_SIN_UBICACION, estaEliminada, leeSolicitudes, listaSegunEstado,
  parcheDeEliminacion, sePuedeEliminar, separaEliminadas, separaPorEstado, type SolicitudDeAyuda,
} from "./help-requests";
import {
  FUNCION_DE_ELIMINAR, FUNCION_DE_RESTAURAR, eliminaSolicitud, mensajeDeEliminar, restauraSolicitud, type ClienteDeEliminar,
} from "./help-eliminar";
import { noLeidosPorSolicitud, repartoDeNoLeidos, sinLasEliminadas } from "./help-thread";
import { ConfirmarEliminarSolicitud } from "@/components/ConfirmarEliminarSolicitud";

// El modal se pinta de verdad (a HTML) más abajo; solo necesita el idioma, que aquí es inglés fijo.
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ lang: "en", t: (en: string) => en }) }));

/**
 * Eliminar una solicitud de ayuda (262, D-NEXT). Roberto, desde «Mis solicitudes»: «Maybe add option to eliminate
 * request».
 *
 * Ninguna prueba toca la base: el cliente es un doble, y de la migración se mira el texto. La 262 se ensayó aparte,
 * entera, en un Postgres en memoria (lo dice su propio fichero).
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const t = (en: string, _es: string) => en;

const fila = (extra: Partial<SolicitudDeAyuda> = {}): SolicitudDeAyuda => ({
  id: "s1", created_at: "2026-11-06T15:10:20.000Z", user_id: "u1", sender_name: "Roberto", sender_email: "r@x.test",
  role_label: "Admin", page: "/home/ayuda", app_version: "1.554.0", lang: "en", message: "This question can be removed", files: [],
  email_to: "soporte@x.test", email_ok: true, email_error: null, status: "pendiente", attended_by: null,
  attended_at: null, deleted_at: null, deleted_by: null, deleted_by_name: null, ...extra,
});

const ELIMINADA = { deleted_at: "2026-11-06T16:00:00.000Z", deleted_by: "u1", deleted_by_name: "Roberto" };

describe("qué es una solicitud eliminada", () => {
  it("lo dice `deleted_at`; sin la 262 (columna sin definir) ninguna lo está", () => {
    expect(estaEliminada(fila())).toBe(false);
    expect(estaEliminada(fila(ELIMINADA))).toBe(true);
    expect(estaEliminada({})).toBe(false);
  });

  it("el botón de eliminar solo se enseña si la base ya trae la columna", () => {
    expect(sePuedeEliminar(fila())).toBe(true);
    expect(sePuedeEliminar(fila(ELIMINADA))).toBe(true);
    expect(sePuedeEliminar({})).toBe(false);
  });

  it("las vivas por un lado y las eliminadas por otro, en su orden", () => {
    const filas = [fila({ id: "a" }), fila({ id: "b", ...ELIMINADA }), fila({ id: "c", status: "atendida", attended_by: "ad", attended_at: "x" }), fila({ id: "d", status: "atendida", ...ELIMINADA })];
    const { vivas, eliminadas } = separaEliminadas(filas);
    expect(vivas.map((s) => s.id)).toEqual(["a", "c"]);
    expect(eliminadas.map((s) => s.id)).toEqual(["b", "d"]);
  });
});

describe("una pendiente eliminada deja de contar como abierta", () => {
  const filas = [
    fila({ id: "abierta" }),
    fila({ id: "abierta-eliminada", ...ELIMINADA }),
    fila({ id: "atendida", status: "atendida", attended_by: "ad", attended_at: "x" }),
    fila({ id: "atendida-eliminada", status: "atendida", attended_by: "ad", attended_at: "x", ...ELIMINADA }),
  ];
  const { vivas, eliminadas } = separaEliminadas(filas);
  const partes = { ...separaPorEstado(vivas), eliminadas };

  it("ni en la lista de trabajo, ni en Atendidas, ni en Todas", () => {
    expect(listaSegunEstado("pendientes", partes).map((s) => s.id)).toEqual(["abierta"]);
    expect(listaSegunEstado("atendidas", partes).map((s) => s.id)).toEqual(["atendida"]);
    expect(listaSegunEstado("todas", partes).map((s) => s.id)).toEqual(["abierta", "atendida"]);
  });

  it("y el admin las ve solo cuando las pide", () => {
    expect(listaSegunEstado("eliminadas", partes).map((s) => s.id)).toEqual(["abierta-eliminada", "atendida-eliminada"]);
    // Quien llame sin eliminadas (código de antes) no revienta.
    expect(listaSegunEstado("eliminadas", separaPorEstado(vivas))).toEqual([]);
  });

  it("el estado NO se toca al eliminar: restaurada vuelve a donde estaba", () => {
    const restaurada = { ...filas[1], ...parcheDeEliminacion(false, { id: "", nombre: null }, "") };
    expect(restaurada.status).toBe("pendiente");
    expect(estaEliminada(restaurada)).toBe(false);
    expect(parcheDeEliminacion(true, { id: "ad", nombre: "Andrés" }, "2026-11-06T17:00:00.000Z"))
      .toEqual({ deleted_at: "2026-11-06T17:00:00.000Z", deleted_by: "ad", deleted_by_name: "Andrés" });
  });

  it("los mensajes sin leer de una eliminada no suman en la tarjeta del hub, ni como propios ni como ajenos", () => {
    const mensajes = [
      { request_id: "mia", author_id: "admin", created_at: "2026-11-06T10:00:00Z" },
      { request_id: "mia-eliminada", author_id: "admin", created_at: "2026-11-06T10:00:00Z" },
      { request_id: "ajena", author_id: "otro", created_at: "2026-11-06T10:00:00Z" },
      { request_id: "ajena-eliminada", author_id: "otro", created_at: "2026-11-06T10:00:00Z" },
    ];
    const todos = noLeidosPorSolicitud(mensajes, [], "yo");
    expect(repartoDeNoLeidos(todos, ["mia", "mia-eliminada"])).toEqual({ mias: 2, ajenas: 2 });
    const vivos = sinLasEliminadas(todos, ["mia-eliminada", "ajena-eliminada"]);
    expect(repartoDeNoLeidos(vivos, ["mia", "mia-eliminada"])).toEqual({ mias: 1, ajenas: 1 });
    // Sin la 262 no hay lista de eliminadas: sale como salía.
    expect(sinLasEliminadas(todos, [])).toEqual(todos);
  });
});

describe("leer con o sin la 262 aplicada", () => {
  it("pide las columnas de eliminación; si la base no las conoce, cae a las de la 258 y luego a las de siempre", async () => {
    const pedidas: string[] = [];
    const r = await leeSolicitudes(async (columnas) => {
      pedidas.push(columnas);
      return columnas === COLUMNAS_SIN_UBICACION
        ? { data: [{ id: "s1" }], error: null }
        : { data: null, error: { code: "42703", message: "column help_requests.deleted_at does not exist" } };
    });
    expect(pedidas).toEqual([COLUMNAS_CON_ELIMINACION, COLUMNAS_DE_SOLICITUD, COLUMNAS_SIN_UBICACION]);
    expect(r.data).toEqual([{ id: "s1" }]);
  });

  it("con la 262 aplicada, una sola consulta", async () => {
    let veces = 0;
    await leeSolicitudes(async () => { veces++; return { data: [], error: null }; });
    expect(veces).toBe(1);
    expect(COLUMNAS_CON_ELIMINACION).toContain("deleted_at, deleted_by, deleted_by_name");
  });

  it("un error que no es de columnas no se reintenta ni se esconde", async () => {
    let veces = 0;
    const r = await leeSolicitudes(async () => { veces++; return { data: null, error: { code: "42501", message: "permission denied" } }; });
    expect(veces).toBe(1);
    expect(r.error?.code).toBe("42501");
  });
});

describe("las dos llamadas a la base", () => {
  const cliente = (error: { code?: string; message?: string } | null, llamadas: unknown[] = []): ClienteDeEliminar => ({
    rpc: async (fn, args) => { llamadas.push([fn, args]); return { data: null, error }; },
  });

  it("eliminar llama a delete_help_request con el id, y restaurar a restore_help_request", async () => {
    const llamadas: unknown[] = [];
    expect(await eliminaSolicitud(cliente(null, llamadas), "s1")).toEqual({ tipo: "hecho" });
    expect(await restauraSolicitud(cliente(null, llamadas), "s1")).toEqual({ tipo: "hecho" });
    expect(llamadas).toEqual([[FUNCION_DE_ELIMINAR, { p_id: "s1" }], [FUNCION_DE_RESTAURAR, { p_id: "s1" }]]);
    expect(FUNCION_DE_ELIMINAR).toBe("delete_help_request");
    expect(FUNCION_DE_RESTAURAR).toBe("restore_help_request");
  });

  it("la base dice que no (42501): no es suya", async () => {
    const r = await eliminaSolicitud(cliente({ code: "42501", message: "Help request not found, or it is not yours to remove" }), "s1");
    expect(r).toEqual({ tipo: "no-permitido" });
    expect(mensajeDeEliminar(r, t)).toBe("You can only delete your own requests.");
    expect(mensajeDeEliminar(r, t, "restaurar")).toBe("Only an admin can restore a request.");
  });

  it("sin la 262 no hay función: se dice que aún no está, no un error críptico", async () => {
    for (const code of ["PGRST202", "42883"]) {
      const r = await eliminaSolicitud(cliente({ code, message: "Could not find the function" }), "s1");
      expect(r).toEqual({ tipo: "sin-migracion" });
      expect(mensajeDeEliminar(r, t)).toContain("isn't available yet");
    }
  });

  it("cualquier otro fallo se cuenta con su texto, y sin red tampoco revienta", async () => {
    const r = await eliminaSolicitud(cliente({ code: "P0001", message: "boom" }), "s1");
    expect(mensajeDeEliminar(r, t)).toBe("Couldn't delete it: boom");
    const caida: ClienteDeEliminar = { rpc: async () => { throw new Error("Failed to fetch"); } };
    expect(await restauraSolicitud(caida, "s1")).toEqual({ tipo: "error", mensaje: "Failed to fetch" });
    expect(mensajeDeEliminar({ tipo: "hecho" }, t)).toBeNull();
  });
});

describe("la migración 262", () => {
  const sql = leer("supabase/migrations/262_ayuda_eliminar_solicitud.sql");
  const cuerpo = sql.split("-- @ledger-below")[0];
  const sinComentarios = cuerpo.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const funcion = (nombre: string) => {
    const i = sinComentarios.indexOf(`create or replace function public.${nombre}(`);
    expect(i, nombre).toBeGreaterThan(-1);
    return sinComentarios.slice(i, sinComentarios.indexOf("end $$;", i));
  };

  it("es un borrado blando: añade columnas, y no hay ningún DELETE sobre las solicitudes", () => {
    expect(sinComentarios).toContain("add column if not exists deleted_at      timestamptz");
    expect(sinComentarios).toContain("add column if not exists deleted_by      uuid");
    expect(sinComentarios).toContain("add column if not exists deleted_by_name text");
    expect(sinComentarios).not.toMatch(/delete\s+from\s+public\.help_requests/i);
    expect(sinComentarios).not.toMatch(/storage\.objects/i);
  });

  it("eliminada sin quién no existe, y viva con restos de eliminación tampoco", () => {
    expect(sinComentarios).toContain("help_requests_deleted_needs_who");
    expect(sinComentarios).toContain("(deleted_at is null and deleted_by is null and deleted_by_name is null)");
    expect(sinComentarios).toContain("or (deleted_at is not null and deleted_by is not null)");
  });

  it("extiende el guardia de la 120/258 en vez de saltárselo: lo que protegía la 258 sigue protegido, igual", () => {
    const de258 = (() => {
      const s = leer("supabase/migrations/258_ayuda_ubicacion_clara.sql");
      const i = s.indexOf("  if NEW.user_id is distinct from OLD.user_id");
      return s.slice(i, s.indexOf("  end if;", i) + "  end if;".length);
    })();
    expect(de258).toContain("NEW.device      is distinct from OLD.device");
    expect(funcion("guard_help_request_immutable")).toContain(de258);
    // No se desactiva el disparador ni se usa `session_replication_role` para colarse.
    expect(sinComentarios).not.toMatch(/disable\s+trigger/i);
    expect(sinComentarios).not.toContain("session_replication_role");
    expect(sinComentarios).toContain("create trigger help_requests_guard_immutable\n  before update on public.help_requests");
  });

  it("el guardia decide quién: elimina quien la escribió o un admin, restaura solo un admin, y quién/cuándo los pone la base", () => {
    const guardia = funcion("guard_help_request_immutable");
    expect(guardia).toContain("if not (coalesce(public.is_admin(), false) or coalesce(OLD.user_id = yo, false)) then");
    expect(guardia).toContain("NEW.deleted_by := yo;");
    expect(guardia).toContain("NEW.deleted_at := now();");
    expect(guardia).toContain("if yo is not null and not coalesce(public.is_admin(), false) then");
    expect(guardia).toContain("it cannot be rewritten");
    expect(guardia).toContain("restore it before changing its status");
    expect(guardia).toContain("Removing a help request does not change its status");
  });

  it("las dos funciones son la puerta: con sesión, nunca anon, y con la misma regla", () => {
    const elimina = funcion("delete_help_request");
    expect(elimina).toContain("security definer set search_path = public");
    expect(elimina).toContain("if auth.uid() is null then");
    // `coalesce(..., false)`: con `user_id` nulo (cuenta borrada) la comparación da NULL, y un `if not NULL` no entra.
    expect(elimina).toContain("if not found or not (coalesce(public.is_admin(), false) or coalesce(s.user_id = auth.uid(), false)) then");
    expect(elimina).toContain("if s.deleted_at is not null then return s.deleted_at; end if;");
    const restaura = funcion("restore_help_request");
    expect(restaura).toContain("if auth.uid() is null or not coalesce(public.is_admin(), false) then");
    for (const f of ["delete_help_request", "restore_help_request"]) {
      expect(sinComentarios).toMatch(new RegExp(`revoke execute on function public\\.${f}\\(uuid\\)\\s+from public, anon;`));
      expect(sinComentarios).toMatch(new RegExp(`grant\\s+execute on function public\\.${f}\\(uuid\\)\\s+to authenticated;`));
    }
  });

  it("en el hilo de una eliminada no se escribe (si no, una respuesta la reabriría a escondidas)", () => {
    expect(funcion("help_message_not_on_deleted")).toContain("r.deleted_at is not null");
    expect(sinComentarios).toContain("create trigger help_messages_not_on_deleted\n  before insert on public.help_messages");
  });

  it("no cambia las políticas de la 120 ni mete `begin`/`commit` propios", () => {
    expect(sinComentarios).not.toMatch(/create policy|drop policy/i);
    expect(sinComentarios).toContain("'262: help_requests tiene % politicas, se esperaban 3'");
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("lleva su línea de registro y ningún número de decisión (numerar cambiaría el checksum)", () => {
    expect(sql).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\) values \('262_ayuda_eliminar_solicitud\.sql', '[0-9a-f]{64}'\) on conflict \(name\) do nothing;/);
    expect(sql).not.toMatch(/D-NEXT|D-\d{3}/);
  });

  it("y el código llama a las funciones que la migración crea", () => {
    expect(sinComentarios).toContain(`function public.${FUNCION_DE_ELIMINAR}(p_id uuid)`);
    expect(sinComentarios).toContain(`function public.${FUNCION_DE_RESTAURAR}(p_id uuid)`);
  });
});

describe("las pantallas", () => {
  const mias = leer("src/app/home/ayuda/page.tsx");
  const bandeja = leer("src/app/home/solicitudes-de-ayuda/page.tsx");
  const modal = leer("src/components/ConfirmarEliminarSolicitud.tsx");

  it("«Mis solicitudes»: cada tarjeta lleva Eliminar, en cualquier estado, y las eliminadas no se listan", () => {
    expect(mias).toContain("data-eliminar-solicitud");
    expect(mias).toContain('{t("Delete", "Eliminar")}');
    // El botón no depende del estado de la solicitud: solo de que la base sepa eliminar.
    expect(mias).toContain("{sePuedeEliminar(s) && (");
    expect(mias).toContain("separaEliminadas((data ?? []) as unknown as SolicitudDeAyuda[]).vivas");
    expect(mias).toContain("eliminaSolicitud(");
    // Al eliminarla sale de la lista y deja de sumar en «sin leer».
    expect(mias).toContain("setFilas((prev) => (prev ?? []).filter((x) => x.id !== s.id));");
  });

  it("la bandeja del admin: elimina cualquiera, las eliminadas no cuentan y hay filtro para verlas y restaurarlas", () => {
    expect(bandeja).toContain("const { vivas, eliminadas } = useMemo(() => separaEliminadas(visibles), [visibles]);");
    expect(bandeja).toContain("separaPorEstado(vivas)");
    expect(bandeja).toContain('<option value="eliminadas">');
    expect(bandeja).toContain('t("Show deleted", "Ver eliminadas")');
    expect(bandeja).toContain("({vivas.length})");
    expect(bandeja).toContain("data-restaurar-solicitud");
    expect(bandeja).toContain("restauraSolicitud(");
    expect(bandeja).toContain("data-eliminada-por");
    // El hilo de una eliminada se lee pero no se contesta.
    expect(bandeja).toContain("soloLectura={eliminada}");
    expect(leer("src/components/HiloDeAyuda.tsx")).toContain("{puede && !soloLectura && (");
  });

  it("se confirma en un modal de la app, nunca con un diálogo del navegador", () => {
    for (const fuente of [mias, bandeja, modal]) {
      expect(fuente).not.toMatch(/\b(confirm|alert|prompt)\(/);
    }
    expect(mias).toContain("<ConfirmarEliminarSolicitud");
    expect(bandeja).toContain("<ConfirmarEliminarSolicitud");
    expect(modal).toContain('className="overlay"');
    expect(modal).toContain('role="dialog" aria-modal="true"');
    expect(modal).toContain('t("Keep it", "Dejarla")');
    // Dice lo que pasa de verdad: deja de contar si estaba abierta, y no se pierde.
    expect(modal).toContain("It also stops counting as pending.");
    expect(modal).toContain("an admin can restore it");
  });

  it("el modal, pintado: a quien la escribió le dice que sale de su lista y, si está abierta, que deja de contar", () => {
    const nada = () => undefined;
    const html = renderToStaticMarkup(createElement(ConfirmarEliminarSolicitud, { solicitud: fila(), ocupado: false, onCancelar: nada, onConfirmar: nada }));
    expect(html).toContain("Delete this request?");
    expect(html).toContain("This question can be removed");
    expect(html).toContain("It leaves your list.");
    expect(html).toContain("It also stops counting as pending.");
    expect(html).toContain("an admin can restore it");
    expect(html).toContain(">Keep it</button>");
    expect(html).toContain(">Delete</button>");
  });

  it("el modal, pintado: una atendida no habla de pendientes; al admin le dice de quién es y dónde se restaura; y enseña el fallo", () => {
    const nada = () => undefined;
    const html = renderToStaticMarkup(createElement(ConfirmarEliminarSolicitud, {
      solicitud: fila({ status: "atendida", attended_by: "ad", attended_at: "2026-11-06T16:00:00.000Z" }),
      comoAdmin: true, ocupado: true, error: "You can only delete your own requests.", onCancelar: nada, onConfirmar: nada,
    }));
    expect(html).not.toContain("stops counting as pending");
    expect(html).toContain("Roberto");
    expect(html).toContain("the sender&#x27;s list");
    expect(html).toContain("Status → Deleted");
    expect(html).toContain("You can only delete your own requests.");
    // Mientras se elimina no se puede pulsar dos veces.
    expect(html).toContain("Deleting…");
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it("el hub no cuenta los mensajes sin leer de las eliminadas", () => {
    const hub = leer("src/components/HomeSelector.tsx");
    expect(hub).toContain('.not("deleted_at", "is", null)');
    expect(hub).toContain("sinLasEliminadas(");
    // Sin la 262 esa consulta falla: se toma como «ninguna» y el contador sigue saliendo.
    expect(hub).toContain("const eliminadas = es.error ? [] :");
  });
});

/**
 * La regla de compilación aprendida el 2026-11-06 (#730): un módulo que importa una ruta de servidor no puede traer
 * hooks de React; los hooks van en su propio fichero con "use client". `tsc` no lo ve; `next build` sí, y tarde.
 * Aquí se recorre a mano lo que importa `/api/help` y se comprueba.
 */
describe("lo que importa la ruta de servidor de ayuda no trae hooks", () => {
  const resuelve = (desde: string, especificador: string): string | null => {
    const base = especificador.startsWith("@/") ? join("src", especificador.slice(2))
      : especificador.startsWith(".") ? join(dirname(desde), especificador) : null;
    if (!base) return null;
    for (const cola of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const ruta = base + cola;
      if (/\.tsx?$/.test(ruta) && existsSync(join(process.cwd(), ruta))) return ruta.replace(/\\/g, "/");
    }
    return null;
  };
  const alcanzados = (entrada: string): string[] => {
    const vistos = new Set<string>();
    const cola = [entrada];
    while (cola.length) {
      const f = cola.pop()!;
      if (vistos.has(f)) continue;
      vistos.add(f);
      const fuente = leer(f);
      // `import type` se borra al compilar: no arrastra nada.
      for (const m of fuente.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
        const r = resuelve(f, m[1]);
        if (r) cola.push(r);
      }
    }
    return [...vistos];
  };
  const HOOK = /\buse(State|Effect|Memo|Callback|Ref|Context|Reducer|LayoutEffect|SyncExternalStore)\s*[(<]/;

  it("ni `/api/help` ni nada de lo que alcanza es de cliente o usa hooks", () => {
    const ficheros = alcanzados("src/app/api/help/route.ts");
    expect(ficheros).toContain("src/lib/help-requests.ts");
    for (const f of ficheros) {
      const fuente = leer(f);
      expect(fuente.startsWith('"use client"'), `${f} es de cliente`).toBe(false);
      expect(HOOK.test(fuente), `${f} usa hooks`).toBe(false);
    }
  });

  it("lo nuevo: las librerías no importan React, y el modal (que sí usa hooks) es de cliente y nadie del servidor lo trae", () => {
    for (const f of ["src/lib/help-eliminar.ts", "src/lib/help-requests.ts", "src/lib/help-thread.ts"]) {
      const fuente = leer(f);
      expect(fuente, f).not.toMatch(/from\s+["']react["']/);
      expect(HOOK.test(fuente), f).toBe(false);
    }
    expect(leer("src/components/ConfirmarEliminarSolicitud.tsx").startsWith('"use client"')).toBe(true);
    expect(alcanzados("src/app/api/help/route.ts")).not.toContain("src/components/ConfirmarEliminarSolicitud.tsx");
    expect(alcanzados("src/app/api/help/route.ts")).not.toContain("src/lib/help-eliminar.ts");
  });
});
