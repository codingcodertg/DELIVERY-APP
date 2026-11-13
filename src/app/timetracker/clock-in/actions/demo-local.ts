// Modo demo (NEXT_PUBLIC_LOCAL_MODE=true): las acciones del servidor de fichaje que las pantallas de Nómina,
// Horario, Mis secciones, Semana del empleado, Geocercas y Viajes llaman directamente. Sin sesión devolverían
// «Not signed in»; en modo demo devuelven la misma forma con datos INVENTADOS de `demo-data.ts`. No escriben
// nada y no tocan la base. Este archivo NO es «use server»: solo lo importan las acciones, que lo ramifican
// con `if (LOCAL_MODE)` como la pantalla de Nómina (payroll/page.tsx).
import { DEMO_EMPLOYEES } from "@/lib/timetracker/demo-data";
import type { PayEntry } from "@/lib/clockin/payroll";
import { payPeriodDates } from "@/lib/clockin/schedule";

const DIA_MS = 86_400_000;
const hoyISO = () => new Date().toISOString().slice(0, 10);
/** Un día de la semana de pago, a las 08:00 (hora central = 14:00 UTC en noviembre). */
const enHora = (dia: string, hh: number, mm: number) => `${dia}T${String(hh + 6).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;

/** Las tiendas demo: cada presencial tiene la suya (su «tienda» en la semilla). */
const SITIOS = [
  { id: "s-mcallen", name: "McAllen Store", latitude: 26.2034, longitude: -98.23, radius_meters: 150, padding_meters: 25 },
  { id: "s-pharr", name: "Pharr Warehouse", latitude: 26.1948, longitude: -98.1836, radius_meters: 150, padding_meters: 25 },
  { id: "s-edinburg", name: "Edinburg Office", latitude: 26.3017, longitude: -98.1633, radius_meters: 120, padding_meters: 0 },
];
const SITIO_DE: Record<string, string> = { "u-carla": "s-mcallen", "u-pedro": "s-pharr", "u-lucia": "s-edinburg" };
const presenciales = () => DEMO_EMPLOYEES.filter((e) => e.workerType === "inhouse");
const semana = (periodStart?: string) => payPeriodDates(periodStart && /^\d{4}-\d{2}-\d{2}$/.test(periodStart) ? new Date(`${periodStart}T12:00:00Z`) : new Date());
const diasHastaHoy = (dias: string[]) => dias.filter((d) => d <= hoyISO());

/** Fichajes de los presenciales, de lunes a viernes de la semana (solo los días ya pasados o de hoy). */
function fichajesDeLaSemana(dias: string[]): PayEntry[] {
  return presenciales().flatMap((e) =>
    diasHastaHoy(dias.slice(0, 5)).map((d) => ({
      id: `fd-${e.id}-${d}`,
      employee_id: e.id,
      clock_in_at: enHora(d, 8, 0),
      clock_out_at: enHora(d, 16, 30),
      lunch_minutes: 30,
      status: "closed",
      manual: false,
      edit_note: null,
    })),
  );
}
const minutosDe = (e: PayEntry) => (new Date(e.clock_out_at ?? e.clock_in_at).getTime() - new Date(e.clock_in_at).getTime()) / 60000 - (e.lunch_minutes ?? 0);

export function demoPayrollPeriod(periodStart: string) {
  const dias = semana(periodStart);
  const entries = fichajesDeLaSemana(dias);
  const gente = DEMO_EMPLOYEES.filter((e) => entries.some((x) => x.employee_id === e.id) || e.workerType === "remote");
  return {
    ok: true as const,
    signedOff: false,
    isOwner: true,
    approved: [] as string[],
    people: gente.map((e) => ({
      id: e.id, name: e.fullName, store: SITIO_DE[e.id] ?? null,
      scheduledMin: e.workerType === "inhouse" ? 2400 : 0, remote: e.workerType === "remote",
    })),
    stores: SITIOS.map((s) => ({ key: s.id, name: s.name })),
    entries,
  };
}

export function demoScheduleWeek(periodStart?: string) {
  const week = semana(periodStart);
  return {
    ok: true as const,
    week,
    people: DEMO_EMPLOYEES.map((e) => ({
      id: e.id, full_name: e.fullName, default_schedule: null, store_id: SITIO_DE[e.id] ?? null, custom_schedule: null,
    })),
    sites: SITIOS.map((s) => ({ id: s.id, name: s.name })),
    shifts: presenciales().flatMap((e) =>
      week.slice(0, 5).map((d) => ({
        id: `sh-${e.id}-${d}`, employee_id: e.id, shift_date: d, start_time: "08:00:00", end_time: "16:30:00",
        lunch_minutes: 30, site_id: SITIO_DE[e.id] ?? null,
      })),
    ),
  };
}

export function demoEmployeeWeek(employeeId: string, periodStart?: string) {
  const period = semana(periodStart);
  const punches = fichajesDeLaSemana(period).filter((e) => e.employee_id === employeeId).map((e) => ({
    id: e.id, clockInAt: e.clock_in_at, clockOutAt: e.clock_out_at, minutes: Math.round(minutosDe(e)), onSite: true, manual: false,
  }));
  const totalMin = punches.reduce((a, p) => a + p.minutes, 0);
  return {
    ok: true as const, period, punches, breaks: [] as { id: string; reason: string; leftAt: string; returnedAt: string | null; minutes: number }[],
    totalMin, lunchMin: punches.length * 30, outMin: 0,
  };
}

export function demoMiHorario() {
  const week = semana();
  return {
    ok: true as const,
    data: {
      week,
      shifts: week.slice(0, 5).map((d) => ({ shift_date: d, start_time: "09:00:00", end_time: "17:00:00", lunch_minutes: 60, site: "McAllen Store" })),
      off: [] as { type: string; start_date: string; end_date: string }[],
    },
  };
}

export function demoMisNotas() {
  const ahora = Date.now();
  return {
    ok: true as const,
    notes: [
      { id: "n-1", note: "Llegué tarde por la lluvia; avisé al gerente.", created_at: new Date(ahora - 2 * DIA_MS).toISOString() },
      { id: "n-2", note: "Cambié el almuerzo a 45 min con permiso.", created_at: new Date(ahora - DIA_MS).toISOString() },
    ],
  };
}

export function demoBoletin() {
  return {
    ok: true as const,
    data: {
      desde: hoyISO().slice(0, 8) + "01", onTimeDays: 9, lateCount: 1, lateMinTotal: 12, earlyDepartures: 0,
      missed: 0, workedMins: 2340, longLunches: 1,
    },
  };
}

export function demoGeofences() {
  return {
    ok: true as const,
    sites: SITIOS.map((s, i) => ({
      id: s.id, name: s.name, active: i !== 2,
      latitude: s.latitude, longitude: s.longitude, radius_meters: s.radius_meters, padding_meters: s.padding_meters,
      boundary: null,
    })),
  };
}

export function demoMyTrip() {
  const ahora = Date.now();
  return {
    ok: true as const,
    mode: "runner" as const,
    vehicles: [{ id: "v-1", name: "Van 1 · Ford Transit" }, { id: "v-2", name: "Pickup 2" }],
    trip: { id: "t-1", startedAt: new Date(ahora - 2 * 3600_000).toISOString(), vehicleId: "v-1", paused: false, startOdometer: 81250 },
    stops: [
      { id: "st-1", label: "Cliente Norte", arrivedAt: new Date(ahora - 90 * 60_000).toISOString(), departedAt: new Date(ahora - 60 * 60_000).toISOString() },
      { id: "st-2", label: "Bodega Pharr", arrivedAt: new Date(ahora - 30 * 60_000).toISOString(), departedAt: null },
    ],
    currentVehicleId: "v-1",
    clockedIn: true,
  };
}

export function demoMyDay() {
  const ahora = Date.now();
  const entrada = new Date(ahora - 2 * 3600_000).toISOString();
  const semana = payPeriodDates();
  return {
    ok: true as const,
    companyId: "demo",
    userId: "u-admin",
    open: { id: "fd-hoy", clockInAt: entrada },
    leave: null,
    shift: { start: "08:00", end: "16:30", lunch: 30, site: "McAllen Store" },
    scheduledMinutes: 2400,
    scheduledDays: 5,
    periodStart: semana[0],
    periodEnd: semana[6],
    today: [{ id: "fd-hoy", clockInAt: entrada, clockOutAt: null, minutes: 120 }],
    breaks: [] as { id: string; reason: string; leftAt: string; returnedAt: string | null; minutes: number }[],
    lunchMinutes: 0,
    outMinutes: 0,
    todayMinutes: 120,
    weekMinutes: 120,

  };
}
