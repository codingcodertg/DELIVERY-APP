// Cuerpo compartido del fichaje (entrada y salida). NO es una accion de servidor: no lleva "use server", asi que
// ningun cliente lo puede llamar como accion. Lo llaman clockIn/clockOut de clock.ts SIN opciones (el camino de
// siempre, linea por linea), y hub.ts CON { origen: "hub" }, solo despues de comprobar el interruptor de la persona.

import { corteDeCapacitacion } from "@/lib/timetracker/capacitacion-servidor";
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


/** Opciones que solo pone el servidor (hub.ts). Nunca viajan desde el cliente. */
export type OpcionesDeFichaje = { origen?: "hub" };

/** La entrada del cuerpo: sin coordenadas cuando el fichaje sale del hub (no hay lugar que medir). */
export type ClockInputInterno = {
  lat?: number;
  lng?: number;
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

export type ClockOutInputInterno = {
  // Required: location is recorded on the way OUT as well as IN. The client's
  // whole reason for this system is knowing where each punch happened.
  lat?: number;
  lng?: number;
  accuracy?: number;
  photoPath?: string;
  deviceId?: string;
};

// Local dev only: when set in .env.local, every punch is treated as on-site so
// the flow can be tested from a laptop that isn't inside a real geofence. Double
// -guarded — the NODE_ENV check means it can NEVER activate in a production build
// even if the env var somehow leaked to Netlify.
const DEV_BYPASS_GEOFENCE =
  process.env.DEV_BYPASS_GEOFENCE === "1" && process.env.NODE_ENV !== "production";

/**
 * `onSite` tiene TRES valores, no dos (D-505): `true` en el sitio, `false` fuera, y `null`
 * cuando la geocerca no se pudo leer. `null` es el mismo «no se midió» que ya escribe un fichaje
 * puesto a mano por un gerente (`adminClock`, `clock_in_in_radius: null`) y que las pantallas ya
 * saben leer — avisan con `onSite === false`, nunca con un `null`.
 */
export type ClockInResult =
  | { ok: true; entryId: string; clockInAt: string; onSite: boolean | null; earlyMin?: number }
  | { ok: false; code: "needs_reason"; context: "offsite" | "unscheduled" | "other_site" }
  | { ok: false; code: "already_open"; entryId: string; clockInAt: string }
  | { ok: false; code: "not_configured" | "not_signed_in" | "error"; message: string }
  // Quien va en varias tiendas (350): sin tienda, o con una que no es activa de su empresa.
  | { ok: false; code: "tienda_requerida" | "tienda_no_permitida"; message: string };

export type ClockOutResult = { ok: true; onSite: boolean | null } | { ok: false; message: string };



export async function getAuthed() {
  if (!isSupabaseConfigured) return { ok: false as const, code: "not_configured" as const };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, code: "not_signed_in" as const };
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, full_name, store_id, role")
    .eq("id", user.id)
    .single();
  if (!profile) return { ok: false as const, code: "error" as const };
  return { ok: true as const, supabase, user, profile };
}

/**
 * ¿Tiene la base la columna de la tienda? Solo se pregunta cuando hace falta: quien va en varias tiendas y no mandó
 * ninguna. Sin ella, no se le exige tienda (la pantalla tampoco la enseña).
 */
async function existeLaColumnaDeTienda(supabase: Awaited<ReturnType<typeof createClient>>): Promise<boolean> {
  const { error } = await supabase.from("time_entries").select("work_store_id").limit(0);
  return !faltaLaColumnaDeTienda(error);
}

/**
 * Clock in with a server-side geofence check. Refuses if the user already has an
 * open shift. The browser only REPORTS coordinates — the server decides on-site.
 */
