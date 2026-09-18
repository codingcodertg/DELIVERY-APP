import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aQuienSeAvisa, AYUDA_MENSAJE_KIND, AYUDA_RESPUESTA_KIND, cuerpoDelMensaje, destinoDelAvisoDeAyuda, hiloCompleto,
  ladoDelAutor, LIMITE_DEL_MENSAJE, noLeidos, noLeidosPorSolicitud, participaEnElHilo, puedeAdjuntar,
  reabreAlContestar, repartoDeNoLeidos, RUTA_MIS_SOLICITUDES, RUTA_SOLICITUDES_ADMIN, type MensajeDeAyuda,
} from "./help-thread";
import { ASOMO_DEL_MENSAJE, type SolicitudDeAyuda } from "./help-requests";
import { AYUDA_ATENDIDA_KIND } from "./notifications";
import { HUB_TOOLS, ROLE_ORDER } from "./constants";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const solicitud = (extra: Partial<SolicitudDeAyuda> = {}): SolicitudDeAyuda => ({
  id: "s1", created_at: "2026-09-18T10:00:00.000Z", user_id: "persona", sender_name: "Ana", sender_email: null,
  role_label: null, page: null, app_version: null, lang: "es", message: "No carga el mapa", files: [],
  email_to: null, email_ok: null, email_error: null, status: "pendiente", attended_by: null, attended_at: null, ...extra,
});
const msg = (id: string, author_id: string | null, created_at: string, extra: Partial<MensajeDeAyuda> = {}): MensajeDeAyuda => ({
  id, request_id: "s1", author_id, author_name: null, body: id, files: [], created_at, ...extra,
});
const ADMINS = ["admin-a", "admin-b", "admin-c", "admin-d"];

describe("quién está en el hilo", () => {
  it("quien lo abrió y cualquier admin; nadie más", () => {
    expect(participaEnElHilo({ id: "persona", esAdmin: false }, solicitud())).toBe(true);
    expect(participaEnElHilo({ id: "admin-a", esAdmin: true }, solicitud())).toBe(true);
    expect(participaEnElHilo({ id: "otro", esAdmin: false }, solicitud())).toBe(false);
    expect(participaEnElHilo(null, solicitud())).toBe(false);
  });

  it("una solicitud cuya cuenta se borró queda solo para el admin", () => {
    expect(participaEnElHilo({ id: "otro", esAdmin: false }, solicitud({ user_id: null }))).toBe(false);
    expect(participaEnElHilo({ id: "admin-a", esAdmin: true }, solicitud({ user_id: null }))).toBe(true);
  });

  it("el lado lo decide quién abrió, no el rol: un admin que pide ayuda es, en su hilo, la persona", () => {
    expect(ladoDelAutor("persona", solicitud())).toBe("persona");
    expect(ladoDelAutor("admin-a", solicitud())).toBe("admin");
    expect(ladoDelAutor("admin-a", solicitud({ user_id: "admin-a" }))).toBe("persona");
    expect(ladoDelAutor(null, solicitud({ user_id: null }))).toBe("admin");
  });
});

describe("cuándo se reabre y quién adjunta", () => {
  it("contestar a una atendida la reabre solo si contesta quien la abrió", () => {
    expect(reabreAlContestar("persona", solicitud({ status: "atendida" }))).toBe(true);
    expect(reabreAlContestar("admin-a", solicitud({ status: "atendida" }))).toBe(false);
    expect(reabreAlContestar("persona", solicitud({ status: "pendiente" }))).toBe(false);
  });

  it("adjunta solo quien abrió la solicitud", () => {
    expect(puedeAdjuntar("persona", solicitud())).toBe(true);
    expect(puedeAdjuntar("admin-a", solicitud())).toBe(false);
  });
});

