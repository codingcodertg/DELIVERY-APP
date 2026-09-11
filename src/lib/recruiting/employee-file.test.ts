import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  conHechosDeCuenta, estadoEmpleado, extensionValida, filasDeExpediente, limpiaExtension,
  nombreVisible, parcheAlta, parcheBaja, puedeEnlazarCuenta, puedeVerExpedientes,
  resumenDeCuenta, tipoDeAcceso,
} from "./employee-file";
import type { HechosDeCuenta } from "./employee-file";

// El expediente deja de ser la cuenta (106). Dos clases de prueba, y no se mezclan: las
// que importan la función que corre, y las que leen el `.sql` — texto, no una base
// ejecutándolo. Esta rama es de las que más pesa la segunda clase, así que va con su
// alcance dicho.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sql = leer("supabase/migrations/106_employee_file_identity.sql");
const acciones = leer("src/app/recruiting/actions/hr.ts");

const ficha = (extra: Record<string, unknown> = {}) => ({
  id: "f-1", profile_id: null as string | null, full_name: "Ana", email: null,
  date_hired: "2024-01-10", date_left: null as string | null, ringcentral_ext: null, ...extra,
});

describe("el estado se deriva, no se guarda", () => {
  it("sin fecha de salida está activo; con fecha, de baja", () => {
    expect(estadoEmpleado({ date_left: null })).toBe("activo");
    expect(estadoEmpleado({ date_left: "" })).toBe("activo");
    expect(estadoEmpleado({ date_left: "   " })).toBe("activo");
    expect(estadoEmpleado({ date_left: "2026-03-01" })).toBe("baja");
  });

  it("dar de baja y reactivar son la misma columna, en los dos sentidos", () => {
    const baja = parcheBaja("2026-03-01");
    expect(baja).toEqual({ date_left: "2026-03-01" });
    expect(estadoEmpleado(baja)).toBe("baja");
    expect(estadoEmpleado(parcheAlta())).toBe("activo");
  });

  it("una fecha ausente o con mala forma se convierte en hoy, no en basura", () => {
    for (const malo of [undefined, null, "", "mañana", "01/03/2026"]) {
      expect(parcheBaja(malo).date_left).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("no hay ninguna columna de estado en la migración", () => {
    // Si alguien añade `status`, habrá dos respuestas a «¿sigue aquí?» y una envejecerá.
    const columnas = sql.match(/add column if not exists\s+(\w+)/g) ?? [];
    expect(columnas.join(" ")).not.toMatch(/\b(status|estado|active|is_active)\b/);
    expect(columnas.join(" ")).toContain("date_left");
  });
});

describe("el nombre, con cuenta y sin ella", () => {
  it("con cuenta manda el del perfil, que es el que se edita en Usuarios", () => {
    expect(nombreVisible({ full_name: "Ana Vieja", profile_id: "p-1" }, "Ana Nueva")).toBe("Ana Nueva");
  });

  it("sin cuenta, el del expediente: una persona sin usuario también tiene nombre", () => {
    expect(nombreVisible({ full_name: "Ana", profile_id: null }, "Lo Que Sea")).toBe("Ana");
  });

  it("con cuenta pero sin nombre en el perfil, no se queda en blanco", () => {
    expect(nombreVisible({ full_name: "Ana", profile_id: "p-1" }, "   ")).toBe("Ana");
    expect(nombreVisible({ full_name: null, profile_id: "p-1" }, "Ana")).toBe("Ana");
    expect(nombreVisible({ full_name: null, profile_id: null }, null)).toBe("—");
  });
});

describe("los hechos de la cuenta se leen, no se copian", () => {
  const hechos = (extra: Partial<HechosDeCuenta> = {}): HechosDeCuenta => ({
    profile_id: "p-1", existe: true, acceso: "correo", last_sign_in_at: null, deshabilitada: false, ...extra,
  });

  it("distingue las tres cosas que el dueño quiere ver de un vistazo", () => {
    // «si tienen usuario creado» y «si lo ocupan» son preguntas distintas: una cuenta
    // creada y nunca usada es justo el caso que quiere encontrar.
    const sinCuenta = resumenDeCuenta({ profile_id: null }, null);
    expect(sinCuenta).toMatchObject({ tieneCuenta: false, ocupada: false });

    const nuncaEntro = resumenDeCuenta({ profile_id: "p-1" }, hechos());
    expect(nuncaEntro).toMatchObject({ tieneCuenta: true, ocupada: false, deshabilitada: false });

    const laUsa = resumenDeCuenta({ profile_id: "p-1" }, hechos({ last_sign_in_at: "2026-09-01T10:00:00Z" }));
    expect(laUsa).toMatchObject({ tieneCuenta: true, ocupada: true, ultimoAcceso: "2026-09-01T10:00:00Z" });
  });

  it("un expediente enlazado a una cuenta que ya no existe no miente", () => {
    // Pasa de verdad: `profile_id` es `on delete set null`, pero entre el borrado y la
    // siguiente lectura puede llegar un id sin cuenta detrás.
    const r = resumenDeCuenta({ profile_id: "p-1" }, hechos({ existe: false }));
    expect(r.tieneCuenta).toBe(false);
  });

  it("con usuario o con correo, según la dirección de acceso", () => {
    expect(tipoDeAcceso("ana@rdztilegroup.net")).toBe("correo");
    expect(tipoDeAcceso("ana@users.rdztilegroup.net")).toBe("usuario");
    expect(tipoDeAcceso("")).toBe(null);
    expect(tipoDeAcceso(null)).toBe(null);
  });

  it("emparejar deja pasar a los que no tienen cuenta, que es el objeto de la rama", () => {
    const filas = [ficha({ id: "f-1", profile_id: "p-1" }), ficha({ id: "f-2", profile_id: null })];
    const con = conHechosDeCuenta(filas, [hechos({ last_sign_in_at: "2026-01-01T00:00:00Z" })]);
    expect(con).toHaveLength(2);
    expect(con[0].cuenta.tieneCuenta).toBe(true);
    expect(con[1].cuenta.tieneCuenta).toBe(false);
  });
});

describe("quién puede qué", () => {
  it("ver expedientes: admin y gerente de RR. HH.; el reclutador no", () => {
    expect(puedeVerExpedientes("admin")).toBe(true);
    expect(puedeVerExpedientes("manager")).toBe(true);
    expect(puedeVerExpedientes("recruiter")).toBe(false);
    expect(puedeVerExpedientes(null)).toBe(false);
  });

  it("enlazar una cuenta: solo el admin, ni siquiera el gerente", () => {
    expect(puedeEnlazarCuenta("admin")).toBe(true);
    expect(puedeEnlazarCuenta("manager")).toBe(false);
    expect(puedeEnlazarCuenta("recruiter")).toBe(false);
  });
});

describe("la extensión de RingCentral", () => {
  it("se guarda solo con dígitos, y vacío es null", () => {
    expect(limpiaExtension(" 1-234 ")).toBe("1234");
    expect(limpiaExtension("")).toBe(null);
    expect(limpiaExtension("  ")).toBe(null);
  });

  it("acepta de 2 a 6 dígitos y nada más", () => {
    expect(extensionValida("12")).toBe(true);
    expect(extensionValida("123456")).toBe(true);
    expect(extensionValida(null)).toBe(true);
    expect(extensionValida("1")).toBe(false);
    expect(extensionValida("1234567")).toBe(false);
  });
});

describe("106_employee_file_identity.sql", () => {
  it("el expediente deja de ser la cuenta: se quita la FK de `id` a profiles", () => {
    // Y se busca por catálogo en vez de por nombre: un `drop constraint if exists` con el
    // nombre equivocado NO falla, y el expediente se quedaría atado sin que nadie lo note.
    const bloque = sql.slice(sql.indexOf("do $$"), sql.indexOf("alter column id set default"));
    expect(bloque).toContain("pg_constraint");
    expect(bloque).toContain("relname = 'employee_files'");
    expect(bloque).toMatch(/attname = 'id'/);
    expect(sql).toMatch(/alter column id set default gen_random_uuid\(\)/);
  });

  it("la cuenta se va sin llevarse el expediente: `set null`, nunca `cascade`", () => {
    // Es la línea que sostiene la rama entera. Con `cascade` volveríamos a 093 con otro
    // nombre: borrar la cuenta borraría el expediente y sus documentos.
    const col = sql.match(/add column if not exists profile_id[^;]*/);
    expect(col, "no encontré la columna profile_id").toBeTruthy();
    expect(col![0]).toContain("references public.profiles(id)");
    expect(col![0]).toContain("on delete set null");
    expect(col![0]).not.toContain("cascade");
  });

  it("un expediente por cuenta, y los que no tienen no estorban", () => {
    expect(sql).toMatch(/create unique index if not exists employee_files_profile_uniq[\s\S]*?where profile_id is not null/);
  });

  it("los documentos se reapuntan al expediente, y `created_by` no se toca", () => {
    // El fallo silencioso que casi cometo: la FK de `created_by` TAMBIÉN apunta a
    // profiles, así que un `drop` por tabla+destino se la habría llevado por delante.
    const bloque = sql.slice(sql.indexOf("relname = 'employee_docs'"));
    expect(bloque.slice(0, bloque.indexOf("end $$;"))).toMatch(/attname = 'employee_id'/);
    expect(sql).toMatch(/add constraint employee_docs_file_fkey[\s\S]*?references recruiting\.employee_files\(id\)/);
  });

  it("no da la migración por buena sin contar: si algo se descuelga, se cae", () => {
    const cierre = sql.slice(sql.indexOf("-- 5. Comprobar"));
    expect(cierre).toContain("raise exception");
    expect(cierre).toMatch(/docs_total <> docs_ligados/);
    expect(cierre).toMatch(/files_ligados <> perfiles/);
  });

  it("solo el admin de RR. HH. enlaza una cuenta, y lo dice la base", () => {
    const fn = sql.slice(sql.indexOf("create or replace function recruiting.guard_employee_file_link"));
    const cuerpo = fn.slice(0, fn.indexOf("end $$;"));
    expect(cuerpo).toMatch(/current_recruiting_role\(\), ''\) <> 'admin'/);
    expect(cuerpo).toContain("raise exception");
    // Y solo se mete cuando el enlace CAMBIA: un gerente tiene que poder seguir editando
    // el teléfono de una ficha ya enlazada.
    expect(cuerpo).toMatch(/NEW\.profile_id is not distinct from OLD\.profile_id/);
    expect(sql).toMatch(/create trigger employee_files_guard_link\s+before insert or update/);
  });

  it("se puede ejecutar dos veces: todo lo que crea es idempotente", () => {
    for (const l of sql.split("\n").filter((x) => /^\s*create (table|index|unique index|trigger)/i.test(x))) {
      expect(l, l).toMatch(/if not exists|create trigger/i);
    }
    for (const t of (sql.match(/create trigger (\w+)/g) ?? []).map((m) => m.split(" ")[2])) {
      expect(sql).toContain(`drop trigger if exists ${t}`);
    }
    for (const a of sql.match(/add column[^,;]*/g) ?? []) expect(a).toContain("if not exists");
    // La FK nueva no admite `if not exists`: se comprueba en el catálogo antes de crearla.
    expect(sql).toMatch(/if not exists \([\s\S]*?conname = 'employee_docs_file_fkey'/);
  });

  it("el expediente nace con la cuenta, no solo con la migración", () => {
    // El hueco que encontró la auditoría: sin esto, la migración cumple el encargo el día
    // que se aplica y lo incumple al siguiente — la persona 34 no tendría expediente y no
    // saldría en la lista de RR. HH.
    expect(sql).toMatch(/create trigger profiles_make_employee_file\s+after insert on public\.profiles/);
    const fn = sql.slice(sql.indexOf("create or replace function recruiting.new_profile_employee_file"));
    const cuerpo = fn.slice(0, fn.indexOf("end $$;"));
    expect(cuerpo).toContain("on conflict (id) do nothing");
    // Y crear una CUENTA no puede fallar por una fila de RR. HH.
    expect(cuerpo).toMatch(/exception when others then/);
    expect(cuerpo).toContain("raise warning");
    // El guard del enlace tiene que dejar pasar ese insert, o dar de alta fallaría para
    // cualquiera que no sea admin de RR. HH.
    const guard = sql.slice(sql.indexOf("create or replace function recruiting.guard_employee_file_link"));
    expect(guard.slice(0, guard.indexOf("end $$;"))).toContain("pg_trigger_depth() > 1");
  });

  it("se auto-registra en el ledger, como exige D-184", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain("insert into public.schema_migrations");
    expect(despues).toContain("106_employee_file_identity.sql");
  });
});

describe("la baja apaga la cuenta, no la borra", () => {
  it("las acciones nuevas usan el ban de Auth y nunca un borrado", () => {
    // `/api/delete-user` sigue existiendo para lo que es. Lo que no puede pasar es que
    // «dar de baja» acabe llamándolo: eso borraría el expediente que esta rama viene a
    // conservar.
    const src = acciones.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(src).toContain("ban_duration");
    expect(src).not.toContain("deleteUser");
    expect(src).not.toContain("delete-user");
  });

  it("la fecha se escribe antes que el ban, para que una baja a medias sea legible", () => {
    const src = acciones.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    const fn = src.slice(src.indexOf("export async function deactivateEmployee"));
    const cuerpo = fn.slice(0, fn.indexOf("export async function reactivate"));
    expect(cuerpo.indexOf("parcheBaja")).toBeGreaterThan(0);
    expect(cuerpo.indexOf("ban_duration")).toBeGreaterThan(cuerpo.indexOf("parcheBaja"));
  });

  it("nadie se da de baja a sí mismo", () => {
    const src = acciones.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(src).toMatch(/file\.profile_id === userId/);
  });

});

describe("armar la lista", () => {
  const docs = [
    { employee_id: "f-1", kind: "handbook", signed_at: "2025-02-02" },
    { employee_id: "f-1", kind: "license", signed_at: null },
  ];

  it("la lista sale de los EXPEDIENTES, y los que no tienen cuenta salen igual", () => {
    // Es la rama entera: antes se recorrían las cuentas, así que una baja o alguien que
    // aún no tiene usuario no existía para RR. HH.
    const filas = filasDeExpediente(
      [
        { id: "f-1", profile_id: "p-1", full_name: "Vieja" },
        { id: "f-2", profile_id: null, full_name: "Sin Cuenta", date_left: "2026-01-05" },
      ],
      [{ id: "p-1", full_name: "Ana" }],
      docs,
    );
    expect(filas.map((f) => f.full_name)).toEqual(["Ana", "Sin Cuenta"]);
    expect(filas[0].docKinds).toEqual(["handbook"]); // el que no está firmado no cuenta
    expect(estadoEmpleado(filas[1])).toBe("baja");
  });

  it("tolera la tabla ANTERIOR a la 106, donde la columna no existe", () => {
    // `select("*")` no falla por una columna que aún no está: la devuelve ausente. En la
    // tabla vieja el id del expediente ERA el de la cuenta, así que la lista sigue en pie
    // aunque la migración no se haya aplicado — que es lo que hace esta rama independiente
    // del orden de despliegue.
    const filas = filasDeExpediente(
      [{ id: "p-1", full_name: null, phone: "956" }], // sin `profile_id`: tabla vieja
      [{ id: "p-1", full_name: "Ana" }],
      [],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: "p-1", profile_id: "p-1", full_name: "Ana", phone: "956" });
    // Y las columnas que aún no existen no se inventan: llegan nulas.
    expect(filas[0].date_left).toBeNull();
    expect(filas[0].ringcentral_ext).toBeNull();
  });

  it("quien no tiene expediente todavía aparece igual, y una sola vez", () => {
    const filas = filasDeExpediente(
      [{ id: "f-1", profile_id: "p-1", full_name: "Ana" }],
      [{ id: "p-1", full_name: "Ana" }, { id: "p-2", full_name: "Beto" }],
      [],
    );
    expect(filas.map((f) => f.full_name)).toEqual(["Ana", "Beto"]);
    expect(filas.filter((f) => f.profile_id === "p-1")).toHaveLength(1);
  });

  it("un expediente cuya cuenta se borró no desaparece", () => {
    // `on delete set null`: la cuenta se va, el expediente se queda. Si esto devolviera
    // cero filas, la migración no habría servido de nada.
    const filas = filasDeExpediente([{ id: "f-1", profile_id: null, full_name: "Ex Empleado" }], [], []);
    expect(filas).toHaveLength(1);
    expect(filas[0].full_name).toBe("Ex Empleado");
  });
});
