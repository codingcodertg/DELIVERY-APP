import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLUMNAS_159, ETIQUETAS_CAMPO, MOTIVOS_BAJA, camposQueFaltan, casillaQuitarAcceso, cuentaIncompletos,
  cuentaPorEstado, esColumnaQueFalta, etiquetaMotivoBaja, filaNueva, filasDeExpediente, filtraPorEstado,
  hoyLocalISO, normalizaMotivoBaja, parcheAltaCompleto, parcheBajaCompleto, puedeDarDeBaja, saleEnDirectorio,
  sin159, telefonoDeFicha, tiene159,
} from "./employee-file";

// Los botones del expediente (dar de baja, reactivar, agregar, editar), los campos de la 159 y el
// «expediente incompleto». Dos clases de prueba, como en `employee-file.test.ts`: las que corren la
// función, y las que leen la fuente para comprobar que la pantalla y las acciones LA USAN — una regla
// bien escrita que nadie llama no arregla nada.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
const pagina = leer("src/app/recruiting/(recruiting)/employees/page.tsx");
const ventanas = leer("src/app/recruiting/(recruiting)/employees/acciones.tsx");
const acciones = sinComentarios(leer("src/app/recruiting/actions/hr.ts"));
const sql = leer("supabase/migrations/159_expediente_campos.sql");
const directorio = leer("supabase/migrations/117_phone_book_store_ext.sql");

/** El cuerpo de una acción de servidor, de su `export` al siguiente. */
const accion = (nombre: string) => {
  const desde = acciones.indexOf(`export async function ${nombre}(`);
  expect(desde).toBeGreaterThan(-1);
  const resto = acciones.slice(desde + 10);
  const hasta = resto.search(/\nexport (async )?function |\nasync function /);
  return resto.slice(0, hasta < 0 ? undefined : hasta);
};

const base = (extra: Record<string, unknown> = {}) => ({
  date_hired: "2024-01-10", date_left: null as string | null, department: "Ventas", store: "Tienda A",
  directory_group: null as string | null, account_store: null as string | null,
  job_title: "Vendedor", personal_phone: "956-555-0101", emergency_name: "Luz", emergency_phone: "956-555-0102",
  left_reason: null as string | null, ...extra,
});

describe("el filtro Activos / Bajas / Todos y sus contadores", () => {
  const filas = [{ id: 1, date_left: null }, { id: 2, date_left: "2026-10-01" }, { id: 3, date_left: "" }];

  it("cuenta activos, bajas y todos a partir de la fecha de salida", () => {
    expect(cuentaPorEstado(filas)).toEqual({ activos: 2, bajas: 1, todos: 3 });
    expect(cuentaPorEstado([])).toEqual({ activos: 0, bajas: 0, todos: 0 });
  });

  it("cada filtro deja pasar solo a los suyos, y «todos» a todos", () => {
    expect(filtraPorEstado(filas, "activos").map((f) => f.id)).toEqual([1, 3]);
    expect(filtraPorEstado(filas, "bajas").map((f) => f.id)).toEqual([2]);
    expect(filtraPorEstado(filas, "todos").map((f) => f.id)).toEqual([1, 2, 3]);
  });

  it("la pantalla filtra y cuenta con esas dos funciones, arranca en Activos y pinta el contador en cada chip", () => {
    expect(pagina).toContain("const cuenta = cuentaPorEstado(rows);");
    expect(pagina).toContain("const delEstado = filtraPorEstado(rows, estado);");
    expect(pagina).toContain('useState<FiltroEstado>("activos")');
    expect(pagina).toContain("{t(e.en, e.es)} · {cuenta[e.key]}");
    for (const k of ["activos", "bajas", "todos"]) expect(pagina).toContain(`{ key: "${k}"`);
    // Lo que se pinta sale de la lista ya filtrada por estado, no de `rows`.
    expect(pagina).toMatch(/const visibles = delEstado\s*\.filter/);
  });
});

