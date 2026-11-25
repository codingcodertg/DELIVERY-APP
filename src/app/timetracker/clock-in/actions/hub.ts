"use server";

// Fichar desde el HUB de escritorio (2026-11-25). Son las únicas acciones que pasan `origen: "hub"` al cuerpo
// compartido del fichaje (src/lib/clockin/fichaje-interno.ts). Ese camino NO es accesible desde las acciones
// públicas de clock.ts: `clockIn`/`clockOut` no reciben opciones.
//
// REGLA DE SERVIDOR (fail closed): CADA acción exportada empieza con `ctxActivo()`, que vuelve a leer, para quien
// tiene la sesión, `timetracker.employee_settings` (hub_clock, active, worker_type) y decide con
// `puedeFicharDesdeElHub`. Lectura fallida, fila sin ajustes, columna que no existe (351 sin aplicar), interruptor
// apagado, inactiva o no presencial = se niega. El botón solo sale en la app de escritorio: eso es una regla de
// PANTALLA (FichajeDelHub.tsx); aquí no se puede saber desde dónde se llamó, así que el interruptor es la barrera.

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { clockInInterno, clockOutInterno } from "@/lib/clockin/fichaje-interno";
import { nombraLaColumna } from "@/lib/columnas-opcionales";
import { effWorkerType } from "@/lib/timetracker/helpers";
import { esMultiTienda, tiendasParaElegir } from "@/lib/timetracker/multitienda";
import {
  demoDelHub, puedeFicharDesdeElHub, siguienteEstado,
  type CausaDeNoActivo, type DatosDelHub, type EstadoDelHub,
} from "@/lib/timetracker/fichaje-del-hub";
import { DEMO_EMPLOYEES } from "@/lib/timetracker/demo-data";
import { corteDeCapacitacion } from "@/lib/timetracker/capacitacion-servidor";
import { endLeave, startLeave } from "./leave";
import { SITIOS } from "./demo-local";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
/** Demo (solo con modo local): la persona de la demo tiene el interruptor puesto y el estado vive en memoria. */
const DEMO_HUB = demoDelHub(LOCAL_MODE, process.env.NEXT_PUBLIC_DEMO_ESCRITORIO === "1");
const EQUIPO = "hub-desktop";

export type ResultadoDelHub =
  | { ok: true; estado: EstadoDelHub; desde: string | null }
  | {
      ok: false;
      codigo: "sesion" | "no_activo" | "estado" | "error";
      mensaje: string;
      /** Si el servidor sabe en qué estado queda la persona, lo dice: la pantalla se ajusta a eso. */
      estado?: EstadoDelHub;
      desde?: string | null;
    };

type Cliente = Awaited<ReturnType<typeof createClient>>;

type Ajustes = { tipo: string | null; multiTienda: boolean; activa: boolean; hubClock: boolean; interruptorDisponible: boolean };
type Abierto = { id: string; clockInAt: string; tiendaId: string | null };
type Lectura = {
  uid: string;
  companyId: string;
  nombre: string;
  activo: boolean;
  causa: CausaDeNoActivo | null;
  multiTienda: boolean;
  tiendas: { id: string; name: string }[];
  abierto: Abierto | null;
  pausa: { id: string; leftAt: string } | null;
  estado: EstadoDelHub;
  desde: string | null;
};

const SIN_SESION: DatosDelHub = {
  sesion: false, activo: false, estado: "fuera", desde: null, nombre: "", uid: "", multiTienda: false, tiendas: [], tiendaDeHoy: null,
};

/** ¿Falta una columna concreta? (PostgREST la nombra con 42703 o PGRST204.) */
function faltaLa(error: { code?: string; message?: string } | null | undefined, columna: string): boolean {
  return !!error && (error.code === "42703" || error.code === "PGRST204") && nombraLaColumna(error.message ?? "", columna);
}

async function leeAjustes(supabase: Cliente, uid: string): Promise<{ ok: true; ajustes: Ajustes | null } | { ok: false; mensaje: string }> {
  const tt = () => supabase.schema("timetracker").from("employee_settings");
  const con = await tt().select("worker_type, multi_store, active, hub_clock").eq("id", uid).maybeSingle();
  let fila: Record<string, unknown> | null;
  let disponible = true;
  if (con.error) {
    if (!faltaLa(con.error, "hub_clock")) return { ok: false, mensaje: con.error.message ?? "No se pudo leer la configuración." };
    disponible = false;
    const sin = await tt().select("worker_type, multi_store, active").eq("id", uid).maybeSingle();
    if (sin.error) return { ok: false, mensaje: sin.error.message ?? "No se pudo leer la configuración." };
    fila = sin.data as Record<string, unknown> | null;
  } else {
    fila = con.data as Record<string, unknown> | null;
  }
  if (!fila) return { ok: true, ajustes: null };
  const tipo = (fila.worker_type as string | null) ?? null;
  return {
    ok: true,
    ajustes: {
      tipo,
      multiTienda: esMultiTienda({ workerType: tipo, multiStore: (fila.multi_store as boolean | null) ?? false }),
      activa: fila.active === true,
      hubClock: fila.hub_clock === true,
      interruptorDisponible: disponible,
    },
  };
}

