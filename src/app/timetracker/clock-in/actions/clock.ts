"use server";

import { corteDeCapacitacion } from "@/lib/timetracker/capacitacion-servidor";
import { demoMyDay } from "./demo-local";
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
import { hoyEnBrownsville } from "@/lib/recruiting/hora-de-brownsville";
import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { sitioDelFichaje, type ClienteDeSitios } from "@/lib/clockin/sitio-del-fichaje";
import { pushToManagers, pushToUser } from "@/lib/clockin/notify";
import { canManageEmployee, type Me } from "@/lib/clockin/mgrScope";
import { centralShiftMs } from "@/lib/clockin/tz";
import { isOverlapError, OVERLAP_MESSAGE } from "@/lib/clockin/overlap";
import { clockinManagerCtx } from "@/lib/clockin/managerCtx";
import { dayAndWeekStart } from "@/lib/clockin/time";
import { todayAlerts } from "@/lib/clockin/scorecard";
import { NO_MATCH, visibleStores } from "@/lib/clockin/scope";
import { centralDateStr, payPeriodDates, shiftMinutes } from "@/lib/clockin/schedule";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { esMultiTienda } from "@/lib/timetracker/multitienda";
import { faltaLaColumnaDeTienda, validarTiendaDelFichaje } from "@/lib/timetracker/fichaje-en-tienda";


import { clockInInterno, clockOutInterno, getAuthed, type ClockInResult, type ClockOutResult } from "@/lib/clockin/fichaje-interno";
export type { ClockInResult, ClockOutResult };

type ClockOutInput = {
  // Required: location is recorded on the way OUT as well as IN. The client's
  // whole reason for this system is knowing where each punch happened.
  lat: number;
  lng: number;
  accuracy?: number;
  photoPath?: string;
  deviceId?: string;
};

type ClockInput = {
  lat: number;
  lng: number;
  accuracy?: number;
  /**
   * La tienda en la que ficha quien va en VARIAS tiendas (350, 2026-11-25). Para los demás se ignora. El servidor
   * comprueba que sea una tienda activa de su empresa (`validarTiendaDelFichaje`). No es un dato de la geocerca.
   */
  storeId?: string | null;
  /**
   * Los motivos elegidos (D-163). Varios, porque uno no alcanzaba: el 72 % de los fichajes
   * fuera de radio decían "otro", que es lo que se marca cuando sales por dos cosas a la vez
   * y el formulario solo te deja decir una.
   */
  reasons?: string[];
  /** El primero, o el único. Se mantiene por lo que ya lo lee — ver la 098. */
  reason?: string;
  note?: string;
  photoPath?: string;
  deviceId?: string;
};

/** Fichar (entrada). Accion publica: lo que manda el cliente pasa tal cual, sin opciones (ver fichaje-interno.ts). */
export async function clockIn(input: ClockInput): Promise<ClockInResult> {
  const corte = await corteDeCapacitacion();
  if (corte) return corte;
  return clockInInterno(input);
}

/** Cerrar el turno. Accion publica: sin opciones (ver fichaje-interno.ts). */
export async function clockOut(entryId: string, input: ClockOutInput): Promise<ClockOutResult> {
  const corte = await corteDeCapacitacion();
  if (corte) return corte;
  return clockOutInterno(entryId, input);
}

/**
 * "Yes, I'm still working" — the answer to the 7:55 PM prompt. Stamping this
 * pushes the automatic clock-out back an hour (see /api/cron), so someone
 * genuinely working late doesn't get closed out from under them. It does NOT
 * turn the rule off: an hour later they get asked again.
 */
export async function stillWorking(): Promise<{ ok: true } | { ok: false; message: string }> {
  const corte = await corteDeCapacitacion();
  if (corte) return corte;
  const ctx = await getAuthed();
  if (!ctx.ok) return { ok: false, message: "Not signed in." };
  const { supabase, user } = ctx;

  const { data: updated, error } = await supabase
    .from("time_entries")
    .update({ still_working_at: new Date().toISOString() })
    .eq("employee_id", user.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!updated) return { ok: false, message: "You're not clocked in." };
  return { ok: true };
}

export type AdminClockResult = { ok: true; action: "in" | "out" } | { ok: false; message: string };

/**
 * A manager/owner clocks an employee in or out on their behalf — e.g. the crew
 * has no signal at the site. Records who did it + the reason, and notifies the
 * employee. No GPS/photo (it's an admin action, not a self-punch).
 */
