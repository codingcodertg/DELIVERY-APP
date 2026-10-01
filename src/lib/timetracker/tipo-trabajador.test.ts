import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TipoDeTrabajadorCampo } from "@/components/TipoDeTrabajadorCampo";
import {
  TIPOS_DE_TRABAJADOR, esTipoDeTrabajador, estadoDeFicha, planDeTipo, puedeEscribirTipo, tipoPorDefecto,
  type MitadTimeTracker,
} from "./tipo-trabajador";

// D-455. El dueño fue a Usuarios a poner a Everto Prado como presencial y la opción no estaba.
// Estas pruebas vigilan tres cosas: QUÉ se escribe al elegir el tipo, QUÉ se le dice al admin de
// una persona a la que nadie configuró (la ficha renderizada, no solo la función), y que la
// pantalla y la acción USAN esa lógica (lectura de fuente, como el resto del repo).

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");

const mitad = (p: Partial<MitadTimeTracker> = {}): MitadTimeTracker => ({
  legible: true, tieneFila: true, workerType: "inhouse", active: true, defecto: "remote", ...p,
});
const SIN_FILA = mitad({ tieneFila: false, workerType: null, active: false });

const en = (a: string) => a;
const es = (_a: string, b: string) => b;
const pinta = (tt: MitadTimeTracker, fichaje: { active: boolean } | null, t = es) =>
  renderToStaticMarkup(createElement(TipoDeTrabajadorCampo, { tt, fichaje, busy: false, t, onElegir: () => {}, onActivar: () => {} }));

describe("qué se escribe al elegir el tipo de trabajador", () => {
  it("sin fila: se crea con el tipo y ACTIVA", () => {
    expect(planDeTipo("u1", false, "inhouse")).toEqual({ op: "insert", fila: { id: "u1", worker_type: "inhouse", active: true } });
  });
  it("con fila: cambia solo el tipo y no toca si está activa", () => {
    const plan = planDeTipo("u1", true, "remote");
    expect(plan).toEqual({ op: "update", cambio: { worker_type: "remote" } });
    expect(JSON.stringify(plan)).not.toContain("active");
  });
  it("solo existen presencial y remoto, y presencial va primero", () => {
    expect(TIPOS_DE_TRABAJADOR).toEqual(["inhouse", "remote"]);
    expect(esTipoDeTrabajador("inhouse")).toBe(true);
    expect(esTipoDeTrabajador("remote")).toBe(true);
    for (const malo of ["", "onsite", null, undefined, 1]) expect(esTipoDeTrabajador(malo), String(malo)).toBe(false);
  });
});

describe("quién puede escribirlo", () => {
  it("solo un admin de Time Tracker: ni gerente de tienda, ni empleado, ni sin rol", () => {
    expect(puedeEscribirTipo("admin")).toBe(true);
    for (const r of ["manager", "employee", null, undefined, ""]) expect(puedeEscribirTipo(r), String(r)).toBe(false);
  });
  it("y eso es lo que dice la política de la base (058/060)", () => {
    const acceso = leer("supabase/migrations/058_timetracker_access.sql");
    expect(acceso).toContain("create or replace function public.is_timetracker_admin()");
    expect(acceso).toContain("select coalesce((select timetracker_role = 'admin' from public.profiles where id = auth.uid()), false);");
    const rls = leer("supabase/migrations/060_timetracker_rls.sql");
    expect(rls).toContain("for insert to authenticated with check (id = auth.uid() or public.is_timetracker_admin());");
    expect(rls).toContain("for update to authenticated using (public.is_timetracker_admin() or id = auth.uid());");
  });
});

describe("lo que la ficha sabe decir de las dos mitades", () => {
  it("sin fila: cuenta como el defecto, nadie lo eligió, y está sin configurar", () => {
    expect(estadoDeFicha(SIN_FILA, { active: true })).toEqual({ tipo: "remote", elegido: false, timeTracker: "sin_fila", fichaje: "activo" });
  });
  it("el defecto es el del ajuste: con defecto presencial, sin fila cuenta como presencial", () => {
    expect(estadoDeFicha({ ...SIN_FILA, defecto: "inhouse" }, null).tipo).toBe("inhouse");
  });
  it("el defecto que no se pudo leer es remoto, como en la app", () => {
    expect(tipoPorDefecto("inhouse")).toBe("inhouse");
    for (const v of ["remote", undefined, null, "", "otro"]) expect(tipoPorDefecto(v), String(v)).toBe("remote");
  });
  it("con fila y tipo elegido: manda el elegido, no el defecto", () => {
    expect(estadoDeFicha(mitad({ workerType: "inhouse", defecto: "remote" }), { active: true })).toMatchObject({ tipo: "inhouse", elegido: true, timeTracker: "activo" });
  });
  it("con fila pero apagada: «apagado», que no es lo mismo que sin configurar", () => {
    expect(estadoDeFicha(mitad({ active: false }), { active: true }).timeTracker).toBe("apagado");
  });
  it("quien no es admin de Time Tracker no afirma nada: «ilegible», aunque la respuesta diga que no hay fila", () => {
    expect(estadoDeFicha({ ...SIN_FILA, legible: false }, { active: true }).timeTracker).toBe("ilegible");
  });
  it("la mitad de fichaje: contando, detenida o sin ficha", () => {
    expect(estadoDeFicha(mitad(), { active: true }).fichaje).toBe("activo");
    expect(estadoDeFicha(mitad(), { active: false }).fichaje).toBe("detenido");
    expect(estadoDeFicha(mitad(), null).fichaje).toBe("sin_fila");
  });
});