/** La entrada abierta. Sin la columna de la tienda (350 sin aplicar) se lee sin ella. */
async function leeAbierto(supabase: Cliente, uid: string): Promise<{ ok: true; abierto: Abierto | null } | { ok: false; mensaje: string }> {
  const abierta = (columnas: string) => supabase.from("time_entries").select(columnas)
    .eq("employee_id", uid).eq("status", "open").order("clock_in_at", { ascending: false }).limit(1).maybeSingle();
  let { data, error } = await abierta("id, clock_in_at, work_store_id");
  if (faltaLa(error, "work_store_id")) ({ data, error } = await abierta("id, clock_in_at"));
  if (error) return { ok: false, mensaje: error.message ?? "No se pudo leer el fichaje." };
  const f = data as { id: string; clock_in_at: string; work_store_id?: string | null } | null;
  return f ? { ok: true, abierto: { id: f.id, clockInAt: f.clock_in_at, tiendaId: f.work_store_id ?? null } } : { ok: true, abierto: null };
}

/**
 * Lee todo lo que el hub necesita de quien tiene la sesión. Un fallo de base es `ok: false`; «no hay sesión» es
 * `lectura: null`. El interruptor se decide aquí con `puedeFicharDesdeElHub` (cierra por defecto).
 */
async function leeDelHub(): Promise<{ ok: true; lectura: Lectura | null } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true, lectura: null };
  const uid = user.id;

  const { data: perfil, error: errPerfil } = await supabase.from("profiles").select("company_id, full_name").eq("id", uid).maybeSingle();
  if (errPerfil) return { ok: false, mensaje: errPerfil.message ?? "No se pudo leer el perfil." };
  if (!perfil) return { ok: true, lectura: null };
  const companyId = perfil.company_id as string;
  const nombre = (perfil.full_name as string | null) ?? "";

  const aj = await leeAjustes(supabase, uid);
  if (!aj.ok) return aj;
  const ajustes = aj.ajustes;

  const ab = await leeAbierto(supabase, uid);
  if (!ab.ok) return ab;
  const abierto = ab.abierto;

  // Un almuerzo en curso: una salida de tipo «leaving_while_clocked_in» sin regreso que empezó DENTRO de la entrada
  // abierta (la misma regla que getMyDay: una salida de un turno viejo no es un almuerzo de ahora).
  const { data: salida, error: errSalida } = await supabase
    .from("exceptions").select("id, left_at").eq("employee_id", uid).eq("type", "leaving_while_clocked_in")
    .is("returned_at", null).order("left_at", { ascending: false }).limit(1).maybeSingle();
  if (errSalida) return { ok: false, mensaje: errSalida.message ?? "No se pudo leer el almuerzo." };
  const pausa = abierto && salida && (salida.left_at as string) >= abierto.clockInAt
    ? { id: salida.id as string, leftAt: salida.left_at as string }
    : null;

  let tiendas: { id: string; name: string }[] = [];
  if (ajustes?.multiTienda) {
    const { data: sitios, error: errSitios } = await supabase.from("job_sites").select("id, name")
      .eq("company_id", companyId).eq("active", true);
    if (errSitios) return { ok: false, mensaje: errSitios.message ?? "No se pudieron leer las tiendas." };
    tiendas = tiendasParaElegir((sitios ?? []) as { id: string; name: string; active?: boolean | null }[]);
  }

  const decision = puedeFicharDesdeElHub({
    error: false,
    ajustes: ajustes ? { tipo: ajustes.tipo, activa: ajustes.activa, hubClock: ajustes.hubClock } : null,
    columnaDisponible: ajustes?.interruptorDisponible ?? false,
  });

  const estado: EstadoDelHub = !abierto ? "fuera" : pausa ? "en_break" : "en_turno";
  const desde = pausa ? pausa.leftAt : abierto ? abierto.clockInAt : null;

  return {
    ok: true,
    lectura: {
      uid, companyId, nombre,
      activo: decision.ok,
      causa: decision.ok ? null : decision.causa,
      multiTienda: !!ajustes?.multiTienda, tiendas, abierto, pausa, estado, desde,
    },
  };
}