describe("a quién se avisa", () => {
  it("escribe un admin → a quien la abrió; sin cuenta, a nadie", () => {
    expect(aQuienSeAvisa({ autorId: "admin-a", solicitud: solicitud(), previos: [], admins: ADMINS })).toEqual(["persona"]);
    expect(aQuienSeAvisa({ autorId: "admin-a", solicitud: solicitud({ user_id: null }), previos: [], admins: ADMINS })).toEqual([]);
  });

  it("escribe la persona y nadie ha contestado ni atendido → a los cuatro admins", () => {
    expect(aQuienSeAvisa({ autorId: "persona", solicitud: solicitud(), previos: [], admins: ADMINS })).toEqual(ADMINS);
  });

  it("→ al ÚLTIMO admin que escribió en el hilo, y solo a él (datos desordenados a propósito)", () => {
    // El último NO es ni el primero ni el final de la lista: sin ordenar, o tomando un extremo, sale otro.
    const previos = [
      msg("m1", "admin-c", "2026-09-18T11:00:00.000Z"),
      msg("m3", "admin-b", "2026-09-18T12:00:00.000Z"),
      msg("m4", "persona", "2026-09-18T13:00:00.000Z"),
      msg("m2", "admin-a", "2026-09-18T11:30:00.000Z"),
    ];
    expect(aQuienSeAvisa({ autorId: "persona", solicitud: solicitud({ attended_by: "admin-d" }), previos, admins: ADMINS })).toEqual(["admin-b"]);
  });

  it("→ si ningún admin escribió, a quien la atendió", () => {
    const previos = [msg("m1", "persona", "2026-09-18T11:00:00.000Z")];
    expect(aQuienSeAvisa({ autorId: "persona", solicitud: solicitud({ attended_by: "admin-d" }), previos, admins: ADMINS })).toEqual(["admin-d"]);
  });

  it("quien dejó de ser admin no cuenta: ya no puede leer el hilo", () => {
    const previos = [msg("m1", "ex-admin", "2026-09-18T12:00:00.000Z"), msg("m0", "admin-c", "2026-09-18T11:00:00.000Z")];
    expect(aQuienSeAvisa({ autorId: "persona", solicitud: solicitud(), previos, admins: ADMINS })).toEqual(["admin-c"]);
    expect(aQuienSeAvisa({ autorId: "persona", solicitud: solicitud({ attended_by: "ex-admin" }), previos: [], admins: ADMINS })).toEqual(ADMINS);
  });

  it("nunca a quien escribe: un admin que pidió ayuda y escribe en su hilo no se avisa a sí mismo", () => {
    const suya = solicitud({ user_id: "admin-a", attended_by: "admin-a" });
    expect(aQuienSeAvisa({ autorId: "admin-a", solicitud: suya, previos: [msg("m1", "admin-a", "2026-09-18T11:00:00.000Z")], admins: ADMINS }))
      .toEqual(["admin-b", "admin-c", "admin-d"]);
  });
});

describe("a dónde lleva la campana", () => {
  it("por kind: la respuesta y la atendida a «Mis solicitudes»; el mensaje de la persona, a la vista del admin", () => {
    expect(destinoDelAvisoDeAyuda(AYUDA_RESPUESTA_KIND)).toBe(RUTA_MIS_SOLICITUDES);
    expect(destinoDelAvisoDeAyuda(AYUDA_ATENDIDA_KIND)).toBe(RUTA_MIS_SOLICITUDES);
    expect(destinoDelAvisoDeAyuda(AYUDA_MENSAJE_KIND)).toBe(RUTA_SOLICITUDES_ADMIN);
    expect(destinoDelAvisoDeAyuda("approved")).toBeNull();
  });

  it("las dos rutas existen como herramientas del hub: la mía para todos, la del admin solo para él", () => {
    const mia = HUB_TOOLS.find((h) => h.href === RUTA_MIS_SOLICITUDES)!;
    const suya = HUB_TOOLS.find((h) => h.href === RUTA_SOLICITUDES_ADMIN)!;
    for (const role of ROLE_ORDER) {
      expect([role, mia.visible({ role })]).toEqual([role, true]);
      expect([role, suya.visible({ role })]).toEqual([role, role === "admin"]);
    }
  });

  it("la campana pregunta primero si es de ayuda, y si no, va a la orden como siempre", () => {
    const campana = plano(sinComentarios(leer("src/components/NotificationBell.tsx")));
    expect(campana).toContain("const ayuda = destinoDelAvisoDeAyuda(kind); if (ayuda) router.push(ayuda); else if (deliveryId) router.push(`/?order=${deliveryId}`);");
    expect(campana).toContain("onPick(n.id, n.read, n.delivery_id, n.kind)");
  });
});