describe("lo que VE un admin en la ficha (el campo renderizado)", () => {
  it("persona sin fila: dice que cuenta como Remoto, que sale Inactiva en People y cómo se arregla", () => {
    const html = pinta(SIN_FILA, { active: true });
    expect(html).toContain("Tipo de trabajador");
    expect(html).toContain("Sin elegir — cuenta como Remoto, el valor por defecto");
    expect(html).toContain("sale como Inactiva en Time Tracker › People y cuenta como Remoto");
    expect(html).toContain("Elige el tipo arriba");
    expect(html).toContain("inactivo");
    expect(html).toContain('data-tt="sin_fila"');
  });
  it("ofrece Presencial y Remoto, por ese orden", () => {
    const html = pinta(SIN_FILA, null);
    const presencial = html.indexOf('<option value="inhouse">Presencial (trabaja en la tienda)</option>');
    const remoto = html.indexOf('<option value="remote">Remoto</option>');
    expect(presencial).toBeGreaterThan(-1);
    expect(remoto).toBeGreaterThan(presencial);
  });
  it("la frase que explica la diferencia, en los dos idiomas", () => {
    expect(pinta(mitad(), null)).toContain("El presencial ficha entrada y salida en la tienda, con foto y ubicación. El remoto usa el cronómetro, con capturas de pantalla.");
    expect(pinta(mitad(), null, en)).toContain("In-house clocks in and out at the store, with a photo and their location. Remote uses the timer, with screenshots.");
  });
  it("presencial ya configurado y activo: sin avisos, y «sin elegir» ya no es una opción", () => {
    const html = pinta(mitad({ workerType: "inhouse" }), { active: true });
    expect(html).not.toContain("⚠");
    expect(html).not.toContain("Sin elegir");
    expect(html).toContain('<option value="inhouse" selected="">');
    expect(html).toContain("activo");
    expect(html).toContain("contando tiempo");
  });
  it("con fila apagada: lo dice y ofrece Activar; no pide elegir el tipo", () => {
    const html = pinta(mitad({ active: false }), { active: true });
    expect(html).toContain("Sale como Inactiva en Time Tracker › People.");
    expect(html).toContain(">Activar</button>");
    expect(html).not.toContain("Elige el tipo arriba");
  });
  it("activa: no hay botón de Activar", () => {
    expect(pinta(mitad(), { active: true })).not.toContain(">Activar</button>");
  });
  it("quien no es admin de Time Tracker: se le dice quién puede, y no hay selector que vaya a fallar", () => {
    const html = pinta({ ...SIN_FILA, legible: false }, { active: true });
    expect(html).toContain("Solo un admin de Time Tracker puede ver y cambiar el tipo de trabajador.");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Nadie ha configurado");
  });
  it("el fichaje detenido y la falta de ficha de fichaje se dicen con su nombre", () => {
    expect(pinta(mitad(), { active: false })).toContain("detenido");
    expect(pinta(mitad(), null)).toContain("sin ficha");
  });
});

