"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";

export type RunnerResult<T = unknown> = { ok: true; data?: T } | { ok: false; message: string };

type Geo = { lat?: number; lng?: number; photoPath?: string };
// rangeMiles = the dashboard's "miles to empty" reading (easier + more precise
// than eyeballing an E–F gauge). Stored in the trip's fuel text column.
// personal = using their OWN vehicle: no vehicle/odometer/fuel — just stop photos.
type TripKind = "runner" | "sales";
type DashInput = Geo & {
  vehicleId?: string | null;
  odometer?: number | null;
  rangeMiles?: number | null;
  personal?: boolean;
  reason?: string | null; // why they're leaving (merged from "leaving work location")
  note?: string | null; // free text when reason is "other"
};

async function authed() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Not configured." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, full_name, is_runner, vehicle_id, language")
    .eq("id", user.id)
    .single();
  if (!profile) return { ok: false as const, message: "No profile." };
  const es = profile.language === "es";
  return { ok: true as const, supabase, user, profile, es };
}

/**
 * Guard messages the crew actually reads. Most of this app is Spanish-first, so
 * a rule that only explains itself in English may as well not explain itself.
 */
function say(es: boolean, en: string, spanish: string) {
  return es ? spanish : en;
}

/** Straight-line miles between two points (GPS estimate for a stop leg). */
function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8; // miles
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}

const rangeText = (m?: number | null) => (m != null && Number.isFinite(m) ? String(m) : null);