export async function adminClock(input: {
  employeeId: string;
  action: "in" | "out";
  reason: string;
}): Promise<AdminClockResult> {
  const corte = await corteDeCapacitacion();
  if (corte) return corte;
  const ctx = await getAuthed();
  if (!ctx.ok) return { ok: false, message: "Not signed in." };
  const { supabase, user, profile } = ctx;

  const { data: meRow } = await supabase.from("profiles").select("role, store_id").eq("id", user.id).maybeSingle();
  if (!meRow || (meRow.role !== "manager" && meRow.role !== "owner")) return { ok: false, message: "Managers only." };
  const me: Me = { role: meRow.role, company_id: profile.company_id, store_id: (meRow.store_id as string) ?? null };
  if (!(await canManageEmployee(supabase, me, input.employeeId))) {
    return { ok: false, message: "That employee isn't in your store." };
  }
  const reason = input.reason?.trim();
  if (!reason) return { ok: false, message: "Please add a reason." };

  const { data: open } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", input.employeeId)
    .eq("status", "open")
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (input.action === "in") {
    if (open) return { ok: false, message: "They're already clocked in." };
    const centralDate = new Date(Date.now() - centralShiftMs(new Date())).toISOString().slice(0, 10);
    const { data: todayShift } = await supabase
      .from("scheduled_shifts")
      .select("id, site_id")
      .eq("employee_id", input.employeeId)
      .eq("shift_date", centralDate)
      .limit(1)
      .maybeSingle();
    const { error } = await supabase.from("time_entries").insert({
      company_id: profile.company_id,
      employee_id: input.employeeId,
      scheduled_shift_id: todayShift?.id ?? null,
      clock_in_site_id: todayShift?.site_id ?? null,
      clock_in_in_radius: null,
      status: "open",
      manual: true,
      edited_by: user.id,
      edited_at: new Date().toISOString(),
      edit_note: `Clocked in by ${profile.full_name}: ${reason}`,
    });
    // Abrirle un fichaje a alguien que ya tiene uno abierto lo impide el índice de 085,
    // además de la comprobación de arriba: la comprobación mira y luego inserta, y entre
    // las dos cosas cabe otra pulsación.
    if (error) return { ok: false, message: isOverlapError(error) ? OVERLAP_MESSAGE : error.message };
    await pushToUser(input.employeeId, profile.company_id, "admin_clocked_in", { name: profile.full_name });
    return { ok: true, action: "in" };
  }

  if (!open) return { ok: false, message: "They're not clocked in." };
  const { error } = await supabase
    .from("time_entries")
    .update({
      clock_out_at: new Date().toISOString(),
      status: "closed",
      edited_by: user.id,
      edited_at: new Date().toISOString(),
      edit_note: `Clocked out by ${profile.full_name}: ${reason}`,
    })
    .eq("id", open.id);
  if (error) return { ok: false, message: error.message };
  await pushToUser(input.employeeId, profile.company_id, "admin_clocked_out", { name: profile.full_name });
  return { ok: true, action: "out" };
}

/**
 * Quién está fichado AHORA y a quién se le espera, para "Working Now" (D-124).
 *
 * Esa pantalla enseñaba solo `liveSessions` —la mitad que cronometra— y era **ciega a la
 * cuadrilla fichada**. Con las dos formas de trabajar conviviendo (D-123), "quién trabaja
 * ahora" respondía por media empresa y no lo decía; peor que faltar, engañaba.
 *
 * Trae también las alertas del panel de fichaje —quien llega tarde y quien no ha fichado
 * teniendo turno empezado—, que era lo ÚNICO que le quedaba a aquella pantalla.
 */
export async function getCrewNow(): Promise<
  | {
      ok: true;
      onClock: {
        id: string; employeeId: string; name: string; since: string;
        /** Fuera ahora mismo: de almuerzo o en la calle. null = está en el sitio. */
        away: { reason: string; since: string } | null;
        /** Dónde fichó. null si el navegador no dio permiso de ubicación ese día. */
        lat: number | null;
        lng: number | null;
        /** false = fichó fuera de la geocerca. */
        onSite: boolean | null;
        /** Minutos de hoy fuera, separados: comer no es lo mismo que salir a repartir. */
        lunchMin: number;
        outMin: number;
      }[];
      late: { name: string; minutes: number }[];
      notInYet: { name: string }[];
    }
  | { ok: false; message: string }
