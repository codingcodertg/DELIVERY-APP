// Server-side notification engine: bilingual message catalog + Web Push senders.
// Used by the scheduler (/api/cron) and by event actions (time-off, off-site).
import webpush from "web-push";
import { clockinRestHeaders } from "./rest";

type Lang = "en" | "es";
type P = Record<string, string | number>;

let configured = false;
function ensureVapid() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (pub && priv) {
    webpush.setVapidDetails(subj, pub, priv);
    configured = true;
  }
}

// --- Message catalog (recipient's language) ---
export const MSG: Record<string, { en: (p: P) => string; es: (p: P) => string }> = {
  // employee reminders
  shift_reminder: { en: (p) => `Your shift starts in ${p.n} min.`, es: (p) => `Tu turno empieza en ${p.n} min.` },
  shift_now: { en: () => `Your shift is starting — don't forget to clock in.`, es: () => `Tu turno está empezando — no olvides marcar entrada.` },
  lunch_reminder: { en: (p) => `Lunch break starts in ${p.n} min.`, es: (p) => `Tu almuerzo empieza en ${p.n} min.` },
  not_clocked_in: { en: (p) => `You're ${p.n} min late — don't forget to clock in.`, es: (p) => `Llegas ${p.n} min tarde — no olvides marcar entrada.` },
  shift_ending: { en: (p) => `Your shift ends in ${p.n} min — don't forget to clock out.`, es: (p) => `Tu turno termina en ${p.n} min — no olvides marcar salida.` },
  forgot_clockout: { en: () => `You're still clocked in — did you forget to clock out?`, es: () => `Sigues con entrada marcada — ¿olvidaste marcar salida?` },
  approaching_ot: { en: () => `Heads up — you're approaching overtime this week.`, es: () => `Atención — te estás acercando a horas extra esta semana.` },
  overtime: { en: () => `You're in overtime this week.`, es: () => `Estás en horas extra esta semana.` },
  away_overdue: { en: () => `You're past your expected return time — tap "I'm back" when you return.`, es: () => `Pasaste tu hora de regreso estimada — toca "Ya regresé" al volver.` },
  great_week: { en: (p) => `Great week! On time all ${p.n} days. Keep it up 🎉`, es: (p) => `¡Gran semana! Puntual los ${p.n} días. ¡Sigue así! 🎉` },
  // 8 PM auto clock-out: warning, then the after-the-fact notice.
  still_working: {
    en: () => `Still working? You'll be clocked out automatically at 8:00 PM. Open the app to keep working.`,
    es: () => `¿Sigues trabajando? Se marcará tu salida automáticamente a las 8:00 PM. Abre la app para seguir.`,
  },
  auto_clocked_out: {
    en: () => `You were clocked out automatically at 8:00 PM. If that's wrong, add a note in Daily Notes so your manager can fix it.`,
    es: () => `Se marcó tu salida automáticamente a las 8:00 PM. Si no es correcto, deja una nota en Notas Diarias para que tu gerente lo corrija.`,
  },
  mgr_auto_clocked_out: {
    en: (p) => `${p.name} was clocked out automatically at 8:00 PM — review their hours for today.`,
    es: (p) => `Se marcó la salida de ${p.name} automáticamente a las 8:00 PM — revisa sus horas de hoy.`,
  },
  timeoff_approved: { en: () => `Your time-off request was approved ✅`, es: () => `Tu solicitud de tiempo libre fue aprobada ✅` },
  timeoff_denied: { en: () => `Your time-off request was denied.`, es: () => `Tu solicitud de tiempo libre fue rechazada.` },
  // manager alerts ({name})
  mgr_late: { en: (p) => `${p.name} is ${p.n} min late (hasn't clocked in).`, es: (p) => `${p.name} llegó ${p.n} min tarde (sin marcar entrada).` },
  mgr_forgot_clockout: { en: (p) => `${p.name} is still clocked in past their shift end.`, es: (p) => `${p.name} sigue con entrada marcada después de su turno.` },
  mgr_away_overdue: { en: (p) => `${p.name} is past their expected return time.`, es: (p) => `${p.name} pasó su hora de regreso estimada.` },
  mgr_offsite: { en: (p) => `${p.name} clocked in off-site.`, es: (p) => `${p.name} marcó entrada fuera del sitio.` },
  mgr_offsite_out: { en: (p) => `${p.name} clocked out off-site.`, es: (p) => `${p.name} marcó salida fuera del sitio.` },
  mgr_unscheduled: { en: (p) => `${p.name} clocked in without a scheduled shift.`, es: (p) => `${p.name} marcó entrada sin turno programado.` },
  mgr_other_site: { en: (p) => `${p.name} clocked in at another store.`, es: (p) => `${p.name} marcó entrada en otra tienda.` },
  mgr_other_site_out: { en: (p) => `${p.name} clocked out at another store.`, es: (p) => `${p.name} marcó salida en otra tienda.` },
  mgr_lunch_over: {
    en: (p) => `${p.name} took a ${p.n}-min lunch — ${p.over} min over their ${p.allowed}-min break.`,
    es: (p) => `${p.name} tomó ${p.n} min de almuerzo — ${p.over} min más de sus ${p.allowed} min.`,
  },
  mgr_no_lunch: {
    en: (p) => `${p.name} clocked out without punching a lunch break (${p.allowed} min scheduled).`,
    es: (p) => `${p.name} marcó salida sin registrar almuerzo (${p.allowed} min programados).`,
  },
  mgr_timeoff_request: { en: (p) => `${p.name} requested time off.`, es: (p) => `${p.name} solicitó tiempo libre.` },
  // Payroll close (pay week ends Thursday)
  payroll_verify: {
    en: () => `Pay week ends today — make sure every day is clocked in and out correctly.`,
    es: () => `La semana de pago termina hoy — revisa que marcaste entrada y salida cada día.`,
  },
  mgr_payroll_approve: {
    en: () => `Pay week ended — review your crew's timestamps and approve their hours.`,
    es: () => `Terminó la semana de pago — revisa los horarios de tu equipo y aprueba sus horas.`,
  },
  store_ready: {
    en: (p) => `${p.store} is fully approved and ready for payroll review.`,
    es: (p) => `${p.store} está totalmente aprobado y listo para revisión de nómina.`,
  },
  admin_clocked_in: {
    en: (p) => `${p.name} clocked you IN. If that's not right, tell your manager.`,
    es: (p) => `${p.name} te marcó ENTRADA. Si no es correcto, avísale a tu gerente.`,
  },
  admin_clocked_out: {
    en: (p) => `${p.name} clocked you OUT. If that's not right, tell your manager.`,
    es: (p) => `${p.name} te marcó SALIDA. Si no es correcto, avísale a tu gerente.`,
  },
};