describe("dar de baja: fecha, motivo de una lista corta, nota y quién", () => {
  it("el parche lleva fecha, motivo, nota, quién la registró y cuándo", () => {
    const p = parcheBajaCompleto({
      fecha: "2026-10-01", motivo: "termination", nota: "  no volvió  ", quien: "u-1", ahora: new Date("2026-10-01T15:00:00Z"),
    });
    expect(p).toEqual({
      date_left: "2026-10-01", left_reason: "termination", left_note: "no volvió", left_by: "u-1",
      left_recorded_at: "2026-10-01T15:00:00.000Z",
    });
  });

  it("sin motivo o sin nota se guardan null, no cadenas vacías (el check de la base no admite '')", () => {
    const p = parcheBajaCompleto({ fecha: "2026-10-01", motivo: "", nota: "   ", quien: "u-1" });
    expect(p.left_reason).toBeNull();
    expect(p.left_note).toBeNull();
  });

  it("un motivo que no está en la lista se rechaza (undefined), y vacío es «sin motivo» (null)", () => {
    expect(normalizaMotivoBaja("resignation")).toBe("resignation");
    expect(normalizaMotivoBaja(" other ")).toBe("other");
    expect(normalizaMotivoBaja("")).toBeNull();
    expect(normalizaMotivoBaja(null)).toBeNull();
    expect(normalizaMotivoBaja("fired")).toBeUndefined();
  });

  it("la lista de motivos es la misma que el check de la migración 159, y cada uno tiene etiqueta en los dos idiomas", () => {
    const check = /check \(left_reason in \(([^)]+)\)\)/.exec(sql)![1];
    const delSql = check.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(delSql).toEqual(MOTIVOS_BAJA.map((m) => m.key));
    expect(etiquetaMotivoBaja("termination", "es")).toBe("Despido");
    expect(etiquetaMotivoBaja("termination", "en")).toBe("Terminated");
    expect(etiquetaMotivoBaja("nada", "es")).toBe("");
  });

  it("la fecha por defecto es HOY en hora local, no el día UTC", () => {
    // Las 19:30 del 1 de octubre en Texas ya son el 2 de octubre en UTC.
    const tarde = new Date(2026, 9, 1, 19, 30);
    expect(hoyLocalISO(tarde)).toBe("2026-10-01");
    expect(hoyLocalISO(new Date(2026, 0, 5, 8, 0))).toBe("2026-01-05");
  });

  it("la ventana de baja pide fecha (hoy por defecto), motivo de la lista y nota, y llama a la acción con los cuatro datos", () => {
    expect(ventanas).toContain("useState(persona.date_left || hoyLocalISO())");
    expect(ventanas).toContain("{MOTIVOS_BAJA.map((m) => <option key={m.key} value={m.key}>{m[lang]}</option>)}");
    expect(ventanas).toContain(
      "deactivateEmployee(persona.id, { fecha, motivo: con159 ? motivo : null, nota: con159 ? nota : null, quitarAcceso })",
    );
    // Con la 159 el botón de confirmar no se enciende sin motivo.
    expect(ventanas).toContain("const listo = !!fecha && (!con159 || !!motivo);");
    expect(ventanas).toContain("disabled={busy || !listo}");
  });

  it("la acción de baja escribe el parche completo, y sin la 159 guarda la fecha sola y lo dice", () => {
    const cuerpo = accion("deactivateEmployee");
    expect(cuerpo).toContain("parcheBajaCompleto({ fecha: datos.fecha, motivo: datos.motivo, nota: datos.nota, quien: userId })");
    expect(cuerpo).toContain("if (error && esColumnaQueFalta(error)) {");
    expect(cuerpo).toContain("sinMotivo = true;");
    expect(cuerpo).toContain("parcheBaja(datos.fecha)");
    expect(cuerpo).toContain('if (normalizaMotivoBaja(datos.motivo) === undefined) return { ok: false');
  });

  it("los botones «Dar de baja» y «Reactivar» están en la lista Y en la ficha, y solo los enciende el admin de RR. HH.", () => {
    expect(puedeDarDeBaja("admin")).toBe(true);
    expect(puedeDarDeBaja("manager")).toBe(false);
    expect(puedeDarDeBaja("recruiter")).toBe(false);
    expect(puedeDarDeBaja(null)).toBe(false);
    expect(pagina).toContain("const puedeBaja = puedeDarDeBaja(me?.role);");
    // Dos de cada uno: la fila de la tabla y la cabecera de la ficha.
    expect(pagina.split('data-accion="baja"').length - 1).toBe(2);
    expect(pagina.split('data-accion="reactivar"').length - 1).toBe(2);
    expect(pagina.split("disabled={!puedeBaja}").length - 1).toBeGreaterThanOrEqual(4);
    expect(pagina).toContain("onClick={() => setBaja(r.id)}");
    expect(pagina).toContain("onClick={() => setReactivar(r.id)}");
    expect(pagina).toContain("<BajaDialog");
    expect(pagina).toContain("<ReactivarDialog");
    // Y la barrera de verdad, en el servidor, con la misma regla.
    expect(acciones).toContain("if (!puedeDarDeBaja(yo.role)) return { ok: false");
  });

  it("la baja no entra por «Guardar datos»: tiene su botón", () => {
    const cuerpo = accion("saveEmployeeFile");
    expect(cuerpo).toContain("if (SOLO_POR_SU_BOTON.some((k) => k in patch)) {");
    expect(acciones).toMatch(/const SOLO_POR_SU_BOTON = \["date_left", "left_reason", "left_note", "left_by"/);
  });
});