export async function clockInInterno(input: ClockInputInterno, opciones: OpcionesDeFichaje = {}): Promise<ClockInResult> {
  const corte = await corteDeCapacitacion();
  if (corte) return corte;
  const ctx = await getAuthed();
  if (!ctx.ok) {
    const msg =
      ctx.code === "not_configured"
        ? "Supabase is not configured yet."
        : ctx.code === "not_signed_in"
          ? "Please sign in to clock in."
          : "No profile found for this user.";
    return { ok: false, code: ctx.code, message: msg };
  }
  const { supabase, user, profile } = ctx;

  // Already clocked in? Don't create a duplicate open shift.
  const { data: existing } = await supabase
    .from("time_entries")
    .select("id, clock_in_at")
    .eq("employee_id", user.id)
    .eq("status", "open")
    .order("clock_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { ok: false, code: "already_open", entryId: existing.id, clockInAt: existing.clock_in_at };
  }

  // La tienda de quien va en VARIAS tiendas (350, 2026-11-25). La decide el servidor: se lee si esta persona va en
  // varias, y se valida la tienda que manda la pantalla (activa y de su empresa). Sin tienda mandada y sin la
  // columna todavía (350 sin aplicar), se ficha como hoy: sin pedir tienda.
  const { data: ajustes } = await supabase
    .schema("timetracker")
    .from("employee_settings")
    .select("worker_type, multi_store")
    .eq("id", user.id)
    .maybeSingle();
  const multiStore = esMultiTienda({
    workerType: (ajustes?.worker_type as string | null) ?? null,
    multiStore: (ajustes?.multi_store as boolean | null) ?? false,
  });
  let tiendaDelFichaje: string | null = null;
  // La tienda «de casa» para lo de «en otro sitio»: la que eligió, si va en varias; si no, la suya de siempre.
  let tiendaDeCasa: string | null = profile.store_id ?? null;
  if (multiStore && (input.storeId || (await existeLaColumnaDeTienda(supabase)))) {
    const { data: sitios } = await supabase
      .from("job_sites")
      .select("id")
      .eq("company_id", profile.company_id)
      .eq("active", true);
    const valida = validarTiendaDelFichaje({
      multiStore,
      storeId: input.storeId,
      tiendasActivas: (sitios ?? []) as { id: string }[],
    });
    if (!valida.ok) {
      return {
        ok: false,
        code: valida.code,
        message: valida.code === "tienda_requerida"
          ? "Pick the store you are clocking in at."
          : "That store is not one you can clock in at.",
      };
    }
    tiendaDelFichaje = valida.storeId;
    tiendaDeCasa = valida.storeId;
  }

  // Server-side geofence: which (if any) active site is this within?
  // Supports polygon (property outline + padding) and circle sites.
  //
  // Si la lectura FALLA no se sabe dónde está, y eso no es «fuera» (D-505): `onSite` se queda en
  // `null` y, de aquí abajo, nada de lo que depende de la geocerca ocurre — no se le pide motivo,
  // no se le insertan excepciones y no sale aviso a los gerentes. El GPS sí se guarda, así que el
  // veredicto se puede recalcular después; lo que no se puede deshacer es haberlo inventado.
  // Desde el hub de escritorio (origen "hub") no se lee la geocerca: no hay coordenadas, y «no se midió» es lo
  // que corresponde (no «fuera»: un `false` aquí pediría motivo y escribiría una excepción de radio).
  const geocerca = opciones.origen === "hub"
    ? null
    : await sitioDelFichaje(
      supabase as unknown as ClienteDeSitios,
      profile.company_id,
      input.lat as number,
      input.lng as number,
      DEV_BYPASS_GEOFENCE,
    );
  const siteId = geocerca?.medido ? geocerca.siteId : null;
  const onSite: boolean | null = geocerca?.medido ? geocerca.onSite : null;

  // Los motivos, en una sola forma para todo lo de abajo (D-163). Se acepta `reasons` (lo
  // que manda la pantalla nueva) o `reason` (una llamada vieja, o un cliente sin actualizar
  // — el móvil de alguien puede tardar días en recoger la versión nueva).
  const motivos = (input.reasons?.length ? input.reasons : input.reason ? [input.reason] : [])
    .filter((r, i, a) => r && a.indexOf(r) === i);
  const motivoPrincipal = motivos[0];
  const listaMotivos = motivos.length ? motivos : null;
  const hayMotivo = motivos.length > 0;

  // Off-site punches always need a reason (existing rule). `=== false` y no `!onSite`: preguntarle
  // «¿por qué estás fuera?» a quien no se ha podido medir ya es medio reproche, y además la
  // pregunta no tiene respuesta posible — la persona no sabe que la lectura falló.
  if (onSite === false && !hayMotivo) {
    return { ok: false, code: "needs_reason", context: "offsite" };
  }

  // On a site, but not the one they're assigned to? Ask why (e.g. "visiting
  // another store"). Not a block — it's flagged for the manager, like off-site.
  //
  // Estar atado es TENER SITIO ASIGNADO, y ya no "no ser dueño" (fase 1 de la fusión,
  // migración 084). Con dos niveles de rol, colgarlo del rol habría desatado a todo
  // admin — Patricia incluida, que hoy sí está atada a Brownsville. Quien debe roamear
  // simplemente no tiene sitio, que es lo que esa columna quiso decir siempre; a los
  // dueños se les quitó el suyo en 084 para que el resultado fuese idéntico al de hoy.
  // Quien va en varias tiendas (350): «otro sitio» se mide contra la tienda que ELIGIÓ, no contra una casa que no tiene.
  const homeBound = !!tiendaDeCasa;
  const atWrongSite = homeBound && !!siteId && siteId !== tiendaDeCasa;
  if (atWrongSite && !hayMotivo) {
    return { ok: false, code: "needs_reason", context: "other_site" };
  }

  // Link to today's scheduled shift (if any) so we can later compute late/early.
  const centralDate = new Date(Date.now() - centralShiftMs(new Date())).toISOString().slice(0, 10);
  const { data: todayShift } = await supabase
    .from("scheduled_shifts")
    .select("id, start_time")
    .eq("employee_id", user.id)
    .eq("shift_date", centralDate)
    .limit(1)
    .maybeSingle();

  // Unscheduled clock-in: on-site but no shift today. Only enforce a reason once
  // scheduling is actually in use company-wide today — otherwise early rollout
  // (before any schedules exist) would nag on every single punch.
  //
  // `=== true` por lo mismo que arriba: «en el sitio y sin turno» no se puede afirmar de un fichaje
  // cuya geocerca no se leyó. Sin medir no se pregunta nada y no se apunta nada.
  if (onSite === true && !todayShift && !hayMotivo) {
    const { count: scheduledToday } = await supabase
      .from("scheduled_shifts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", profile.company_id)
      .eq("shift_date", centralDate);
    if ((scheduledToday ?? 0) > 0) {
      return { ok: false, code: "needs_reason", context: "unscheduled" };
    }
  }
  const isUnscheduled = onSite === true && !todayShift && hayMotivo;

  const fichaje = {
    company_id: profile.company_id,
    employee_id: user.id,
    scheduled_shift_id: todayShift?.id ?? null,
    clock_in_lat: input.lat ?? null,
    clock_in_lng: input.lng ?? null,
    clock_in_site_id: siteId ?? null,
    clock_in_in_radius: onSite,
    clock_in_photo_path: input.photoPath ?? null,
    device_id: input.deviceId ?? null,
    status: "open",
  };
  // Una variable, no el literal dentro del insert: así el tipo de la tabla no rechaza una columna que quizá aún no exista.
  const conTiendaGuardada = tiendaDelFichaje ? { ...fichaje, work_store_id: tiendaDelFichaje } : fichaje;
  let { data: entry, error } = await supabase
    .from("time_entries")
    .insert(conTiendaGuardada)
    .select("id, clock_in_at")
    .single();
  // 350 sin aplicar: la base no tiene la columna de la tienda. Se ficha igual, como hoy, sin tienda guardada.
  if (faltaLaColumnaDeTienda(error)) {
    ({ data: entry, error } = await supabase.from("time_entries").insert(fichaje).select("id, clock_in_at").single());
  }

  if (error || !entry) {
    return { ok: false, code: "error", message: error?.message ?? "Could not record entry." };
  }

  // `=== false`, nunca `!onSite`: esta es la fila que acusa, y con `null` (sin medir) no se escribe.
  if (onSite === false) {
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entry.id,
      type: "out_of_radius",
      reason: motivoPrincipal,
      reasons: listaMotivos,
      note: input.note ?? null,
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    // Real-time alert to managers about the off-site clock-in.
    await pushToManagers(profile.company_id, "mgr_offsite", { name: profile.full_name });
  } else if (isUnscheduled) {
    // On-site but not on the schedule — log it so a manager can review, and ping them.
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entry.id,
      type: "other",
      reason: motivoPrincipal,
      reasons: listaMotivos,
      note: input.note ?? null,
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    await pushToManagers(profile.company_id, "mgr_unscheduled", { name: profile.full_name });
  } else if (atWrongSite) {
    // On site — just not THEIR site. Record where they actually are + why.
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entry.id,
      type: "other",
      reason: motivoPrincipal,
      reasons: listaMotivos,
      note: input.note ?? null,
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    await pushToManagers(profile.company_id, "mgr_other_site", { name: profile.full_name });
  }

  // Early-arrival rule: how many minutes before the scheduled start (if on site)?
  let earlyMin: number | undefined;
  if (onSite === true && todayShift?.start_time) {
    const nowCentral = new Date(Date.now() - centralShiftMs(new Date()));
    const nowMin = nowCentral.getUTCHours() * 60 + nowCentral.getUTCMinutes();
    const [sh, sm] = todayShift.start_time.split(":").map(Number);
    const diff = sh * 60 + sm - nowMin;
    if (diff > 0) earlyMin = diff;
  }

  return { ok: true, entryId: entry.id, clockInAt: entry.clock_in_at, onSite, earlyMin };
}