describe("la ficha de Usuarios usa todo esto (lectura de fuente)", () => {
  const ficha = leer("src/components/ClockinSettings.tsx");
  const acciones = leer("src/app/timetracker/clock-in/actions/team.ts");

  it("el campo se pinta con lo leído de las DOS mitades y guarda con la acción nueva", () => {
    expect(ficha).toContain("tt={data.timetracker}");
    expect(ficha).toContain("fichaje={s ? { active: s.active } : null}");
    expect(ficha).toContain("onElegir={(tipo) => run(() => setEmployeeWorkerType(userId, tipo))}");
    expect(ficha).toContain("onActivar={() => run(() => activateInTimeTracker(userId))}");
  });
  it("sale AUNQUE no haya ficha de fichaje: se pinta dentro del `if (!s)`, antes del aviso", () => {
    const sinFicha = ficha.slice(ficha.indexOf("if (!s) {"), ficha.indexOf("const label ="));
    expect(sinFicha).toContain("{tipoDeTrabajador}");
    expect(sinFicha.indexOf("{tipoDeTrabajador}")).toBeLessThan(sinFicha.indexOf("Todavía no tiene ficha de fichaje en tienda"));
  });
  it("y es el PRIMER campo de la ficha completa, antes del puesto", () => {
    const completa = ficha.slice(ficha.indexOf("const label ="));
    expect(completa.indexOf("{tipoDeTrabajador}")).toBeGreaterThan(-1);
    expect(completa.indexOf("{tipoDeTrabajador}")).toBeLessThan(completa.indexOf('t("Job position", "Puesto")'));
  });
  it("la casilla Runner dice lo que es: Visitas y mandados (con fotos), con su ayuda", () => {
    expect(ficha).toContain('t("Field visits & errands (with photos)", "Visitas y mandados (con fotos)")');
    expect(ficha).toContain("Registra cada parada con foto y ubicación; con vehículo de la empresa (odómetro) o en su propio vehículo («viaje personal»).");
    expect(ficha).not.toContain('t("Runner", "Repartidor")');
    // Sigue escribiendo la misma columna con la misma acción: solo cambió el rótulo.
    expect(ficha).toContain("run(() => setEmployeeRunner(userId, e.target.checked))");
  });
  it("el vehículo es opcional y lo dice: sin vehículo asignado = usa el suyo", () => {
    expect(ficha).toContain('t("Company vehicle (optional)", "Vehículo de la empresa (opcional)")');
    expect(ficha).toContain('t("No vehicle assigned = uses their own", "Sin vehículo asignado = usa el suyo")');
  });

  const cuerpo = (nombre: string) => {
    const desde = acciones.indexOf(`export async function ${nombre}(`);
    expect(desde, `no existe ${nombre}`).toBeGreaterThan(-1);
    const hasta = acciones.indexOf("\nexport async function ", desde + 1);
    return acciones.slice(desde, hasta === -1 ? undefined : hasta);
  };

  it("setEmployeeWorkerType: mismo managerCtx, valida el tipo y comprueba el rol ANTES de escribir", () => {
    const c = cuerpo("setEmployeeWorkerType");
    expect(c).toContain("const ctx = await managerCtx();");
    expect(c).toContain("if (!esTipoDeTrabajador(workerType))");
    const rol = c.indexOf("if (!puedeEscribirTipo(await miRolDeTimeTracker(ctx))) return { ok: false as const, message: SOLO_ADMIN_TT };");
    expect(rol).toBeGreaterThan(-1);
    expect(rol).toBeLessThan(c.indexOf(".insert("));
    expect(rol).toBeLessThan(c.indexOf(".update("));
  });
  it("setEmployeeWorkerType: escribe lo que diga planDeTipo, en timetracker.employee_settings", () => {
    const c = cuerpo("setEmployeeWorkerType");
    expect(c).toContain('ctx.supabase.schema("timetracker").from("employee_settings")');
    expect(c).toContain("const plan = planDeTipo(id, !!fila, workerType);");
    expect(c).toContain("tabla().insert(plan.fila)");
    expect(c).toContain("tabla().update(plan.cambio)");
  });
  it("setEmployeeWorkerType: pide la fila de vuelta — un UPDATE filtrado por RLS no pasa por guardado", () => {
    const c = cuerpo("setEmployeeWorkerType");
    expect(c).toContain('.update(plan.cambio).eq("id", id).select("id").maybeSingle()');
    expect(c).toContain("if (!hecho) return { ok: false as const, message: SOLO_ADMIN_TT };");
  });
  it("activateInTimeTracker: solo activa, comprueba el rol, y no inventa una fila sin tipo", () => {
    const c = cuerpo("activateInTimeTracker");
    expect(c).toContain("if (!puedeEscribirTipo(await miRolDeTimeTracker(ctx))) return { ok: false as const, message: SOLO_ADMIN_TT };");
    expect(c).toContain(".update({ active: true })");
    expect(c).not.toContain(".insert(");
    expect(c).not.toContain(".upsert(");
    expect(c).toContain("if (!hecho) return { ok: false as const, message: SIN_FILA_TT };");
  });
  it("la lectura trae la mitad de Time Tracker: fila, tipo, activa, el defecto del ajuste y si es legible", () => {
    const desde = acciones.indexOf("async function mitadTimeTracker(");
    const c = acciones.slice(desde, acciones.indexOf("\n}\n", desde));
    expect(c).toContain('ctx.supabase.schema("timetracker").from("employee_settings").select("worker_type, active").eq("id", id).maybeSingle()');
    expect(c).toContain('ctx.supabase.schema("timetracker").from("settings").select("data").eq("id", "app").maybeSingle()');
    expect(c).toContain("legible: puedeEscribirTipo(rol),");
    expect(c).toContain("tieneFila: !!fila,");
    expect(c).toContain("active: fila?.active === true,");
    expect(c).toContain("defecto: tipoPorDefecto(");
    expect(cuerpo("getClockinEmployeeSettings")).toContain("mitadTimeTracker(ctx, id),");
  });
  it("no se toca el defecto global ni a quien ya está configurado: ninguna acción escribe settings ni upsert", () => {
    expect(acciones).not.toContain('from("settings").update');
    expect(acciones).not.toContain('from("settings").upsert');
    expect(acciones).not.toContain(".upsert(");
  });
});