/**
 * Turn GPS coordinates into a short street address ("1420 N 10th St, McAllen")
 * via OpenStreetMap's free Nominatim service. Best-effort: any failure returns
 * null and the stop still saves with just its coordinates. Low volume (one call
 * per logged stop) stays within Nominatim's usage policy.
 */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&zoom=18&addressdetails=1`;
    const r = await fetch(u, {
      headers: { "User-Agent": "RTG-Clock-In/1.0 (Rodriguez Tile Group time clock)" },
      cache: "no-store",
      // Hard cap: this is a nice-to-have label. It must never hold up a punch.
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { display_name?: string; address?: Record<string, string> };
    const a = j.address ?? {};
    const line1 = [a.house_number, a.road].filter(Boolean).join(" ");
    const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county;
    const short = [line1, city].filter(Boolean).join(", ");
    return short || j.display_name || null;
  } catch {
    return null;
  }
}

/**
 * Start a vehicle trip. The person must already be clocked in (runners and
 * salesmen both clock in the normal way first). A runner's trip spans the day;
 * a salesman logs short ad-hoc trips. One open trip at a time.
 */
export async function startTrip(input: DashInput & { kind: TripKind }): Promise<RunnerResult> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  const { supabase, user, profile } = ctx;

  const { data: entry } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", user.id)
    .eq("status", "open")
    .maybeSingle();
  if (!entry) return { ok: false, message: "Clock in first." };

  const { data: openTrip } = await supabase
    .from("vehicle_trips")
    .select("id")
    .eq("employee_id", user.id)
    .is("ended_at", null)
    .maybeSingle();
  if (openTrip) return { ok: false, message: "Finish your current trip first." };

  // Personal vehicle: no vehicle/odometer/fuel — a null vehicle_id marks it as
  // personal, and each stop still gets a photo.
  if (!input.personal) {
    if (!input.vehicleId) return { ok: false, message: "Pick the vehicle you're using." };
    if (input.odometer == null || !Number.isFinite(input.odometer))
      return { ok: false, message: "Enter the odometer reading." };
  }

  const { data: savedTrip, error } = await supabase.from("vehicle_trips").insert({
    company_id: profile.company_id,
    employee_id: user.id,
    time_entry_id: entry.id,
    vehicle_id: input.personal ? null : input.vehicleId,
    kind: input.kind,
    start_odometer: input.personal ? null : input.odometer,
    start_fuel: input.personal ? null : rangeText(input.rangeMiles),
    // Personal vehicle: no odometer/fuel, but we still keep the start photo —
    // it locks the start with a picture + GPS + server time.
    start_photo_path: input.photoPath ?? null,
    start_lat: input.lat,
    start_lng: input.lng,
    reason: input.reason ?? null,
    note: input.note?.trim() || null,
  })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  // Address label afterwards — never blocks starting the trip.
  if (savedTrip && input.lat != null && input.lng != null) {
    const start_address = await reverseGeocode(input.lat, input.lng);
    if (start_address) await supabase.from("vehicle_trips").update({ start_address }).eq("id", savedTrip.id);
  }
  return { ok: true };
}

/** Log a stop on the current open trip (photo + GPS + server-time; auto leg mileage). */
export async function logStop(input: { label?: string; note?: string } & Geo): Promise<RunnerResult> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  const { supabase, user, profile, es } = ctx;

  // A stop must have a name — an unnamed stop leaves the manager guessing what
  // they were doing there. Enforced here too, not just in the UI.
  if (!input.label?.trim()) {
    return { ok: false, message: say(es, "Name the stop before saving it.", "Ponle un nombre a la parada antes de guardarla.") };
  }

  // Off the clock means off the clock. A stop logged while clocked out is work
  // nobody is being paid for and nobody approved — it shouldn't exist.
  const { data: onClock } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", user.id)
    .eq("status", "open")
    .maybeSingle();
  if (!onClock) {
    return {
      ok: false,
      message: say(es, "You're clocked out — clock in before logging a stop.", "Tienes salida marcada — marca entrada antes de registrar una parada."),
    };
  }

  const { data: trip } = await supabase
    .from("vehicle_trips")
    .select("id, time_entry_id, start_lat, start_lng, paused_at")
    .eq("employee_id", user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!trip) return { ok: false, message: "No active trip — record your vehicle first." };
  // Paused for lunch — a stop logged now would be break time, not work.
  if (trip.paused_at)
    return {
      ok: false,
      message: say(es, 'Your run is paused for lunch — tap "I\'m back" first.', 'Tu recorrido está en pausa por almuerzo — toca "Ya regresé" primero.'),
    };

  // Distance from the previous point (last stop, else the trip start).
  let miles: number | null = null;
  if (input.lat != null && input.lng != null) {
    const { data: last } = await supabase
      .from("trip_stops")
      .select("latitude, longitude")
      .eq("trip_id", trip.id)
      .order("arrived_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const pLat = last?.latitude ?? trip.start_lat;
    const pLng = last?.longitude ?? trip.start_lng;
    if (pLat != null && pLng != null) miles = milesBetween(pLat, pLng, input.lat, input.lng);
  }

  // SAVE THE STOP FIRST. The address lookup is a cosmetic label from an outside
  // service — if it's slow or rate-limited it must never cost us the stop.
  const { data: saved, error } = await supabase
    .from("trip_stops")
    .insert({
      company_id: profile.company_id,
      employee_id: user.id,
      trip_id: trip.id,
      time_entry_id: trip.time_entry_id,
      label: input.label?.trim() || null,
      note: input.note?.trim() || null,
      latitude: input.lat ?? null,
      longitude: input.lng ?? null,
      photo_path: input.photoPath ?? null,
      miles_from_prev: miles,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: error.message };

  // Now fill in the address, best-effort. Failure here changes nothing.
  if (saved && input.lat != null && input.lng != null) {
    const address = await reverseGeocode(input.lat, input.lng);
    if (address) await supabase.from("trip_stops").update({ address }).eq("id", saved.id);
  }
  return { ok: true };
}

/**
 * Mark the current stop finished — records time + GPS only (no photo), so the
 * review shows how long they were actually at each place.
 */
export async function finishStop(input: Geo): Promise<RunnerResult> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  const { supabase, user } = ctx;

  const { data: trip } = await supabase
    .from("vehicle_trips")
    .select("id")
    .eq("employee_id", user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!trip) return { ok: false, message: "No active trip." };

  const { data: stop } = await supabase
    .from("trip_stops")
    .select("id")
    .eq("trip_id", trip.id)
    .is("departed_at", null)
    .order("arrived_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!stop) return { ok: false, message: "No open stop to finish." };

  // Ask for the row back. An RLS-filtered UPDATE succeeds with zero rows changed
  // and no error — checking only `error` is how this failed silently for weeks.
  const { data: closed, error } = await supabase
    .from("trip_stops")
    .update({
      departed_at: new Date().toISOString(),
      depart_lat: input.lat ?? null,
      depart_lng: input.lng ?? null,
    })
    .eq("id", stop.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!closed) return { ok: false, message: "Couldn't close that stop — please tell your manager." };
  return { ok: true };
}

/**
 * End the open trip with the closing dashboard reading + photo. A runner does
 * this at the end of the day (before/at clock-out); a salesman when they're back.
 */
export async function endTrip(input: DashInput): Promise<RunnerResult> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  const { supabase, user, es } = ctx;

  const { data: trip } = await supabase
    .from("vehicle_trips")
    .select("id, start_odometer, vehicle_id, paused_at, paused_minutes")
    .eq("employee_id", user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!trip) return { ok: false, message: "No trip to close." };

  // Personal trips (no vehicle) just close — no odometer needed.
  const personal = trip.vehicle_id == null;
  if (!personal) {
    if (input.odometer == null || !Number.isFinite(input.odometer))
      return { ok: false, message: "Enter the odometer reading." };
    if (trip.start_odometer != null && input.odometer < trip.start_odometer)
      return { ok: false, message: "Odometer can't be lower than when you started." };
  }

  // Can't finish the run with a stop still open — otherwise we'd have to invent a
  // departure time and the "how long were they there" number would be a lie.
  const { data: openStop } = await supabase
    .from("trip_stops")
    .select("id")
    .eq("trip_id", trip.id)
    .is("departed_at", null)
    .limit(1)
    .maybeSingle();
  if (openStop) return { ok: false, message: say(es, "Finish your current stop first.", "Termina tu parada actual primero.") };

  const endedAt = new Date().toISOString();
  // Ending while still paused (e.g. she clocks out straight from lunch): bank the
  // outstanding paused minutes so the run's duration stays honest.
  const bankedPause = trip.paused_at
    ? (trip.paused_minutes ?? 0) + Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(trip.paused_at)) / 60000))
    : (trip.paused_minutes ?? 0);
  const { error } = await supabase
    .from("vehicle_trips")
    .update({
      ended_at: endedAt,
      paused_at: null,
      paused_minutes: bankedPause,
      end_odometer: personal ? null : input.odometer ?? null,
      end_fuel: personal ? null : rangeText(input.rangeMiles),
      end_photo_path: personal ? null : input.photoPath ?? null,
      end_lat: input.lat ?? null,
      end_lng: input.lng ?? null,
    })
    .eq("id", trip.id);
  if (error) return { ok: false, message: error.message };

  // Address label afterwards — never blocks closing the trip.
  if (input.lat != null && input.lng != null) {
    const end_address = await reverseGeocode(input.lat, input.lng);
    if (end_address) await supabase.from("vehicle_trips").update({ end_address }).eq("id", trip.id);
  }
  return { ok: true };
}

/**
 * El estado del viaje de quien pregunta, para el panel de Time Tracker (D-136).
 *
 * La pantalla vieja lo calculaba en su componente de servidor. Al traer los viajes a Registrar
 * tiempo hacía falta poder pedirlo desde el cliente — misma consulta, mismas reglas.
 *
 * `mode` decide qué se le ofrece: un **runner** lleva el vehículo de la empresa y se le pide el
 * cuentakilómetros; un **comercial** hace salidas sueltas. Sale de `is_runner`, que se
 * configura por persona, no de lo que la pantalla suponga.
 */
export async function getMyTrip(): Promise<
  | {
      ok: true;
      mode: "runner" | "sales";
      vehicles: { id: string; name: string }[];
      trip: { id: string; startedAt: string; vehicleId: string | null; paused: boolean } | null;
      stops: { id: string; label: string | null; arrivedAt: string; departedAt: string | null }[];
      currentVehicleId: string | null;
      /** Sin fichaje abierto no hay viaje posible: se conduce estando de alta. */
      clockedIn: boolean;
    }
  | { ok: false; message: string }
> {
  const ctx = await authed();
  if (!ctx.ok) return ctx;
  const { supabase, user, profile } = ctx;

  const { data: openRow } = await supabase
    .from("time_entries")
    .select("id")
    .eq("employee_id", user.id)
    .eq("status", "open")
    .maybeSingle();

  const [{ data: veh }, { data: openTrip }] = await Promise.all([
    supabase.from("vehicles").select("id, name").eq("company_id", profile.company_id).eq("active", true).order("name"),
    supabase
      .from("vehicle_trips")
      .select("id, started_at, vehicle_id, paused_at")
      .eq("employee_id", user.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  let stops: { id: string; label: string | null; arrivedAt: string; departedAt: string | null }[] = [];
  if (openTrip) {
    const { data: st } = await supabase
      .from("trip_stops")
      .select("id, label, arrived_at, departed_at")
      .eq("trip_id", openTrip.id as string)
      .order("arrived_at");
    stops = (st ?? []).map((r) => ({
      id: r.id as string,
      label: (r.label as string) ?? null,
      arrivedAt: r.arrived_at as string,
      departedAt: (r.departed_at as string) ?? null,
    }));
  }

  return {
    ok: true,
    mode: profile.is_runner ? "runner" : "sales",
    vehicles: (veh ?? []).map((v) => ({ id: v.id as string, name: v.name as string })),
    trip: openTrip
      ? {
          id: openTrip.id as string,
          startedAt: openTrip.started_at as string,
          vehicleId: (openTrip.vehicle_id as string) ?? null,
          paused: !!openTrip.paused_at,
        }
      : null,
    stops,
    currentVehicleId: (profile.vehicle_id as string) ?? null,
    clockedIn: !!openRow,
  };
}