describe("«Quitar también el acceso al hub» y «Reactivar no lo devuelve»", () => {
  it("la casilla sale marcada si tiene cuenta, no existe si no la tiene, y al corregir una baja sale sin marcar", () => {
    expect(casillaQuitarAcceso({ profile_id: "p-1", date_left: null })).toEqual({ visible: true, marcada: true });
    expect(casillaQuitarAcceso({ profile_id: null, date_left: null })).toEqual({ visible: false, marcada: false });
    expect(casillaQuitarAcceso({ profile_id: "p-1", date_left: "2026-09-30" })).toEqual({ visible: true, marcada: false });
  });

  it("la ventana usa esa regla para la casilla y la enseña en la misma ventana de la baja", () => {
    expect(ventanas).toContain("const casilla = casillaQuitarAcceso(persona);");
    expect(ventanas).toContain("useState(casilla.marcada)");
    expect(ventanas).toContain("{casilla.visible ? (");
    expect(ventanas).toContain('t("Also remove hub access", "Quitar también el acceso al hub")');
  });

  it("la baja solo apaga la cuenta si la casilla va marcada", () => {
    const cuerpo = accion("deactivateEmployee");
    expect(cuerpo).toContain("if (!file.profile_id || !datos.quitarAcceso) return { ok: true, sinMotivo, accesoQuitado: false };");
    expect(cuerpo).toContain("ponAcceso(file.profile_id as string, false)");
  });

  it("se reutiliza el ban de D-251: un solo sitio toca ban_duration, y nada borra la cuenta", () => {
    expect(acciones.split("ban_duration").length - 1).toBe(1);
    expect(acciones).toContain('ban_duration: encendida ? "none" : BAN_INDEFINIDO');
    expect(acciones).not.toContain("deleteUser");
    expect(acciones).not.toContain("delete-user");
    expect(ventanas).not.toContain("delete-user");
  });

  it("reactivar NO devuelve el acceso: la acción no toca la cuenta, y la ventana lo dice", () => {
    const cuerpo = accion("reactivateEmployee");
    expect(cuerpo).not.toContain("ponAcceso");
    expect(cuerpo).not.toContain("createAdminClient");
    expect(cuerpo).toContain("parcheAltaCompleto()");
    expect(ventanas).toContain("Reactivar NO devuelve el acceso al hub.");
    expect(ventanas).toContain('"Reactivated ✓ · hub access was NOT restored", "Reactivado ✓ · el acceso al hub NO se devolvió"');
  });

  it("reactivar borra la fecha y todo lo que describía la baja", () => {
    expect(parcheAltaCompleto()).toEqual({
      date_left: null, left_reason: null, left_note: null, left_by: null, left_recorded_at: null,
    });
  });

  it("el acceso se quita o se devuelve con su propio botón en la ficha, solo el admin, y nadie se lo quita a sí mismo", () => {
    const cuerpo = accion("setHubAccess");
    expect(cuerpo).toContain("await comoAdminDeHr()");
    expect(cuerpo).toContain("if (!encendida && file.profile_id === userId) return { ok: false");
    expect(cuerpo).toContain("return ponAcceso(file.profile_id as string, encendida);");
    expect(pagina).toContain('data-accion="devolver-acceso"');
    expect(pagina).toContain('data-accion="quitar-acceso"');
    expect(pagina).toContain("onClick={() => cambiaAcceso(true)}");
    expect(pagina).toContain("onClick={() => cambiaAcceso(false)}");
    expect(pagina).toContain("const r = await setHubAccess(persona.id, encendida);");
    // El estado de la cuenta se LEE de Auth al abrir la ficha (D-251), no se guarda.
    expect(pagina).toContain("const r = await accountFactsFor([persona.profile_id]);");
    expect(pagina).toContain("const cuenta = resumenDeCuenta(persona, hechos);");
  });
});