describe("no leídos", () => {
  const ms = [
    msg("m1", "admin-a", "2026-09-18T11:00:00.000Z"),
    msg("m2", "persona", "2026-09-18T11:30:00.000Z"),
    msg("m3", "admin-a", "2026-09-18T12:00:00.000Z"),
  ];

  it("los de otros, posteriores a mi última lectura; los míos nunca", () => {
    expect(noLeidos(ms, "persona", null)).toBe(2);
    expect(noLeidos(ms, "persona", "2026-09-18T11:15:00.000Z")).toBe(1);
    expect(noLeidos(ms, "persona", "2026-09-18T12:00:00.000Z")).toBe(0);
    expect(noLeidos(ms, "admin-a", null)).toBe(1);
  });

  it("la hora se compara como instante, no como texto: la base contesta con otro formato", () => {
    expect(noLeidos([msg("m", "admin-a", "2026-09-18T12:00:00.5+00:00")], "persona", "2026-09-18T06:00:00.000-06:00")).toBe(1);
    expect(noLeidos([msg("m", "admin-a", "2026-09-18T11:59:59+00:00")], "persona", "2026-09-18T06:00:00.000-06:00")).toBe(0);
  });

  it("por solicitud, y solo las que tienen algo", () => {
    const otros = [...ms, msg("x1", "admin-b", "2026-09-18T09:00:00.000Z", { request_id: "s2" }), msg("y1", "persona", "2026-09-18T09:00:00.000Z", { request_id: "s3" })];
    const mapa = noLeidosPorSolicitud(otros, [{ request_id: "s1", read_at: "2026-09-18T11:15:00.000Z" }], "persona");
    expect([...mapa.entries()].sort()).toEqual([["s1", 1], ["s2", 1]]);
  });

  it("en el lobby: lo de mis solicitudes a una tarjeta y lo ajeno a la otra, sin contar nada dos veces", () => {
    expect(repartoDeNoLeidos(new Map([["s1", 2], ["s2", 3], ["s3", 1]]), ["s2"])).toEqual({ mias: 3, ajenas: 3 });
    expect(repartoDeNoLeidos(new Map(), ["s2"])).toEqual({ mias: 0, ajenas: 0 });
  });
});

describe("el hilo y lo que se envía", () => {
  it("la solicitud original es el primer mensaje, con sus adjuntos; después lo escrito, en orden y solo lo de ese hilo", () => {
    const s = solicitud({ files: [{ path: "persona/a.png", nombre: "a.png" }] });
    const hilo = hiloCompleto(s, [
      msg("m2", "persona", "2026-09-18T12:00:00.000Z"),
      msg("ajeno", "admin-a", "2026-09-18T10:30:00.000Z", { request_id: "s2" }),
      msg("m1", "admin-a", "2026-09-18T11:00:00.000Z"),
    ]);
    expect(hilo.map((m) => m.id)).toEqual(["solicitud:s1", "m1", "m2"]);
    expect(hilo[0]).toMatchObject({ author_id: "persona", author_name: "Ana", body: "No carga el mapa", files: [{ path: "persona/a.png", nombre: "a.png" }] });
  });

  it("vacío o solo espacios no se envía; más de lo que admite la base, tampoco", () => {
    expect(cuerpoDelMensaje("  hola  ")).toEqual({ ok: true, body: "hola" });
    expect(cuerpoDelMensaje("   ")).toEqual({ ok: false, motivo: "vacio" });
    expect(cuerpoDelMensaje("a".repeat(LIMITE_DEL_MENSAJE))).toMatchObject({ ok: true });
    expect(cuerpoDelMensaje("a".repeat(LIMITE_DEL_MENSAJE + 1))).toEqual({ ok: false, motivo: "largo" });
  });
});