function aDatos(l: Lectura | null): DatosDelHub {
  if (!l) return SIN_SESION;
  return {
    sesion: true, activo: l.activo, estado: l.estado, desde: l.desde, nombre: l.nombre, uid: l.uid,
    multiTienda: l.multiTienda, tiendas: l.tiendas, tiendaDeHoy: l.abierto?.tiendaId ?? null,
  };
}

type RefusalDelHub = Extract<ResultadoDelHub, { ok: false }>;
const SIN_ACTIVO: RefusalDelHub = { ok: false, codigo: "no_activo", mensaje: "Clocking in from the hub is not turned on for you." };
const SIN_SESION_RES: RefusalDelHub = { ok: false, codigo: "sesion", mensaje: "Your session expired. Sign in again." };

type CtxHub =
  | { ok: true; demo: boolean; activo: boolean; causa: CausaDeNoActivo | null; l: Lectura | null }
  | { ok: false; res: RefusalDelHub };

/**
 * La puerta de TODAS las acciones (y de la lectura). Primero la guarda de la práctica; después, en modo demo, la
 * persona de la demo; si no, la lectura real y la decisión del servidor. Si la lectura falla, `ok: false`.
 */
async function ctxActivo(): Promise<CtxHub> {
  const corte = await corteDeCapacitacion();
  if (corte) return { ok: false, res: { ok: false, codigo: "error", mensaje: corte.message } };
  if (LOCAL_MODE) {
    return DEMO_HUB
      ? { ok: true, demo: true, activo: true, causa: null, l: null }
      : { ok: true, demo: false, activo: false, causa: "sin_ajustes", l: null };
  }
  if (!isSupabaseConfigured) return { ok: false, res: SIN_SESION_RES };
  const r = await leeDelHub();
  if (!r.ok) return { ok: false, res: { ok: false, codigo: "error", mensaje: r.mensaje } };
  if (!r.lectura) return { ok: false, res: SIN_SESION_RES };
  return { ok: true, demo: false, activo: r.lectura.activo, causa: r.lectura.causa, l: r.lectura };
}

function estadoInvalido(actual: EstadoDelHub, desde: string | null): ResultadoDelHub {
  const mensaje = actual === "en_break" ? "You are on a break right now."
    : actual === "en_turno" ? "You are already on the clock."
      : "You are not on the clock.";
  return { ok: false, codigo: "estado", mensaje, estado: actual, desde };
}

// --- Demo (modo local con NEXT_PUBLIC_DEMO_ESCRITORIO=1) ------------------------

const DEMO_PERSONA = DEMO_EMPLOYEES.find((e) => e.id === "u-carla");
let demo: { estado: EstadoDelHub; desde: string | null; tiendaId: string | null } = { estado: "fuera", desde: null, tiendaId: null };

function demoDatos(): DatosDelHub {
  return {
    sesion: true, activo: true, estado: demo.estado, desde: demo.desde, nombre: DEMO_PERSONA?.fullName ?? "Demo",
    uid: DEMO_PERSONA?.id ?? "demo", multiTienda: true,
    tiendas: SITIOS.map((s) => ({ id: s.id, name: s.name })), tiendaDeHoy: demo.tiendaId,
  };
}

/** Una transición del demo. Devuelve el resultado o el error de estado, igual que el servidor real. */
function demoAccion(accion: "entrar" | "empezar_break" | "volver_del_break" | "terminar_turno", storeId?: string | null): ResultadoDelHub {
  const siguiente = siguienteEstado(demo.estado, accion);
  if (!siguiente) return estadoInvalido(demo.estado, demo.desde);
  const ahora = new Date().toISOString();
  if (accion === "entrar") demo = { estado: "en_turno", desde: ahora, tiendaId: storeId ?? demo.tiendaId };
  else if (accion === "empezar_break") demo = { ...demo, estado: "en_break", desde: ahora };
  else if (accion === "volver_del_break") demo = { ...demo, estado: "en_turno" };
  else demo = { estado: "fuera", desde: null, tiendaId: demo.tiendaId };
  return { ok: true, estado: demo.estado, desde: demo.desde };
}

// --- Acciones (cada una empieza con ctxActivo) ------------------------------------

/**
 * Lo que el hub necesita saber de quien tiene la sesión. No refusa por el interruptor: informa `activo`, y el botón no
 * sale si es false. Un fallo de lectura es `ok: false` (la pantalla no cambia nada).
 */
export async function estadoDelHub(): Promise<{ ok: true; datos: DatosDelHub } | { ok: false; mensaje: string }> {
  const ctx = await ctxActivo();
  if (!ctx.ok) {
    return ctx.res.codigo === "sesion" ? { ok: true, datos: SIN_SESION } : { ok: false, mensaje: ctx.res.mensaje };
  }
  if (ctx.demo) return { ok: true, datos: demoDatos() };
  if (!ctx.l) return { ok: true, datos: SIN_SESION };
  return { ok: true, datos: aDatos(ctx.l) };
}