export function notifyText(type: string, lang: Lang, params: P = {}): string {
  const m = MSG[type];
  if (!m) return "";
  return (lang === "es" ? m.es : m.en)(params);
}

export type Sub = { id?: string; endpoint: string; p256dh: string; auth: string };

/** Low-level send to one subscription. Returns whether it's dead (410/404 → delete). */
export async function sendToSub(sub: Sub, payload: { title: string; body: string; url?: string; tag?: string }) {
  ensureVapid();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return { ok: true, gone: false };
  } catch (e) {
    const code = (e as { statusCode?: number })?.statusCode;
    return { ok: false, gone: code === 404 || code === 410 };
  }
}

// --- Service-role REST helpers (for event-driven notifications) ---
function env() {
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, key: process.env.SUPABASE_SERVICE_ROLE_KEY! };
}
async function rest(path: string, init?: RequestInit) {
  const { url, key } = env();
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: clockinRestHeaders(key, (init?.headers ?? {}) as Record<string, string>),
    cache: "no-store",
  });
}
async function subsForEmployees(ids: string[]): Promise<(Sub & { employee_id: string })[]> {
  if (ids.length === 0) return [];
  const inList = ids.join(",");
  const r = await rest(`push_subscriptions?select=id,employee_id,endpoint,p256dh,auth&employee_id=in.(${inList})`);
  return r.ok ? await r.json() : [];
}
async function deleteSub(id: string) {
  await rest(`push_subscriptions?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
async function recordNotification(companyId: string, employeeId: string, type: string, body: string) {
  await rest(`notifications`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ company_id: companyId, employee_id: employeeId, type, message: body }),
  });
}

/** Notify one user in their own language (event-driven). */
export async function pushToUser(userId: string, companyId: string, type: string, params: P = {}) {
  const pr = await rest(`profiles?select=language&id=eq.${userId}`);
  const lang = (pr.ok ? (await pr.json())[0]?.language : "en") === "es" ? "es" : "en";
  const body = notifyText(type, lang, params);
  if (!body) return;
  const subs = await subsForEmployees([userId]);
  for (const s of subs) {
    const r = await sendToSub(s, { title: "RTG Clock-In", body, url: "/clock-in/clock", tag: type });
    if (r.gone && s.id) await deleteSub(s.id);
  }
  await recordNotification(companyId, userId, type, body);
}

/**
 * If every employee-with-hours in a store is now approved for the pay period,
 * tell the owner(s) the store is ready to review. Fires once per store per
 * period (dedup by scanning this period's store_ready notifications).
 */
export async function maybeNotifyStoreReady(companyId: string, storeId: string | null, periodStart: string) {
  if (!storeId) return;
  const periodEnd = new Date(new Date(`${periodStart}T12:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const sr = await rest(`job_sites?select=name&id=eq.${storeId}`);
  const store = sr.ok ? (await sr.json())[0]?.name : null;
  if (!store) return;

  const er = await rest(`profiles?select=id&company_id=eq.${companyId}&store_id=eq.${storeId}&active=eq.true&role=neq.owner`);
  const empRows: { id: string }[] = er.ok ? await er.json() : [];
  if (empRows.length === 0) return;
  const inList = `(${empRows.map((e) => e.id).join(",")})`;

  const teR = await rest(`time_entries?select=employee_id&employee_id=in.${inList}&clock_in_at=gte.${periodStart}T00:00:00Z&clock_in_at=lt.${periodEnd}T00:00:00Z`);
  const withHours = new Set<string>((teR.ok ? await teR.json() : []).map((r: { employee_id: string }) => r.employee_id));
  if (withHours.size === 0) return; // nobody worked — nothing to be "ready"

  const apR = await rest(`timesheet_approvals?select=employee_id&period_start=eq.${periodStart}&employee_id=in.${inList}`);
  const approved = new Set<string>((apR.ok ? await apR.json() : []).map((r: { employee_id: string }) => r.employee_id));
  for (const id of withHours) if (!approved.has(id)) return; // still pending someone

  // Dedup: has this store already been announced ready this period?
  const dupR = await rest(`notifications?select=message&type=eq.store_ready&created_at=gte.${periodStart}T00:00:00Z`);
  const existing: { message: string }[] = dupR.ok ? await dupR.json() : [];
  if (existing.some((n) => String(n.message).includes(store))) return;

  await pushToOwners(companyId, "store_ready", { store });
}

/** Notify all active OWNERS of a company (records in-app for each, pushes to their devices). */
export async function pushToOwners(companyId: string, type: string, params: P = {}, url = "/clock-in/reports") {
  const or = await rest(`profiles?select=id,language&company_id=eq.${companyId}&role=eq.owner&active=eq.true`);
  const owners: { id: string; language: string }[] = or.ok ? await or.json() : [];
  if (owners.length === 0) return;
  const subs = await subsForEmployees(owners.map((o) => o.id));
  for (const o of owners) {
    const lang = (o.language === "es" ? "es" : "en") as Lang;
    const body = notifyText(type, lang, params);
    if (!body) continue;
    await recordNotification(companyId, o.id, type, body);
    for (const s of subs.filter((x) => x.employee_id === o.id)) {
      const r = await sendToSub(s, { title: "RTG Clock-In", body, url, tag: type });
      if (r.gone && s.id) await deleteSub(s.id);
    }
  }
}

/**
 * Notify all active managers/owners of a company, each in their language.
 * Records the in-app notification ONCE per person (not once per device) and
 * pushes to each of their devices.
 */
export async function pushToManagers(companyId: string, type: string, params: P = {}, url = "/clock-in/dashboard") {
  const mr = await rest(`profiles?select=id,language&company_id=eq.${companyId}&role=in.(manager,owner)&active=eq.true`);
  const mgrs: { id: string; language: string }[] = mr.ok ? await mr.json() : [];
  if (mgrs.length === 0) return;
  const subs = await subsForEmployees(mgrs.map((m) => m.id));
  for (const m of mgrs) {
    const lang = (m.language === "es" ? "es" : "en") as Lang;
    const body = notifyText(type, lang, params);
    if (!body) continue;
    await recordNotification(companyId, m.id, type, body); // once per recipient
    for (const s of subs.filter((x) => x.employee_id === m.id)) {
      const r = await sendToSub(s, { title: "RTG Clock-In", body, url, tag: type });
      if (r.gone && s.id) await deleteSub(s.id);
    }
  }
}