describe("la pantalla usa las reglas y no inserta lo que no puede leer", () => {
  const hilo = plano(sinComentarios(leer("src/components/HiloDeAyuda.tsx")));

  it("el mensaje se inserta con id propio y SIN pedirlo de vuelta", () => {
    expect(hilo).toContain("const id = globalThis.crypto?.randomUUID?.();");
    expect(hilo).toContain('await supabase.from("help_messages").insert([id ? { id, ...fila } : fila]);');
    expect(hilo).toContain("const fila = { request_id: solicitud.id, author_id: yo.id, body: cuerpo.body, files: subida.subidos };");
  });

  it("el push solo cuando escribe el admin, con el id del mensaje, y después de que entrara", () => {
    const fallo = hilo.indexOf("if (e) { setError(e.message); setEnviando(false); return; }");
    const push = hilo.indexOf('if (id && ladoDelAutor(yo.id, solicitud) === "admin" && solicitud.user_id) {');
    expect(fallo).toBeGreaterThan(0);
    expect(push).toBeGreaterThan(fallo);
    expect(hilo).toContain("body: JSON.stringify({ notification_id: id }),");
  });

  it("ninguna pantalla de ayuda escribe en `notifications` por su cuenta: eso es de la base", () => {
    for (const f of ["src/components/HiloDeAyuda.tsx", "src/app/home/ayuda/page.tsx", "src/lib/help-send.ts", "src/lib/help-thread.ts"]) {
      expect(sinComentarios(leer(f)), f).not.toContain('from("notifications")');
    }
  });

  it("un canal por hilo abierto, filtrado, que se cierra; y la red de seguridad", () => {
    expect(hilo).toContain(".channel(`help-thread:${solicitud.id}`)");
    expect(hilo).toContain('{ event: "INSERT", schema: "public", table: "help_messages", filter: `request_id=eq.${solicitud.id}` }');
    expect(hilo).toContain("void supabase.removeChannel(canal);");
    expect(hilo).toContain('document.addEventListener("visibilitychange", alVolver);');
    expect(hilo).toContain('window.addEventListener("focus", alVolver);');
  });

  it("la caja, los adjuntos y el aviso de reapertura salen de las funciones", () => {
    expect(hilo).toContain("const puede = participaEnElHilo(yo, solicitud);");
    expect(hilo).toContain("{puede && (");
    expect(hilo).toContain("const adjunta = puedeAdjuntar(yo.id, solicitud);");
    expect(hilo).toContain("onEnviado?.({ reabierta: reabreAlContestar(yo.id, solicitud) });");
    expect(hilo).not.toMatch(/\.role\b/);
  });

  it("«Mis solicitudes» enseña solo las propias, también a un admin, y sin el DataProvider de Entregas", () => {
    const pagina = sinComentarios(leer("src/app/home/ayuda/page.tsx"));
    expect(plano(pagina)).toContain('.from("help_requests").select(COLUMNAS).eq("user_id", uid)');
    expect(pagina).not.toContain("useData");
    expect(pagina).toContain("await enviaSolicitudDeAyuda({");
    expect(sinComentarios(leer("src/components/HiloDeAyuda.tsx"))).not.toContain("useData");
  });

  it("su puerta solo pide sesión: el chofer, que no entra al lobby, llega desde la campana", () => {
    const puerta = sinComentarios(leer("src/app/home/ayuda/layout.tsx"));
    expect(puerta).toContain('if (!user) redirect("/login?next=/home/ayuda");');
    expect(puerta).not.toContain("canReachHub");
    expect(puerta).not.toContain("role");
  });
});