> {
  const ctx = await clockinManagerCtx();
  if (!ctx.ok) return ctx;
  const { supabase, me } = ctx;

  const { todayStartUtc } = dayAndWeekStart();
  const hoy = centralDateStr();

  const suyas = visibleStores(me.role, me.store_id, me.extra_store_ids);
  let peopleQ = supabase.from("profiles").select("id, full_name").eq("company_id", me.company_id).eq("active", true);
  if (suyas) peopleQ = peopleQ.in("store_id", suyas);
  if (me.role !== "owner") peopleQ = peopleQ.neq("role", "owner");
  const [{ data: people }, { data: bajas }] = await Promise.all([
    peopleQ.order("full_name"),
    // D-707: clockin.profiles no tiene la baja; la marca vive en public.profiles.left_at (205).
    supabase.schema("public").from("perfiles_publicos").select("id").not("left_at", "is", null).lte("left_at", hoyEnBrownsville()), // D-1134: por la vista (291)
  ]);
  const deBaja = new Set(((bajas ?? []) as { id: string }[]).map((b) => b.id));
  const nombre = new Map((people ?? []).filter((p) => !deBaja.has(p.id as string)).map((p) => [p.id as string, (p.full_name as string) ?? "—"]));
  const ids = [...nombre.keys()];
  const inIds = ids.length ? ids : NO_MATCH;

  const [{ data: entries }, { data: shifts }, { data: salidas }, { data: pausasHoy }] = await Promise.all([
    supabase
      .from("time_entries")
      .select("id, employee_id, clock_in_at, clock_out_at, status, clock_in_lat, clock_in_lng, clock_in_in_radius")
      .in("employee_id", inIds)
      .gte("clock_in_at", todayStartUtc.toISOString()),
    supabase
      .from("scheduled_shifts")
      .select("employee_id, shift_date, start_time, end_time, lunch_minutes")
      .in("employee_id", inIds)
      .eq("shift_date", hoy),
    // Quién está fuera ahora. `type` es imprescindible: la tabla guarda también los avisos de
    // geocerca, que no se cierran nunca y harían parecer que media plantilla está de almuerzo
    // (D-128). Sin esto, la tarjeta diría "trabajando" de alguien que salió hace una hora.
    supabase
      .from("exceptions")
      .select("employee_id, reason, left_at, returned_at")
      .in("employee_id", inIds)
      .eq("type", "leaving_while_clocked_in")
      .is("returned_at", null)
      .order("left_at", { ascending: true }),
    // Todas las de hoy, cerradas o no, para poder decir "almuerzo 40 min" y no solo "está
    // fuera": lo que un gerente necesita saber es cuánto lleva, no solo que se fue.
    supabase
      .from("exceptions")
      .select("employee_id, reason, left_at, returned_at")
      .in("employee_id", inIds)
      .eq("type", "leaving_while_clocked_in")
      .gte("left_at", todayStartUtc.toISOString()),
  ]);

  const acum = new Map<string, { lunch: number; out: number }>();
  for (const x of pausasHoy ?? []) {
    const id = x.employee_id as string;
    const fin = x.returned_at ? Date.parse(x.returned_at as string) : Date.now();
    const min = Math.max(0, Math.round((fin - Date.parse(x.left_at as string)) / 60000));
    const a = acum.get(id) ?? { lunch: 0, out: 0 };
    if ((x.reason as string) === "lunch") a.lunch += min; else a.out += min;
    acum.set(id, a);
  }

  // Se recorre de más antigua a más nueva y se pisa, así que gana la ÚLTIMA. Sin orden ganaba
  // cualquiera, y con varias abiertas de días distintos eso es una lotería.
  const fuera = new Map<string, { reason: string; since: string }>();
  for (const x of salidas ?? []) {
    fuera.set(x.employee_id as string, { reason: (x.reason as string) ?? "other", since: x.left_at as string });
  }

  const alerts = todayAlerts(shifts ?? [], entries ?? []);

  return {
    ok: true,
    // Un fichaje sin salida es alguien que está dentro ahora mismo.
    onClock: (entries ?? [])
      .filter((e) => !e.clock_out_at)
      .map((e) => ({
        id: e.id as string,
        employeeId: e.employee_id as string,
        name: nombre.get(e.employee_id as string) ?? "—",
        since: e.clock_in_at as string,
        away: fuera.get(e.employee_id as string) ?? null,
        lat: (e.clock_in_lat as number) ?? null,
        lng: (e.clock_in_lng as number) ?? null,
        onSite: (e.clock_in_in_radius as boolean) ?? null,
        lunchMin: acum.get(e.employee_id as string)?.lunch ?? 0,
        outMin: acum.get(e.employee_id as string)?.out ?? 0,
      }))
      .sort((a, b) => a.since.localeCompare(b.since)),
    late: alerts.late.map((a) => ({ name: nombre.get(a.employeeId) ?? "—", minutes: a.minutes })),
    notInYet: alerts.notInYet.map((a) => ({ name: nombre.get(a.employeeId) ?? "—" })),
  };
}