export async function ficharDesdeElHub(input?: { storeId?: string | null }): Promise<ResultadoDelHub> {
  const corte = await corteDeCapacitacion();
  if (corte) return { ok: false, codigo: "error", mensaje: corte.message };
  const ctx = await ctxActivo();
  if (!ctx.ok) return ctx.res;
  if (ctx.demo) return demoAccion("entrar", input?.storeId);
  if (!ctx.activo || !ctx.l) return SIN_ACTIVO;
  // El cuerpo compartido, con el origen del hub. Sin lugar ni foto: queda «no se midió», sin excepciones (ver fichaje-interno.ts).
  const res = await clockInInterno({ storeId: input?.storeId ?? null, deviceId: EQUIPO }, { origen: "hub" });
  if (res.ok) return { ok: true, estado: "en_turno", desde: res.clockInAt };
  if (res.code === "already_open") return { ok: false, codigo: "estado", mensaje: "You are already on the clock.", estado: "en_turno", desde: res.clockInAt };
  return { ok: false, codigo: "error", mensaje: "message" in res && res.message ? res.message : `Could not clock in (${res.code}).` };
}

export async function empezarBreakDesdeElHub(): Promise<ResultadoDelHub> {
  const corte = await corteDeCapacitacion();
  if (corte) return { ok: false, codigo: "error", mensaje: corte.message };
  const ctx = await ctxActivo();
  if (!ctx.ok) return ctx.res;
  if (ctx.demo) return demoAccion("empezar_break");
  if (!ctx.activo || !ctx.l) return SIN_ACTIVO;
  const { l } = ctx;
  if (!siguienteEstado(l.estado, "empezar_break")) return estadoInvalido(l.estado, l.desde);
  const r = await startLeave({ reason: "lunch" });
  if (!r.ok) return { ok: false, codigo: "error", mensaje: r.message, estado: l.estado, desde: l.desde };
  return { ok: true, estado: "en_break", desde: r.leave.leftAt };
}

export async function volverDelBreakDesdeElHub(): Promise<ResultadoDelHub> {
  const corte = await corteDeCapacitacion();
  if (corte) return { ok: false, codigo: "error", mensaje: corte.message };
  const ctx = await ctxActivo();
  if (!ctx.ok) return ctx.res;
  if (ctx.demo) return demoAccion("volver_del_break");
  if (!ctx.activo || !ctx.l) return SIN_ACTIVO;
  const { l } = ctx;
  if (!siguienteEstado(l.estado, "volver_del_break") || !l.pausa || !l.abierto) return estadoInvalido(l.estado, l.desde);
  const r = await endLeave(l.pausa.id);
  if (!r.ok) return { ok: false, codigo: "error", mensaje: r.message ?? "Could not end the break.", estado: l.estado, desde: l.desde };
  return { ok: true, estado: "en_turno", desde: l.abierto.clockInAt };
}

/**
 * Terminar el turno. Si hay un almuerzo en curso, primero se cierra (la salida se niega con un almuerzo abierto) y
 * después se sale. Si la salida falla después de cerrar el almuerzo, el almuerzo ya quedó cerrado: se vuelve a leer
 * el estado y se devuelve para que la pantalla lo muestre.
 */
export async function terminarTurnoDesdeElHub(): Promise<ResultadoDelHub> {
  const corte = await corteDeCapacitacion();
  if (corte) return { ok: false, codigo: "error", mensaje: corte.message };
  const ctx = await ctxActivo();
  if (!ctx.ok) return ctx.res;
  if (ctx.demo) return demoAccion("terminar_turno");
  if (!ctx.activo || !ctx.l) return SIN_ACTIVO;
  const { l } = ctx;
  if (!siguienteEstado(l.estado, "terminar_turno") || !l.abierto) return estadoInvalido(l.estado, l.desde);
  if (l.pausa) {
    const fin = await endLeave(l.pausa.id);
    if (!fin.ok) return { ok: false, codigo: "error", mensaje: fin.message ?? "Could not end the break.", estado: l.estado, desde: l.desde };
  }
  const salida = await clockOutInterno(l.abierto.id, { deviceId: EQUIPO }, { origen: "hub" });
  if (salida.ok) return { ok: true, estado: "fuera", desde: null };
  const despues = await leeDelHub();
  const estado = despues.ok && despues.lectura ? despues.lectura.estado : (l.pausa ? "en_turno" : l.estado);
  const desde = despues.ok && despues.lectura ? despues.lectura.desde : l.desde;
  return { ok: false, codigo: "error", mensaje: salida.message, estado, desde };
}