describe("126: la base dice lo mismo", () => {
  const nombre = "126_ayuda_chat.sql";
  const sql = leer(`supabase/migrations/${nombre}`);
  const ejecutable = plano(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n"));
  const funcion = (n: string) => {
    const i = ejecutable.indexOf(`create or replace function public.${n}(`);
    if (i < 0) throw new Error(`no encuentro ${n}`);
    return ejecutable.slice(i, ejecutable.indexOf("end $$;", i));
  };
  const politica = (n: string) => {
    const i = ejecutable.indexOf(`create policy "${n}"`);
    if (i < 0) throw new Error(`no encuentro la política ${n}`);
    return ejecutable.slice(i, ejecutable.indexOf(";", i));
  };
  /** Las condiciones de un `with check` / `using`, como conjunto: el orden de los `and` no decide nada. */
  const condiciones = (texto: string, clausula: "using" | "with check") => {
    const i = texto.indexOf(`${clausula} (`);
    if (i < 0) return [];
    let nivel = 0, j = i + clausula.length + 1;
    const ini = j + 1;
    for (; j < texto.length; j++) { if (texto[j] === "(") nivel++; if (texto[j] === ")") { nivel--; if (nivel === 0) break; } }
    return texto.slice(ini, j).split(/\s+and\s+/).map((c) => c.trim()).sort();
  };

  it("participa quien la abrió o un admin — lo mismo que participaEnElHilo", () => {
    const f = funcion("can_see_help_request");
    expect(f).toContain("select coalesce(public.is_admin(), false) or exists (select 1 from public.help_requests r where r.id = rid and r.user_id = auth.uid());");
    expect(f).toContain("security definer");
    expect(ejecutable).toContain("revoke execute on function public.can_see_help_request(uuid) from public, anon;");
  });

  it("leer: quien participa. Escribir: quien participa Y en su propio nombre", () => {
    expect(condiciones(politica("help_messages select"), "using")).toEqual(["(select public.can_see_help_request(request_id))"]);
    expect(condiciones(politica("help_messages insert"), "with check")).toEqual([
      "(select public.can_see_help_request(request_id))", "author_id = (select auth.uid())",
    ]);
  });

  it("las lecturas: cada uno la suya, y solo de hilos en los que participa", () => {
    expect(condiciones(politica("help_reads select own"), "using")).toEqual(["user_id = (select auth.uid())"]);
    for (const p of ["help_reads insert own", "help_reads update own"]) {
      expect(condiciones(politica(p), "with check"), p).toEqual(["(select public.can_see_help_request(request_id))", "user_id = (select auth.uid())"]);
    }
    expect(condiciones(politica("help_reads update own"), "using")).toEqual(["user_id = (select auth.uid())"]);
  });

  it("una política por comando: ninguna FOR ALL, y ninguna de UPDATE o DELETE sobre los mensajes", () => {
    const politicas = [...ejecutable.matchAll(/create policy "([^"]+)" on public\.(\w+) for (\w+)/g)].map((m) => [m[2], m[3]].join(" ")).sort();
    expect(politicas).toEqual(["help_messages insert", "help_messages select", "help_reads insert", "help_reads select", "help_reads update"]);
  });

  it("los permisos: primero se quita todo, y a los mensajes solo se les da leer e insertar", () => {
    const quita = ejecutable.indexOf("revoke all on public.help_messages from anon, authenticated;");
    const da = ejecutable.indexOf("grant select, insert on public.help_messages to authenticated;");
    expect(quita).toBeGreaterThan(0);
    expect(da).toBeGreaterThan(quita);
    expect(ejecutable).toContain("revoke all on public.help_reads from anon, authenticated;");
    expect(ejecutable).not.toMatch(/grant [^;]*(update|delete|all)[^;]* on public\.help_messages/);
  });

  it("reabre SOLO en la rama de quien la abrió, y solo si estaba atendida — como reabreAlContestar", () => {
    const f = funcion("help_message_after_insert");
    const persona = f.indexOf("if NEW.author_id = s.user_id then");
    const admin = f.indexOf("elsif s.user_id is not null then");
    const reabre = f.indexOf("if s.status = 'atendida' then update public.help_requests set status = 'pendiente', attended_by = null, attended_at = null where id = s.id; end if;");
    expect(persona).toBeGreaterThan(0);
    expect(reabre).toBeGreaterThan(persona);
    expect(reabre).toBeLessThan(admin);
    expect(f.match(/update public\.help_requests/g)?.length).toBe(1);
  });

  it("avisa como aQuienSeAvisa: último admin del hilo → quien atendió → todos; nunca al autor", () => {
    const f = funcion("help_message_after_insert");
    const ultimo = f.indexOf("join public.profiles p on p.id = m.author_id and p.role = 'admin' where m.request_id = s.id and m.author_id <> NEW.author_id order by m.created_at desc limit 1;");
    const atendio = f.indexOf("if destino is null then select p.id into destino from public.profiles p where p.id = s.attended_by and p.role = 'admin' and p.id <> NEW.author_id; end if;");
    const uno = f.indexOf("if destino is not null then insert into public.notifications (user_id, kind, message) values (destino, 'ayuda_mensaje',");
    const todos = f.indexOf("from public.profiles p where p.role = 'admin' and p.id <> NEW.author_id; end if;");
    expect(ultimo).toBeGreaterThan(0);
    expect(atendio).toBeGreaterThan(ultimo);
    expect(uno).toBeGreaterThan(atendio);
    expect(todos).toBeGreaterThan(uno);
  });

  it("al responder el admin, el id del aviso ES el del mensaje, y va a quien la abrió en su idioma", () => {
    const f = funcion("help_message_after_insert");
    expect(f).toContain("insert into public.notifications (id, user_id, kind, message) values (NEW.id, s.user_id, 'ayuda_respuesta',");
    expect(f).toContain("case when lower(btrim(coalesce(s.lang, ''))) like 'es%'");
    // Y a los admins el id lo pone la base: pueden ser varias filas.
    expect(f).not.toMatch(/insert into public\.notifications \(id, user_id, kind, message\)[^;]*'ayuda_mensaje'/);
  });

  it("los kinds y el largo del asomo son los de la app", () => {
    const f = funcion("help_message_after_insert");
    expect([...new Set([...f.matchAll(/'(ayuda_\w+)'/g)].map((m) => m[1]))].sort()).toEqual([AYUDA_MENSAJE_KIND, AYUDA_RESPUESTA_KIND].sort());
    expect(f).toContain(`if char_length(asomo) > ${ASOMO_DEL_MENSAJE} then asomo := rtrim(left(asomo, ${ASOMO_DEL_MENSAJE - 1})) || '…'; end if;`);
    expect(ejecutable).toContain(`check (char_length(btrim(body)) between 1 and ${LIMITE_DEL_MENSAJE})`);
  });

  it("nombre y hora los pone la base; adjunta solo quien la abrió y solo de su carpeta — como puedeAdjuntar", () => {
    const f = funcion("help_message_before_insert");
    expect(f).toContain("NEW.created_at := now();");
    expect(f).toContain("NEW.author_name := (select p.full_name from public.profiles p where p.id = NEW.author_id);");
    expect(f).toContain("if NEW.author_id is distinct from duenio then raise exception");
    expect(f).toContain("select count(*) into ajeno from jsonb_array_elements(NEW.files) f where coalesce(f->>'path', '') not like (NEW.author_id::text || '/%'); if ajeno > 0 then raise exception");
    expect(funcion("help_read_stamp")).toContain("NEW.read_at := now();");
  });

  it("nadie edita ni borra: solo pasa el `set null` del autor y el borrado en cascada con su solicitud", () => {
    const f = funcion("guard_help_message_immutable");
    expect(f).toContain("if exists (select 1 from public.help_requests r where r.id = OLD.request_id) then raise exception 'A help message is history: it cannot be deleted'; end if;");
    expect(f).toContain("probe := NEW; probe.author_id := OLD.author_id; if NEW.author_id is null and probe is not distinct from OLD then return NEW; end if; raise exception 'A help message is history: it cannot be edited';");
    expect(ejecutable).toContain("create trigger help_messages_guard_immutable before update or delete on public.help_messages");
  });

  it("no lleva transacción propia, no toca la 120, y entra en el tiempo real", () => {
    expect(sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n")).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(ejecutable).not.toMatch(/(alter|drop) (table|policy)[^;]*help_requests|create policy "[^"]*" on public\.help_requests/);
    expect(ejecutable).toContain("alter publication supabase_realtime add table public.help_messages;");
  });

  it("se comprueba a sí misma: RLS, número de políticas, ninguna ALL, sin permisos de más, disparadores y publicación", () => {
    const auto = ejecutable.slice(ejecutable.indexOf("do $comprueba$"));
    for (const pieza of [
      "relrowsecurity from pg_class where oid = 'public.help_messages'::regclass",
      "relrowsecurity from pg_class where oid = 'public.help_reads'::regclass",
      "tablename = 'help_messages'; if n <> 2",
      "tablename = 'help_reads'; if n <> 3",
      "and cmd = 'ALL'; if n <> 0",
      "has_table_privilege('authenticated', 'public.help_messages', 'UPDATE')",
      "has_table_privilege('authenticated', 'public.help_messages', 'DELETE')",
      "'help_messages_before_insert', 'help_messages_after_insert', 'help_messages_guard_immutable'); if n <> 3",
      "pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'help_messages'",
      "tablename = 'help_requests'; if n <> 3",
    ]) expect(auto, pieza).toContain(pieza);
  });

  it("el ensayo recorre a la persona, a otro, a dos admins y a la llave de servicio; y se deshace", () => {
    for (const quien of ["persona", "otro", "admin-2"]) expect(sql).toContain(`{"sub":"<uuid-${quien}>","role":"authenticated"}`);
    for (const caso of ["A2 lo mismo con author_id = <uuid-admin>", "B2 insert en <sol-suya> como <uuid-otro>", "C3 insert con files no vacio", "D1 update public.help_messages", "el admin NO reabre"]) {
      expect(sql, caso).toContain(caso);
    }
    expect(sql).toContain("--   rollback;");
  });

  it("se auto-registra y no lleva el marcador sin numerar", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain(nombre);
    expect(sql).not.toContain("D-" + "NEXT");
  });
});
