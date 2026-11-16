import { NextResponse } from "next/server";
import { currentAndNextPeriodDates, patternRowsForDates, presetRowsForDates, cleanPattern, type PresetType } from "@/lib/clockin/schedule";
import { clockinRestHeaders } from "@/lib/clockin/rest";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { cerrarSesionesHuerfanas } from "@/lib/timetracker/live-session-cron";
import { pruneDriverLocations } from "@/lib/driver-locations-prune";

// Recurring schedules: once a day, make sure every active non-owner employee
// with a schedule (A/B/C or custom) has their standard shifts laid out for THIS
// week and NEXT week. Idempotent — only inserts what's missing.
//
// Desde D-195 este cron lleva ADEMÁS el cierre de sesiones huérfanas del cronómetro de Time
// Tracker (al final, `orphans` en la respuesta). Va aquí y no en un cron propio porque Vercel
// Hobby admite dos crons y los dos están ocupados; misma hora (08:00 UTC), mismo secreto. La
// regla está en lib/timetracker/live-session.ts y la ruta /timetracker/api/close-orphan-sessions
// la expone también por separado. Un fallo del cierre no tumba el rodado de horarios.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // `?verify=1`: confirma el secreto con 200 sin rodar horarios ni cerrar sesiones (D-195).
  if (new URL(req.url).searchParams.get("verify") === "1") {
    return NextResponse.json({ ok: true, verify: true });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const H = clockinRestHeaders(k);

  const periodDates = currentAndNextPeriodDates(); // this pay week + next (Fri→Thu)

  // Build the work list: each is { emp, wanted-rows }. A/B/C rotate weekly via
  // presetRowsForDates; custom is a fixed pattern.
  type WantRow = { shift_date: string; start_time: string; end_time: string; lunch_minutes: number };
  const work: { emp: { id: string; company_id: string; store_id: string | null }; wanted: WantRow[] }[] = [];

  const preset = await (
    await fetch(
      `${url}/rest/v1/profiles?select=id,company_id,store_id,default_schedule&active=eq.true&role=neq.owner&default_schedule=in.(A,B,C)`,
      { headers: H, cache: "no-store" },
    )
  ).json();
  if (Array.isArray(preset)) {
    for (const e of preset) work.push({ emp: e, wanted: presetRowsForDates(e.default_schedule as PresetType, periodDates) });
  }

  // Custom employees — tolerant: if the custom_schedule column isn't there yet,
  // this simply finds nothing and A/B/C rolling is unaffected.
  try {
    const custom = await (
      await fetch(
        `${url}/rest/v1/profiles?select=id,company_id,store_id,custom_schedule&active=eq.true&role=neq.owner&default_schedule=eq.custom`,
        { headers: H, cache: "no-store" },
      )
    ).json();
    if (Array.isArray(custom)) {
      for (const e of custom) {
        const pattern = cleanPattern(e.custom_schedule);
        if (Object.keys(pattern).length) work.push({ emp: e, wanted: patternRowsForDates(pattern, periodDates) });
      }
    }
  } catch {
    /* custom_schedule column not present yet — ignore */
  }

  // Antes eran dos consultas por empleado (horarios existentes y cancelados) y un POST por empleado. Ahora: UNA consulta
  // de cada para todos (`employee_id=in.(…)`, en las fechas de la semana y la siguiente) y los inserts en lotes. Las
  // claves llevan el empleado, así que ninguno mira los turnos de otro.
  type FilaDeTurno = { employee_id: string; shift_date: string; start_time: string };
  const clave = (id: string, fecha: string, hora: string) => `${id}|${fecha}|${hora}`;
  const fechas = [...new Set(work.flatMap((w) => w.wanted.map((r) => r.shift_date)))];
  const ids = [...new Set(work.map((w) => w.emp.id))];
  const have = new Set<string>();
  const cancelled = new Set<string>();
  if (fechas.length && ids.length) {
    const filtro = `employee_id=in.(${ids.join(",")})&shift_date=in.(${fechas.join(",")})`;
    const [existing, cancels] = await Promise.all([
      fetch(`${url}/rest/v1/scheduled_shifts?select=employee_id,shift_date,start_time&${filtro}`, { headers: H, cache: "no-store" }).then((r) => r.json()),
      fetch(`${url}/rest/v1/shift_cancellations?select=employee_id,shift_date,start_time&${filtro}`, { headers: H, cache: "no-store" }).then((r) => r.json()),
    ]);
    // Si no se pueden leer los turnos existentes, no se inserta nada: sin ellos se duplicarían.
    if (!Array.isArray(existing)) {
      return NextResponse.json({ ok: false, error: "no se pudieron leer los turnos existentes" }, { status: 502 });
    }
    for (const s of existing as FilaDeTurno[]) have.add(clave(s.employee_id, s.shift_date, String(s.start_time).slice(0, 5)));
    // Per-date removals: don't re-create shifts a manager deleted for that date.
    for (const c of (Array.isArray(cancels) ? cancels : []) as FilaDeTurno[]) {
      cancelled.add(clave(c.employee_id, c.shift_date, String(c.start_time).slice(0, 5)));
    }
  }

  const filas: Record<string, unknown>[] = [];
  for (const { emp, wanted } of work) {
    for (const r of wanted) {
      if (have.has(clave(emp.id, r.shift_date, r.start_time)) || cancelled.has(clave(emp.id, r.shift_date, r.start_time))) continue;
      filas.push({ company_id: emp.company_id, employee_id: emp.id, site_id: emp.store_id ?? null, ...r });
    }
  }

  // Lotes de 200: un fallo solo deja fuera su lote, no toda la corrida.
  const TAMANO_LOTE = 200;
  let created = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    const res = await fetch(`${url}/rest/v1/scheduled_shifts`, {
      method: "POST",
      headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify(lote),
    });
    if (res.ok) created += lote.length;
  }

  // Parte B de D-195: sesiones del cronómetro sin latido desde hace más de 15 min, cerradas
  // en su último latido. Aislado con try/catch: si esto falla, los horarios ya rodaron.
  let orphans: Awaited<ReturnType<typeof cerrarSesionesHuerfanas>> | { ok: false; error: string };
  try {
    orphans = await cerrarSesionesHuerfanas({ url, key: k });
  } catch (e) {
    orphans = { ok: false, error: (e as { message?: string })?.message || "unknown error" };
  }
  // G-23 (D-200): poda de driver_locations con la CLAVE DE SERVICIO (k), 90 días por defecto.
  // Aislado igual que el cierre de huérfanas: si falla, los horarios y las huérfanas ya
  // corrieron. Ruta propia para correrla a mano: /api/prune-driver-locations.
  let prune: Awaited<ReturnType<typeof pruneDriverLocations>> | { ok: false; error: string };
  try {
    prune = await pruneDriverLocations({ url, key: k });
  } catch (e) {
    prune = { ok: false, error: (e as { message?: string })?.message || "unknown error" };
  }
  return NextResponse.json({ ok: true, employees: work.length, created, orphans, prune });
}