describe("＋ Agregar empleado", () => {
  it("sin nombre no hay fila; con nombre, sin cuenta y con los teléfonos en la forma de la app", () => {
    expect(filaNueva({ full_name: "   " }, true)).toBeNull();
    expect(filaNueva({
      full_name: "  Ana   Ruiz ", date_hired: "2026-10-01", department: "Ventas", store: "", phone: "(956) 555-0123",
      ringcentral_ext: "ext 204", job_title: " Cajera ", personal_phone: "9565550199",
    }, true)).toEqual({
      full_name: "Ana Ruiz", profile_id: null, date_hired: "2026-10-01", department: "Ventas", store: null,
      phone: "956-555-0123", ringcentral_ext: "204", job_title: "Cajera", personal_phone: "956-555-0199",
    });
  });

  it("sin la 159 la fila no nombra ninguna columna nueva", () => {
    const fila = filaNueva({ full_name: "Ana", job_title: "Cajera", personal_phone: "9565550199" }, false)!;
    for (const c of COLUMNAS_159) expect(c in fila).toBe(false);
    expect(fila.full_name).toBe("Ana");
  });

  it("la acción inserta con `filaNueva`, admin y gerente, y si falta la 159 reintenta sin las columnas nuevas", () => {
    const cuerpo = accion("createEmployeeFile");
    expect(cuerpo).toContain("if (!PUEDE.includes(yo.role)) return { ok: false");
    expect(cuerpo).toContain("const fila = filaNueva(input, true);");
    expect(cuerpo).toContain("if (r.error && esColumnaQueFalta(r.error)) {");
    expect(cuerpo).toContain("insert({ ...sin159(fila), ...sello })");
  });

  it("el botón está arriba de la lista, ofrece «sin cuenta» y «con cuenta», y al agregar abre la ficha nueva", () => {
    expect(pagina).toContain('data-accion="agregar"');
    expect(pagina).toContain("onClick={() => setAgregando(true)}");
    expect(pagina).toContain("void load().then(() => setAbierto(id))");
    expect(ventanas).toContain('t("Without a hub account", "Sin cuenta del hub")');
    expect(ventanas).toContain('t("With a hub account", "Con cuenta del hub")');
    expect(ventanas).toContain("const r = await createEmployeeFile(f);");
    // Con cuenta no se crea otra puerta de cuentas: manda a Usuarios.
    expect(ventanas).toContain('href="/home/users"');
  });
});

describe("teléfonos con la forma de la app (D-432: 956-xxx-xxxx)", () => {
  it("un número de EE. UU. completo se guarda 956-xxx-xxxx, venga como venga", () => {
    expect(telefonoDeFicha("(956) 555-0123")).toBe("956-555-0123");
    expect(telefonoDeFicha("9565550123")).toBe("956-555-0123");
    expect(telefonoDeFicha("+1 956.555.0123")).toBe("956-555-0123");
    expect(telefonoDeFicha("956-555-0123")).toBe("956-555-0123");
  });

  it("lo que no es un número completo se deja como está, y vacío es null", () => {
    expect(telefonoDeFicha("555-0123")).toBe("555-0123");
    expect(telefonoDeFicha("956 555 0123 ext 12")).toBe("956 555 0123 ext 12");
    expect(telefonoDeFicha("956-555-0123 casa")).toBe("956-555-0123 casa");
    expect(telefonoDeFicha("   ")).toBeNull();
    expect(telefonoDeFicha(null)).toBeNull();
  });

  it("guardar la ficha pasa los TRES teléfonos por esa forma, y la ficha los arregla al salir del campo", () => {
    const cuerpo = accion("saveEmployeeFile");
    expect(cuerpo).toContain('for (const k of ["phone", "personal_phone", "emergency_phone"] as const) {');
    expect(cuerpo).toContain("if (patch[k] !== undefined) limpio[k] = telefonoDeFicha(patch[k]);");
    expect(pagina).toContain("setInfo((a) => ({ ...a, [k]: telefonoDeFicha(a[k]) ?? \"\" }))");
    for (const k of ["phone", "personal_phone", "emergency_phone"]) expect(pagina).toContain(`alSalirTel("${k}")`);
  });
});