/**
 * Mi jornada: el fichaje abierto, los de hoy y los totales (D-125).
 *
 * Es lo que necesita el panel de fichaje **dentro** de Registrar tiempo, para no tener que
 * mandar a nadie a otra pantalla: cuándo entré, cuándo salí, cuánto llevo hoy y cuánto en la
 * semana de pago (viernes→jueves, la misma que cuenta la nómina — usar la semana natural aquí
 * y la de pago allí daría dos totales distintos para lo mismo).
 *
 * Devuelve también compañía y usuario porque la foto se sube desde el navegador y la ruta del
 * fichero se construye con los dos; pedirlos en otra llamada sería una ida y vuelta de más
 * justo antes de fichar, que es cuando peor sienta esperar.
 */
export async function getMyDay(): Promise<
  | {
      ok: true;
      companyId: string;
      userId: string;
      /** `tienda`: la tienda en la que se fichó (350), por nombre; null si no va en varias o no hay columna. */
      open: { id: string; clockInAt: string; tienda: string | null; tiendaId: string | null } | null;
      /** El descanso/almuerzo en curso, si lo hay. */
      leave: { id: string; reason: string; leftAt: string } | null;
      /** El turno de HOY, para saber a qué hora se entra y se sale. */
      shift: { start: string; end: string; lunch: number; site: string | null } | null;
      /** Minutos programados en la semana de pago, y en cuántos días. */
      scheduledMinutes: number;
      scheduledDays: number;
      /** Viernes y jueves del periodo que se está contando. */
      periodStart: string;
      periodEnd: string;
      today: { id: string; clockInAt: string; clockOutAt: string | null; minutes: number; tienda: string | null }[];
      /** Almuerzos y salidas de hoy, para verlos junto a los fichajes. */
      breaks: { id: string; reason: string; leftAt: string; returnedAt: string | null; minutes: number }[];
      lunchMinutes: number;
      outMinutes: number;
      todayMinutes: number;
      weekMinutes: number;
      /** ¿Existe ya la columna de la tienda del fichaje (350)? Sin ella, la pantalla no enseña el selector. */
      tiendaDisponible: boolean;
    }
  | { ok: false; message: string }
