import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { faltaLaColumnaDeTienda } from "./fichaje-en-tienda";
import { DEMO_EMPLOYEES, DEMO_TIENDAS } from "./demo-data";

// Cableado de la tienda del fichaje (2026-11-25): el servidor valida, el fichaje la manda, Nómina la muestra y
// la migración 350 queda sin aplicar con su registro. Las anclas son texto de código.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");

describe("faltaLaColumnaDeTienda: la señal de «350 sin aplicar»", () => {
  it("42703 o PGRST204 nombrando work_store_id es que falta la columna", () => {
    expect(faltaLaColumnaDeTienda({ code: "42703", message: 'column "work_store_id" of relation "time_entries" does not exist' })).toBe(true);
    expect(faltaLaColumnaDeTienda({ code: "PGRST204", message: "Could not find the 'work_store_id' column of 'time_entries' in the schema cache" })).toBe(true);
  });
  it("otra columna, otro error o ningún error no cuentan", () => {
    expect(faltaLaColumnaDeTienda({ code: "42703", message: 'column "morning_priority" does not exist' })).toBe(false);
    expect(faltaLaColumnaDeTienda({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(faltaLaColumnaDeTienda(null)).toBe(false);
    expect(faltaLaColumnaDeTienda(undefined)).toBe(false);
  });
});

describe("servidor: clockIn valida y guarda la tienda", () => {
  // El cuerpo del fichaje se movió a fichaje-interno.ts (las acciones públicas son envoltorios de él): se lee junto.
  const clock = leer("src/app/timetracker/clock-in/actions/clock.ts") + "\n" + leer("src/lib/clockin/fichaje-interno.ts");

  it("clockIn acepta storeId y lo valida con validarTiendaDelFichaje, por la regla de quien va en varias", () => {
    expect(clock).toContain("storeId?: string | null;");
    expect(clock).toContain("const multiStore = esMultiTienda({");
    expect(clock).toContain("validarTiendaDelFichaje({");
    expect(clock).toContain('.schema("timetracker")\n    .from("employee_settings")\n    .select("worker_type, multi_store")');
    expect(clock).toContain('.from("job_sites")');
    expect(clock).toContain('.eq("active", true);');
  });
  it("sin tienda mandada y sin la columna, no se exige tienda (350 sin aplicar)", () => {
    expect(clock).toContain("if (multiStore && (input.storeId || (await existeLaColumnaDeTienda(supabase)))) {");
  });
  it("el fichaje guarda work_store_id solo si hay tienda, y reintenta sin la columna si la base no la tiene", () => {
    expect(clock).toContain("const conTiendaGuardada = tiendaDelFichaje ? { ...fichaje, work_store_id: tiendaDelFichaje } : fichaje;");
    expect(clock).toContain("if (faltaLaColumnaDeTienda(error)) {");
    expect(clock).toContain('({ data: entry, error } = await supabase.from("time_entries").insert(fichaje).select("id, clock_in_at").single());');
  });
  it("«en otro sitio» se mide contra la tienda elegida, no contra una casa que no tiene", () => {
    expect(clock).toContain("const homeBound = !!tiendaDeCasa;");
    expect(clock).toContain("const atWrongSite = homeBound && !!siteId && siteId !== tiendaDeCasa;");
  });
  it("la geocerca no cambia: el veredicto sigue en clock_in_site_id, y la tienda no se escribe ahí", () => {
    expect(clock).toContain("clock_in_site_id: siteId ?? null,");
    expect(clock).not.toMatch(/clock_in_site_id:\s*tiendaDelFichaje/);
  });
  it("getMyDay devuelve la tienda del fichaje y si la columna existe", () => {
    expect(clock).toContain("tiendaDisponible: boolean;");
    expect(clock).toContain("tiendaId: abierto.work_store_id ?? null");
    expect(clock).toContain("tienda: nombreDeTienda(e.work_store_id),");
  });
});

describe("pantalla: el fichaje con selector de tienda", () => {
  const punch = leer("src/components/timetracker/PunchPanel.tsx");

  it("el selector va arriba de Entrada, solo para quien va en varias y con la columna", () => {
    expect(punch).toContain("const conTienda = multiTienda && d.tiendaDisponible;");
    expect(punch).toContain("{conTienda && !dentro && (");
    expect(punch).toContain('<label>{t("emp.punch.storeLabel")}</label>');
    expect(punch).toContain("disabled={!!ocupado || (!!conTienda && !tiendaValida)} onClick={hacer.entrar}");
  });
  it("la tienda elegida se recuerda por persona y fecha, con las mismas claves que el cronómetro", () => {
    expect(punch).toContain("tiendaDelDiaDesde(localStorage.getItem(claveTiendaDelDia(me.id)), dateISO(new Date()))");
    expect(punch).toContain("localStorage.setItem(claveTiendaDelDia(me.id), valorTiendaDelDia(dateISO(new Date()), tiendaValida))");
  });
  it("la tienda viaja a clockIn como storeId", () => {
    expect(punch).toContain("const storeId = multiTienda && d?.tiendaDisponible ? tiendaValida : undefined;");
    expect(punch).toContain("reasons: razones, note: nota || undefined, storeId });");
  });
  it("los errores de tienda del servidor se muestran traducidos", () => {
    expect(punch).toContain('if (res.code === "tienda_requerida") setErr(t("emp.punch.storeRequired"));');
    expect(punch).toContain('else if (res.code === "tienda_no_permitida") setErr(t("emp.punch.storeNotAllowed"));');
  });
  it("«Store: …» y «Cambiar tienda» aparecen cuando ya se ficha", () => {
    expect(punch).toContain("{conTienda && dentro && (");
    expect(punch).toContain('t("emp.punch.storeNow", { store: d.open.tienda })');
    expect(punch).toContain('t("emp.punch.changeStore")');
  });
  it("«Cambiar tienda» es salida + entrada: la tienda nueva se elige al volver a fichar, y la salida va por clockOut", () => {
    expect(punch).toContain('tiendaPendienteDeCambio.current = tiendaNueva; setCambiando(false); pide("out");');
    expect(punch).toContain("const siguiente = tiendaPendienteDeCambio.current;");
    expect(punch).toContain("setTiendaElegida(siguiente);");
    // No hay una llamada que reescriba la tienda de un fichaje abierto: solo clockOut y clockIn.
    expect(punch).not.toMatch(/updateTienda|setStore|work_store_id:/);
  });
  it("la entrada desde el menú del admin también exige tienda", () => {
    expect(punch).toContain('(a === "entrar" && conTienda && !tiendaValida) ? t("emp.punch.storeRequired")');
  });
});

describe("Nómina: la tienda de cada fichaje y el filtro", () => {
  const tabs = leer("src/components/timetracker/PayrollTabs.tsx");
  const tiempos = leer("src/components/timetracker/PayrollTimesheets.tsx");
  const hoja = leer("src/components/timetracker/HojaSemanal.tsx");

  it("el filtro de tienda deja pasar a quien tiene un fichaje del periodo en esa tienda", () => {
    // 2026-11-25 (main, filtro múltiple): la regla vive en pasaFiltroDeNomina; PayrollTabs le pasa sus tiendas de fichaje.
    expect(tabs).toContain("pasaFiltroDeNomina(p, filtro.tiendas, filtro.empleados, tiendasDeLaPersonaEnElPeriodo(datos.entries, p.id))");
  });
  it("la tabla enseña la tienda junto al fichaje, y la hoja la pone en la cabecera de la semana", () => {
    expect(tiempos).toContain("{e.work_store_id && tiendaNombre.get(e.work_store_id) ? (");
    expect(tiempos).toContain("tiendas: nombresDeTiendas(tiendasDeLaPersonaEnElPeriodo(");
    expect(hoja).toContain('{t("hoja.stores")}: {b.tiendas.join(" · ")}');
  });
  it("el periodo de Nómina trae work_store_id, y sin la columna se lee como antes", () => {
    const rep = leer("src/app/timetracker/clock-in/actions/reports.ts");
    expect(rep).toContain("edit_note, work_store_id\"),");
    expect(rep).toContain("faltaLaColumnaDeTienda(errorFichajes)");
  });
});

describe("demo: Carla va en varias tiendas", () => {
  it("Carla es presencial con multiStore, y las tiendas de la demo existen", () => {
    const carla = DEMO_EMPLOYEES.find((e) => e.id === "u-carla");
    expect(carla?.workerType).toBe("inhouse");
    expect(carla?.multiStore).toBe(true);
    expect(DEMO_TIENDAS.map((t) => t.id)).toEqual(["s-mcallen", "s-pharr", "s-edinburg"]);
  });
  it("la demo deja elegir persona por NEXT_PUBLIC_TT_DEMO_PERSONA, y por defecto sigue el admin", () => {
    const layout = leer("src/app/timetracker/(timetracker)/layout.tsx");
    expect(layout).toContain("const PERSONA_DE_LA_DEMO = DEMO_EMPLOYEES.find((e) => e.id === process.env.NEXT_PUBLIC_TT_DEMO_PERSONA) ?? ADMIN_DEMO;");
    expect(layout).toContain("<DemoDataProvider me={PERSONA_DE_LA_DEMO}>");
  });
});

describe("migración 350: sin aplicar, con su registro", () => {
  const texto = leer("supabase/migrations/350_tienda_del_fichaje.sql");

  it("añade work_store_id como FK a job_sites, con ON DELETE SET NULL y de forma idempotente", () => {
    expect(texto).toContain("alter table clockin.time_entries\n  add column if not exists work_store_id uuid references clockin.job_sites(id) on delete set null;");
  });
  it("la política de INSERT es restrictiva y pide multi_store y tienda activa de la empresa", () => {
    expect(texto).toContain("as restrictive for insert to public");
    expect(texto).toContain("and e.multi_store");
    expect(texto).toContain("and j.active");
  });
  it("el disparador impide al empleado cambiar la tienda de un fichaje existente", () => {
    expect(texto).toContain("create trigger time_entries_guard_tienda");
    expect(texto).toContain("Only a manager can change the store of a punch");
  });
  it("no reescribe funciones existentes (solo añade la suya)", () => {
    const creadas = [...texto.matchAll(/create or replace function ([\w.]+)/g)].map((m) => m[1]);
    expect(creadas).toEqual(["clockin.guard_time_entries_tienda"]);
  });
  it("el registro del final coincide con el checksum del contenido (como migrate-status --sum)", () => {
    const cuerpo = texto.split("-- @ledger-below")[0];
    const sum = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(texto).toContain(`values ('350_tienda_del_fichaje.sql', '${sum}')`);
  });
});