describe("los campos de la 159, y la pantalla sin ella", () => {
  it("la migración añade exactamente las columnas que la app nombra, nulas, sin begin/commit y con su registro", () => {
    for (const c of COLUMNAS_159) expect(sql).toMatch(new RegExp(`add column if not exists ${c}\\s+(text|uuid|timestamptz)`));
    expect(sql.split("add column if not exists").length - 1).toBe(COLUMNAS_159.length);
    const cuerpo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(cuerpo).not.toMatch(/\b(begin|commit)\s*;/i);
    expect(cuerpo).not.toMatch(/\bnot null\b/i);
    expect(cuerpo).not.toMatch(/create policy|drop policy|\bgrant\b|\brevoke\b|create (or replace )?function|create trigger/i);
    expect(sql).toContain("left_by            uuid references public.profiles(id) on delete set null");
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain("insert into public.schema_migrations");
    expect(despues).toContain("159_expediente_campos.sql");
  });

  it("se sabe si la 159 está aplicada mirando las filas: la columna llega ausente, no null", () => {
    expect(tiene159([{ id: "a", phone: null }])).toBe(false);
    expect(tiene159([{ id: "a", personal_phone: null }])).toBe(true);
    expect(tiene159([])).toBe(false);
  });

  it("se reconoce el error de «esa columna no existe» de PostgREST y de Postgres, y no cualquier otro", () => {
    expect(esColumnaQueFalta({ code: "PGRST204", message: "Could not find the 'job_title' column of 'employee_files' in the schema cache" })).toBe(true);
    expect(esColumnaQueFalta({ code: "42703", message: 'column "left_reason" does not exist' })).toBe(true);
    expect(esColumnaQueFalta({ code: "PGRST204", message: "x" })).toBe(true);
    expect(esColumnaQueFalta({ code: "42703" })).toBe(true);
    expect(esColumnaQueFalta({ message: "Could not find the 'job_title' column of 'employee_files' in the schema cache" })).toBe(true);
    expect(esColumnaQueFalta({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
    expect(esColumnaQueFalta(null)).toBe(false);
  });

  it("`sin159` quita las diez columnas y deja lo demás", () => {
    expect(sin159({ date_left: "2026-10-01", left_reason: "other", job_title: "x", phone: "1" })).toEqual({
      date_left: "2026-10-01", phone: "1",
    });
  });

  it("la lista avisa de que falta la 159, la acción dice si la tabla la tiene, y la ficha apaga los campos nuevos", () => {
    expect(accion("listEmployeeFiles")).toContain("campos159: tiene159((files ?? []) as Record<string, unknown>[]),");
    expect(pagina).toContain("setCon159(r.campos159);");
    expect(pagina).toContain('{!cargando && !err && !con159 && (');
    expect(pagina).toContain("<input value={info[k]} disabled={!con159} data-campo159={k}");
    expect(pagina).toContain("placeholder={con159 ? extra.placeholder : faltaMigracion(t)}");
    expect(ventanas).toContain('return t("migration 159 pending", "falta la migración 159");');
    for (const c of ["job_title", "personal_phone", "personal_email", "emergency_name", "emergency_relation", "emergency_phone"]) {
      expect(pagina).toContain(`campo159("${c}"`);
    }
  });

  it("sin la 159 «Guardar datos» no manda los campos nuevos, y si aun así faltara la columna el error se entiende", () => {
    expect(pagina).toContain(
      "...(con159 ? { job_title, personal_phone, personal_email, emergency_name, emergency_relation, emergency_phone } : {}),",
    );
    expect(accion("saveEmployeeFile")).toContain("message: esColumnaQueFalta(error) ? FALTA_159 : error.message");
  });

  it("la lista trae los campos nuevos y el nombre de quien registró la baja; sin la 159 llegan en null", () => {
    const perfiles = [{ id: "p-1", full_name: "Ana Cuenta" }, { id: "adm", full_name: "La Admin" }];
    const [con] = filasDeExpediente([{
      id: "f-1", profile_id: null, full_name: "Zoe", job_title: "Chofer", personal_phone: "956-555-0101",
      emergency_name: "Luz", date_left: "2026-10-01", left_reason: "termination", left_by: "adm",
    }], perfiles, []).filter((f) => f.id === "f-1");
    expect(con.job_title).toBe("Chofer");
    expect(con.personal_phone).toBe("956-555-0101");
    expect(con.left_reason).toBe("termination");
    expect(con.left_by_name).toBe("La Admin");
    const [sin] = filasDeExpediente([{ id: "f-2", profile_id: null, full_name: "Zoe" }], perfiles, []).filter((f) => f.id === "f-2");
    expect(sin.job_title).toBeNull();
    expect(sin.left_by_name).toBeNull();
  });

  it("el nombre solo se edita en el expediente de quien no tiene cuenta", () => {
    const cuerpo = accion("saveEmployeeFile");
    expect(cuerpo).toContain('if (actual?.profile_id) return { ok: false, message: "This person has an account: change their name in Users." };');
    expect(pagina).toContain("...(puedeElegirTienda(persona) ? { store, full_name } : {}),");
  });
});

describe("expediente incompleto: qué falta, por persona, y el contador", () => {
  it("un expediente lleno no tiene nada pendiente", () => {
    expect(camposQueFaltan(base(), true)).toEqual([]);
  });

  it("dice qué falta, campo por campo", () => {
    expect(camposQueFaltan(base({ date_hired: null }), true)).toEqual(["date_hired"]);
    expect(camposQueFaltan(base({ department: " " }), true)).toEqual(["department"]);
    expect(camposQueFaltan(base({ store: null }), true)).toEqual(["store"]);
    expect(camposQueFaltan(base({ job_title: "" }), true)).toEqual(["job_title"]);
    expect(camposQueFaltan(base({ personal_phone: null }), true)).toEqual(["personal_phone"]);
    expect(camposQueFaltan(base({ emergency_name: null }), true)).toEqual(["emergency"]);
    expect(camposQueFaltan(base({ emergency_phone: null }), true)).toEqual(["emergency"]);
  });

  it("la tienda de la cuenta cuenta como tienda, y a un grupo especial del directorio no se le pide", () => {
    expect(camposQueFaltan(base({ store: null, account_store: "Tienda B" }), true)).toEqual([]);
    expect(camposQueFaltan(base({ store: null, directory_group: "remote" }), true)).toEqual([]);
  });

  it("a una baja le falta el motivo si no lo tiene; a un activo no se le pide", () => {
    expect(camposQueFaltan(base({ date_left: "2026-10-01" }), true)).toEqual(["left_reason"]);
    expect(camposQueFaltan(base({ date_left: "2026-10-01", left_reason: "other" }), true)).toEqual([]);
  });

  it("sin la 159 no se pide lo que no se puede escribir", () => {
    const vacio = base({ job_title: null, personal_phone: null, emergency_name: null, emergency_phone: null, date_left: "2026-10-01" });
    expect(camposQueFaltan(vacio, false)).toEqual([]);
    expect(camposQueFaltan(base({ date_hired: null, job_title: null }), false)).toEqual(["date_hired"]);
  });

  it("el contador cuenta personas con algo pendiente, no campos", () => {
    expect(cuentaIncompletos([base(), base({ job_title: null, personal_phone: null }), base({ date_hired: null })], true)).toBe(2);
    expect(cuentaIncompletos([base()], true)).toBe(0);
  });

  it("cada campo que puede faltar tiene nombre en los dos idiomas", () => {
    for (const k of ["date_hired", "department", "store", "job_title", "personal_phone", "emergency", "left_reason"] as const) {
      expect(ETIQUETAS_CAMPO[k].en.length).toBeGreaterThan(0);
      expect(ETIQUETAS_CAMPO[k].es.length).toBeGreaterThan(0);
    }
  });

  it("la lista pinta el indicador por persona con los nombres de lo que falta, el contador arriba y el filtro", () => {
    expect(pagina).toContain("const incompletos = cuentaIncompletos(delEstado, con159);");
    expect(pagina).toContain('{t("Incomplete files", "Expedientes incompletos")} · {incompletos}');
    expect(pagina).toContain("const sinLlenar = camposQueFaltan(r, con159);");
    expect(pagina).toContain("title={sinLlenar.map((c) => ETIQUETAS_CAMPO[c][lang]).join(\", \")}");
    expect(pagina).toContain(".filter((r) => !soloIncompletos || camposQueFaltan(r, con159).length > 0)");
    // Y dentro de la ficha, con nombres, no solo el número.
    expect(pagina).toContain("const sinLlenar = camposQueFaltan(persona, con159);");
    expect(pagina).toContain('{t("missing", "falta")} {sinLlenar.map((c) => ETIQUETAS_CAMPO[c][lang]).join(", ")}.');
  });
});

describe("el directorio telefónico (T-0054) lee estos datos", () => {
  it("sale quien está activo, con extensión y con teléfono de oficina; y se dice qué le falta a quien no", () => {
    expect(saleEnDirectorio({ date_left: null, phone: "956-555-0123", ringcentral_ext: "204" })).toEqual({ sale: true, falta: [] });
    expect(saleEnDirectorio({ date_left: "2026-10-01", phone: "956-555-0123", ringcentral_ext: "204" })).toEqual({ sale: false, falta: ["baja"] });
    expect(saleEnDirectorio({ date_left: null, phone: "956-555-0123", ringcentral_ext: " " })).toEqual({ sale: false, falta: ["ext"] });
    expect(saleEnDirectorio({ date_left: null, phone: null, ringcentral_ext: "204" })).toEqual({ sale: false, falta: ["phone"] });
    expect(saleEnDirectorio({ date_left: null, phone: "", ringcentral_ext: null })).toEqual({ sale: false, falta: ["ext", "phone"] });
  });

  it("esa regla es la del `where` de phone_book(): una baja no sale, y lo que enseña son phone y ringcentral_ext", () => {
    expect(directorio).toContain("where f.date_left is null");
    expect(directorio).toContain("and nullif(btrim(coalesce(f.ringcentral_ext, '')), '') is not null");
    expect(directorio).toContain("and nullif(btrim(coalesce(f.phone, '')), '') is not null");
    expect(directorio).toMatch(/c\.phone::text\s+as phone/);
    expect(directorio).toMatch(/c\.ringcentral_ext::text\s+as ringcentral_ext/);
  });

  it("el directorio no nombra el teléfono personal ni el contacto de emergencia, y la 159 no lo redefine", () => {
    for (const c of ["personal_phone", "personal_email", "emergency_name", "emergency_phone", "left_reason"]) {
      expect(directorio).not.toContain(c);
    }
    const cuerpo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(cuerpo).not.toMatch(/function public\.phone_book/);
    // La autocomprobación de la 159 se cae si el directorio nombrara una columna privada.
    expect(sql).toContain("raise exception '159: phone_book() nombra una columna privada del expediente';");
  });

  it("la ficha etiqueta cuál teléfono es el del directorio y dice por qué alguien no sale", () => {
    expect(pagina).toContain('t("Office phone (phone book)", "Teléfono de oficina (directorio)")');
    expect(pagina).toContain('t("Extension (phone book)", "Extensión (directorio)")');
    expect(pagina).toContain('t("Personal phone (HR only)", "Teléfono personal (solo RR. HH.)")');
    expect(pagina).toContain("const directorio = saleEnDirectorio(persona);");
    expect(pagina).toContain("directorio.falta.map((f) => PORQUE_NO_SALE[f]).join(\", \")");
    // El campo «de oficina» escribe `phone` y la extensión `ringcentral_ext`: las dos columnas que lee phone_book().
    expect(pagina).toContain('<input value={info.phone} placeholder="956-555-0123" data-campo="phone"');
    expect(pagina).toContain('<input value={info.ringcentral_ext} inputMode="numeric" data-campo="ringcentral_ext"');
  });
});