> {
  if (LOCAL_MODE) return demoMyDay();
  const ctx = await getAuthed();
  if (!ctx.ok) return { ok: false, message: "Not signed in." };
  const { supabase, user, profile } = ctx;

  const { todayStartUtc } = dayAndWeekStart();
  const semana = payPeriodDates();
  const desdeSemana = centralWallToUtc(`${semana[0]}T00:00`);

  const [{ data: turnos }, { data: sitios }, { data: descanso }, { data: deHoyPausas }] = await Promise.all([
    supabase
      .from("scheduled_shifts")
      .select("shift_date, start_time, end_time, lunch_minutes, site_id")
      .eq("employee_id", user.id)
      .gte("shift_date", semana[0])
      .lte("shift_date", semana[6]),
    supabase.from("job_sites").select("id, name").eq("company_id", profile.company_id),
    // Una salida en curso. `type` es imprescindible: la tabla `exceptions` guarda TAMBIÉN los
    // avisos de geocerca (`out_of_radius`), que por naturaleza no llevan regreso — hay 54
    // abiertos ahora mismo. Sin filtrar por tipo, cualquiera parecía llevar semanas de
    // almuerzo, y por eso no le salían los botones de "empezar almuerzo" y "voy a salir".
    supabase
      .from("exceptions")
      .select("id, reason, left_at, returned_at")
      .eq("employee_id", user.id)
      .eq("type", "leaving_while_clocked_in")
      .is("returned_at", null)
      .order("left_at", { ascending: false })
      .limit(1),
    // Los de HOY, cerrados o no: son parte de la jornada y hasta ahora no se veían en
    // "Today's punches", así que un almuerzo de 40 min no aparecía por ninguna parte.
    supabase
      .from("exceptions")
      .select("id, reason, left_at, returned_at")
      .eq("employee_id", user.id)
      .eq("type", "leaving_while_clocked_in")
      .gte("left_at", todayStartUtc.toISOString())
      .order("left_at", { ascending: true }),
  ]);

  // La tienda de cada fichaje (350). Si la base aún no tiene la columna, se lee sin ella y se dice (tiendaDisponible).
  const fichajesDeLaSemana = (columnas: string) => supabase
    .from("time_entries")
    .select(columnas)
    .eq("employee_id", user.id)
    .gte("clock_in_at", desdeSemana)
    .order("clock_in_at", { ascending: true });
  let { data, error } = await fichajesDeLaSemana("id, clock_in_at, clock_out_at, lunch_minutes, work_store_id");
  let tiendaDisponible = true;
  if (faltaLaColumnaDeTienda(error)) {
    tiendaDisponible = false;
    ({ data, error } = await fichajesDeLaSemana("id, clock_in_at, clock_out_at, lunch_minutes"));
  }
  if (error) return { ok: false, message: error.message };

  type Fila = { id: string; clock_in_at: string; clock_out_at: string | null; lunch_minutes: number | null; work_store_id?: string | null };
  const filas = (data ?? []) as unknown as Fila[];
  const mins = (e: Fila) => {
    // Un fichaje sin salida cuenta hasta AHORA: es lo que la persona lleva trabajado, y
    // enseñarlo como cero mientras está dentro sería el dato más confuso de la pantalla.
    const fin = e.clock_out_at ? Date.parse(e.clock_out_at) : Date.now();
    const bruto = Math.max(0, Math.round((fin - Date.parse(e.clock_in_at)) / 60000));
    return Math.max(0, bruto - (e.lunch_minutes ?? 0));
  };

  const hoyIso = todayStartUtc.toISOString();
  const deHoy = filas.filter((e) => e.clock_in_at >= hoyIso);

  const pausas = (deHoyPausas ?? []).map((b) => {
    const fin = b.returned_at ? Date.parse(b.returned_at as string) : Date.now();
    return {
      id: b.id as string,
      reason: (b.reason as string) ?? "other",
      leftAt: b.left_at as string,
      returnedAt: (b.returned_at as string) ?? null,
      minutes: Math.max(0, Math.round((fin - Date.parse(b.left_at as string)) / 60000)),
    };
  });

  const hoy = centralDateStr();
  const nombreSitio = new Map((sitios ?? []).map((x) => [x.id as string, x.name as string]));
  const nombreDeTienda = (id: string | null | undefined): string | null => (id ? (nombreSitio.get(id) ?? null) : null);
  const delDia = (turnos ?? []).find((x) => x.shift_date === hoy);
  const turnoAbierto = filas.find((e) => !e.clock_out_at);
  // Y solo si empezó DENTRO del turno abierto: una salida que nadie cerró de un turno de la
  // semana pasada no es un almuerzo de ahora.
  const posible = (descanso ?? [])[0];
  const abiertoDescanso =
    posible && turnoAbierto && (posible.left_at as string) >= turnoAbierto.clock_in_at ? posible : null;

  return {
    ok: true,
    companyId: profile.company_id,
    userId: user.id,
    open: (() => {
      const abierto = filas.find((e) => !e.clock_out_at);
      return abierto
        ? { id: abierto.id, clockInAt: abierto.clock_in_at, tienda: nombreDeTienda(abierto.work_store_id), tiendaId: abierto.work_store_id ?? null }
        : null;
    })(),
    today: deHoy.map((e) => ({
      id: e.id,
      clockInAt: e.clock_in_at,
      clockOutAt: e.clock_out_at,
      minutes: mins(e),
      tienda: nombreDeTienda(e.work_store_id),
    })),
    tiendaDisponible,
    todayMinutes: deHoy.reduce((acc, e) => acc + mins(e), 0),
    weekMinutes: filas.reduce((acc, e) => acc + mins(e), 0),
    leave: abiertoDescanso
      ? { id: abiertoDescanso.id as string, reason: (abiertoDescanso.reason as string) ?? "other", leftAt: abiertoDescanso.left_at as string }
      : null,
    shift: delDia
      ? {
          start: delDia.start_time as string,
          end: delDia.end_time as string,
          lunch: (delDia.lunch_minutes as number) ?? 0,
          site: delDia.site_id ? (nombreSitio.get(delDia.site_id as string) ?? null) : null,
        }
      : null,
    scheduledMinutes: (turnos ?? []).reduce(
      (acc, x) => acc + shiftMinutes(x.start_time as string, x.end_time as string, (x.lunch_minutes as number) ?? 0),
      0,
    ),
    scheduledDays: (turnos ?? []).length,
    periodStart: semana[0],
    periodEnd: semana[6],
    breaks: pausas,
    // Uno en curso cuenta hasta AHORA: enseñar 0 mientras alguien está comiendo es el dato
    // que menos ayuda de la pantalla.
    lunchMinutes: pausas.filter((b) => b.reason === "lunch").reduce((a, b) => a + b.minutes, 0),
    outMinutes: pausas.filter((b) => b.reason !== "lunch").reduce((a, b) => a + b.minutes, 0),
  };
}