/**
 * Close an open shift WITH the same verification as clock-in: GPS + photo, a
 * server-side geofence check, and — if the punch is off-site — a flagged
 * exception plus a manager alert. This is what stops "clock in on-site, drive
 * home, clock out from the couch."
 */
export async function clockOutInterno(entryId: string, input: ClockOutInputInterno, opciones: OpcionesDeFichaje = {}): Promise<ClockOutResult> {
  const corte = await corteDeCapacitacion();
  if (corte) return corte;
  const ctx = await getAuthed();
  if (!ctx.ok) return { ok: false, message: "Not signed in." };
  const { supabase, user, profile } = ctx;

  // Still on a break? End it first. The client used to close the break as part of
  // clocking out, which meant a refused clock-out silently ate the lunch.
  const { data: openLeave } = await supabase
    .from("exceptions")
    .select("id")
    .eq("employee_id", user.id)
    .eq("type", "leaving_while_clocked_in")
    .is("returned_at", null)
    .limit(1)
    .maybeSingle();
  if (openLeave) {
    const { data: l } = await supabase.from("profiles").select("language").eq("id", user.id).maybeSingle();
    return {
      ok: false,
      message:
        l?.language === "es"
          ? "Termina tu almuerzo antes de marcar salida."
          : "End your lunch before clocking out.",
    };
  }

  // A run must not outlive the shift. Closing the shift while a run is open is
  // how trips ended up spanning overnight and collecting the next day's stops —
  // so end the run first, which also captures the real ending odometer instead
  // of the system guessing one later.
  const { data: openRun } = await supabase
    .from("vehicle_trips")
    .select("id")
    .eq("employee_id", user.id)
    .is("ended_at", null)
    .limit(1)
    .maybeSingle();
  if (openRun) {
    const { data: lang } = await supabase.from("profiles").select("language").eq("id", user.id).maybeSingle();
    return {
      ok: false,
      message:
        lang?.language === "es"
          ? "Termina tu recorrido antes de marcar salida."
          : "End your run before clocking out.",
    };
  }

  // Server-side geofence (never trust the client's verdict). La misma pieza que en la entrada, y
  // por eso ya no está copiada: el bloque de aquí era idéntico al de allí, el `error` descartado
  // incluido. Aquí el fallo de lectura era PEOR, porque la salida no tiene puerta que preguntar:
  // escribía `clock_out_in_radius: false` sin más (D-505).
  // Desde el hub (origen "hub"): sin geocerca, como en la entrada. Ver clockIn.
  const geocerca = opciones.origen === "hub"
    ? null
    : await sitioDelFichaje(
      supabase as unknown as ClienteDeSitios,
      profile.company_id,
      input.lat as number,
      input.lng as number,
      DEV_BYPASS_GEOFENCE,
    );
  const siteId = geocerca?.medido ? geocerca.siteId : null;
  const onSite: boolean | null = geocerca?.medido ? geocerca.onSite : null;

  const { data: closed, error } = await supabase
    .from("time_entries")
    .update({
      clock_out_at: new Date().toISOString(),
      clock_out_lat: input.lat ?? null,
      clock_out_lng: input.lng ?? null,
      clock_out_site_id: siteId ?? null,
      clock_out_in_radius: onSite,
      clock_out_photo_path: input.photoPath ?? null,
      status: "closed",
    })
    .eq("id", entryId)
    .eq("employee_id", user.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!closed) return { ok: false, message: "This shift is already closed." };

  // Off-site clock-out is the classic fraud signal — flag it for the manager.
  // Clocking out at ANOTHER store (not their own) is flagged too, but labelled
  // as such rather than as off-site. Mismo criterio que en la entrada: atado es
  // tener sitio, no el rol (084).
  const homeBound = !!profile.store_id;
  const atWrongSite = homeBound && !!siteId && siteId !== profile.store_id;
  // `=== false`: la «classic fraud signal» solo se escribe cuando se midió que estaba fuera.
  if (onSite === false) {
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entryId,
      type: "out_of_radius",
      reason: "other",
      note: "Clocked out away from a job site",
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    await pushToManagers(profile.company_id, "mgr_offsite_out", { name: profile.full_name });
  } else if (atWrongSite) {
    await supabase.from("exceptions").insert({
      company_id: profile.company_id,
      employee_id: user.id,
      time_entry_id: entryId,
      type: "other",
      reason: "other",
      note: "Clocked out at another store",
      photo_path: input.photoPath ?? null,
      latitude: input.lat,
      longitude: input.lng,
    });
    await pushToManagers(profile.company_id, "mgr_other_site_out", { name: profile.full_name });
  }

  // Scheduled a lunch but never punched one? Managers + owner should know — the
  // punch is what protects the company, so a missing one is worth a look.
  const centralDate = new Date(Date.now() - centralShiftMs(new Date())).toISOString().slice(0, 10);
  const { data: todayShift } = await supabase
    .from("scheduled_shifts")
    .select("lunch_minutes")
    .eq("employee_id", user.id)
    .eq("shift_date", centralDate)
    .limit(1)
    .maybeSingle();
  const allowed = (todayShift?.lunch_minutes as number) ?? 0;
  if (allowed > 0) {
    const { count: lunchCount } = await supabase
      .from("exceptions")
      .select("id", { count: "exact", head: true })
      .eq("time_entry_id", entryId)
      .eq("reason", "lunch");
    if (!lunchCount) {
      await pushToManagers(profile.company_id, "mgr_no_lunch", { name: profile.full_name, allowed });
    }
  }

  return { ok: true, onSite };
}

