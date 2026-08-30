"use server";

import { createClient, isSupabaseConfigured } from "@/lib/clockin/supabase/server";
import { centralDateStr, payPeriodDates } from "@/lib/clockin/schedule";
import { attachLunch, type LunchRow } from "@/lib/clockin/payroll";
import { scoreWeek, longLunchesByEmployee } from "@/lib/clockin/scorecard";

/**
 * Lo que un empleado ve **de sí mismo**: su horario, sus notas y su boletín (D-129).
 *
 * Estas tres cosas eran tres pantallas del módulo de fichaje. Ahora se abren desplegadas
 * dentro de Registrar tiempo, sin salir: era el último motivo para tener que ir allí, y el
 * objetivo es poder retirar aquel módulo entero.
 *
 * Cada una se pide **al abrirla**, no al cargar la pantalla. Son datos que la mayoría no mira
 * cada vez que ficha, y cobrárselos a todo el mundo en cada carga solo haría más lento lo que
 * sí se usa siempre, que es el botón de fichar.
 */

async function yo() {
  if (!isSupabaseConfigured) return { ok: false as const, message: "Not configured." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Not signed in." };
  return { ok: true as const, supabase, user };
}

// ---------------------------------------------------------------------------
// Mi horario
// ---------------------------------------------------------------------------
export type MiHorario = {
  week: string[];
  shifts: { shift_date: string; start_time: string; end_time: string; lunch_minutes: number; site: string | null }[];
  /** Días que el encargado ya aprobó libres, para que no parezca que faltó. */
  off: { type: string; start_date: string; end_date: string }[];
};

export async function getMySchedule(): Promise<{ ok: true; data: MiHorario } | { ok: false; message: string }> {
  const ctx = await yo();
  if (!ctx.ok) return ctx;
  // La semana de PAGO, no la natural: es la que usa el horario que le arma su encargado, y
  // tener dos ventanas fue justo lo que hizo que "esta semana" no cuadrara (D-128).
  const week = payPeriodDates();

  const [{ data: shiftRows }, { data: sites }, { data: offRows }] = await Promise.all([
    ctx.supabase
      .from("scheduled_shifts")
      .select("shift_date, start_time, end_time, lunch_minutes, site_id")
      .eq("employee_id", ctx.user.id)
      .gte("shift_date", week[0])
      .lte("shift_date", week[6]),
    ctx.supabase.from("job_sites").select("id, name"),
    ctx.supabase
      .from("time_off_requests")
      .select("type, start_date, end_date")
      .eq("employee_id", ctx.user.id)
      .eq("status", "approved")
      .lte("start_date", week[6])
      .gte("end_date", week[0]),
  ]);

  const nombre = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));
  return {
    ok: true,
    data: {
      week,
      shifts: (shiftRows ?? []).map((s) => ({
        shift_date: s.shift_date as string,
        start_time: s.start_time as string,
        end_time: s.end_time as string,
        lunch_minutes: (s.lunch_minutes as number) ?? 0,
        site: s.site_id ? (nombre.get(s.site_id as string) ?? null) : null,
      })),
      off: (offRows ?? []).map((o) => ({
        type: o.type as string,
        start_date: o.start_date as string,
        end_date: o.end_date as string,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Mis notas
// ---------------------------------------------------------------------------
export async function getMyNotes(): Promise<
  { ok: true; notes: { id: string; note: string; created_at: string }[] } | { ok: false; message: string }
> {
  const ctx = await yo();
  if (!ctx.ok) return ctx;
  const { data, error } = await ctx.supabase
    .from("notes_log")
    .select("id, note, created_at")
    .eq("employee_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    notes: (data ?? []).map((n) => ({
      id: n.id as string,
      note: (n.note as string) ?? "",
      created_at: n.created_at as string,
    })),
  };
}

// ---------------------------------------------------------------------------
// Mi boletín
// ---------------------------------------------------------------------------
export type MiBoletin = {
  desde: string;
  onTimeDays: number;
  lateCount: number;
  lateMinTotal: number;
  earlyDepartures: number;
  missed: number;
  workedMins: number;
  longLunches: number;
};

export async function getMyScorecard(): Promise<{ ok: true; data: MiBoletin } | { ok: false; message: string }> {
  const ctx = await yo();
  if (!ctx.ok) return ctx;
  // Desde el principio del mes, como la pantalla que sustituye: un boletín de una semana
  // sube y baja con cualquier día suelto y deja de significar nada.
  const desde = centralDateStr().slice(0, 8) + "01";

  const [{ data: shiftRows }, { data: entryRows }, { data: lunchRows }] = await Promise.all([
    ctx.supabase
      .from("scheduled_shifts")
      .select("employee_id, shift_date, start_time, end_time, lunch_minutes")
      .eq("employee_id", ctx.user.id)
      .gte("shift_date", desde)
      .lte("shift_date", centralDateStr()),
    ctx.supabase
      .from("time_entries")
      .select("id, employee_id, clock_in_at, clock_out_at")
      .eq("employee_id", ctx.user.id)
      .gte("clock_in_at", desde + "T00:00:00Z"),
    ctx.supabase
      .from("exceptions")
      .select("employee_id, time_entry_id, left_at, returned_at")
      .eq("employee_id", ctx.user.id)
      .eq("reason", "lunch")
      .gte("created_at", desde + "T00:00:00Z"),
  ]);

  const entradas = attachLunch(
    (entryRows ?? []) as { id: string; employee_id: string; clock_in_at: string; clock_out_at: string | null; punched_lunch_min?: number | null }[],
    (lunchRows ?? []) as LunchRow[],
  );
  const s = scoreWeek(shiftRows ?? [], entradas).get(ctx.user.id) ?? {
    onTimeDays: 0, lateCount: 0, lateMinTotal: 0, earlyDepartures: 0, clockedInEarly: 0, missed: 0, workedMins: 0,
  };
  return {
    ok: true,
    data: {
      desde,
      onTimeDays: s.onTimeDays,
      lateCount: s.lateCount,
      lateMinTotal: s.lateMinTotal,
      earlyDepartures: s.earlyDepartures,
      missed: s.missed,
      workedMins: s.workedMins,
      longLunches: longLunchesByEmployee(lunchRows ?? []).get(ctx.user.id) ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Mis notificaciones
// ---------------------------------------------------------------------------
export async function getMyNotifications(): Promise<
  | { ok: true; items: { id: string; type: string; message: string; read: boolean; created_at: string }[] }
  | { ok: false; message: string }
> {
  const ctx = await yo();
  if (!ctx.ok) return ctx;
  const { data, error } = await ctx.supabase
    .from("notifications")
    .select("id, type, message, read, created_at")
    .eq("employee_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    items: (data ?? []).map((n) => ({
      id: n.id as string,
      type: (n.type as string) ?? "",
      message: (n.message as string) ?? "",
      read: !!n.read,
      created_at: n.created_at as string,
    })),
  };
}

/** Solo para el contador de la campana: no trae los textos, solo cuántos faltan por leer. */
export async function countUnread(): Promise<number> {
  const ctx = await yo();
  if (!ctx.ok) return 0;
  const { count } = await ctx.supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", ctx.user.id)
    .eq("read", false);
  return count ?? 0;
}
