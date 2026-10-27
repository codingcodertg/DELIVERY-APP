// Marca como pagadas las semanas de Time Tracker (remoto) que tienen horas y no tienen lote de pago, igual que hace
// «Mark paid» en ManagerReports: un lote por semana (timetracker.payrolls, paid = true, total = la suma de sus líneas), y
// las sesiones apuntando a su lote (payroll_id). El dueño, 2026-10-27: «en el time tracker de andres todas las horas que
// estan tracked desde el inicio esas semanas marcalas como approved para que aparezcan los pagos».
//
//   node --env-file=.env.local scripts/paga-semanas-de-time-tracker.mjs careers@rdztilegroup.net            → ensayo
//   node --env-file=.env.local scripts/paga-semanas-de-time-tracker.mjs careers@rdztilegroup.net --escribe  → escribe
//
// La semana es la de Ajustes de Time Tracker (weekStartDay) sobre la FECHA de la sesión, como la pantalla (no `week_of`,
// que quedó con el día de inicio viejo en las sesiones de julio). La semana en curso no se paga. Una sesión que ya tiene
// lote no se toca. El pago sale de la asignación de la sesión (`computePay`: tarifa, extras, tope semanal), que es lo que
// la pantalla calcula. No escribe el talón (paystub): «🧾 Talón» lo construye con el lote al imprimirlo.
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");
pg.types.setTypeParser(1082, (v) => v);
const email = process.argv[2];
const escribe = process.argv.includes("--escribe");
if (!email || !email.includes("@")) { console.error("Uso: node --env-file=.env.local scripts/paga-semanas-de-time-tracker.mjs <correo> [--escribe]"); process.exit(1); }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin");
const { rows: [quien] } = await c.query(`select p.id, p.full_name from public.profiles p join auth.users u on u.id = p.id where u.email = $1`, [email]);
if (!quien) { console.error("No hay perfil con ese correo"); await c.query("rollback"); await c.end(); process.exit(1); }
const { rows: [ajustes] } = await c.query(`select data from timetracker.settings limit 1`).catch(() => ({ rows: [{}] }));
const wsd = Number(ajustes?.data?.weekStartDay ?? 6);
const tz = ajustes?.data?.timeZone ?? "America/Chicago";
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: tz });
const inicioDeSemana = (iso) => { const d = new Date(iso + "T12:00:00Z"); const diff = (d.getUTCDay() - wsd + 7) % 7; d.setUTCDate(d.getUTCDate() - diff); return d.toISOString().slice(0, 10); };
const semanaEnCurso = inicioDeSemana(hoy);

const { rows: asig } = await c.query(`select a.id, a.project_id, a.hourly_rate, a.overtime_rate, a.overtime_threshold, a.weekly_limit, a.payment_method, p.name, p.week_start_day from timetracker.assignments a left join timetracker.projects p on p.id = a.project_id where a.employee_uid = $1`, [quien.id]);
const aMap = new Map(asig.map((a) => [a.id, a]));
const { rows: ses } = await c.query(`select id, assignment_id, date, duration_seconds, is_live, payroll_id from timetracker.sessions where employee_uid = $1 and date is not null order by date`, [quien.id]);
const { rows: lotes } = await c.query(`select week_of, paid, total from timetracker.payrolls where employee_uid = $1 and draft = false order by week_of`, [quien.id]);
const conLote = new Set(lotes.map((l) => l.week_of));

// computePay de helpers.ts, tal cual.
const computePay = (h, a) => {
  const rate = Number(a?.hourly_rate) || 0, otRate = Number(a?.overtime_rate) || rate;
  const otT = a?.overtime_threshold == null ? Infinity : Number(a.overtime_threshold);
  const wL = a?.weekly_limit == null ? Infinity : Number(a.weekly_limit);
  const billable = Math.min(h, wL), reg = Math.min(billable, otT), ot = Math.max(0, billable - otT);
  return { reg, ot, pay: reg * rate + ot * otRate };
};
const semanas = new Map();
for (const s of ses) {
  const a = aMap.get(s.assignment_id);
  const w = inicioDeSemana(s.date); // la semana del proyecto, si la tiene, es la misma que la global aquí (se avisa si no)
  if (a?.week_start_day != null && Number(a.week_start_day) !== wsd) console.log(`AVISO: el proyecto ${a.name} tiene otro inicio de semana (${a.week_start_day}); se usa el global ${wsd}`);
  const g = semanas.get(w) ?? { sesiones: [], porAsig: new Map(), viva: false, yaPagadas: 0 };
  if (s.payroll_id) { g.yaPagadas++; semanas.set(w, g); continue; }
  if (s.is_live) g.viva = true;
  g.sesiones.push(s);
  g.porAsig.set(s.assignment_id ?? "", (g.porAsig.get(s.assignment_id ?? "") ?? 0) + (s.duration_seconds || 0));
  semanas.set(w, g);
}
console.log(`${quien.full_name} · semana empieza el día ${wsd} (0=dom) · hoy ${hoy} · semana en curso ${semanaEnCurso}\n`);
const plan = [];
for (const [w, g] of [...semanas].sort()) {
  const horas = [...g.porAsig.values()].reduce((a, b) => a + b, 0) / 3600;
  let pago = 0; const lineas = [];
  for (const [aid, sec] of g.porAsig) { const a = aMap.get(aid); const cp = computePay(sec / 3600, a); pago += cp.pay; lineas.push(`${a?.name ?? "(sin proyecto)"} ${(sec / 3600).toFixed(1)}h×$${Number(a?.hourly_rate) || 0}${cp.ot ? ` (+${cp.ot.toFixed(1)}h extra)` : ""}`); }
  const motivo = !g.sesiones.length ? "ya pagada" : w === semanaEnCurso || g.viva ? "SEMANA EN CURSO, no se paga" : conLote.has(w) && g.yaPagadas ? "ya tiene lote; estas sesiones quedaron fuera" : null;
  console.log(`${w}  ${g.sesiones.length} ses · ${horas.toFixed(1)} h · $${pago.toFixed(2)}  ${lineas.join(" + ")}  ${motivo ? "→ " + motivo : "→ SE PAGA"}`);
  if (!motivo) plan.push({ w, g, pago: Number(pago.toFixed(2)), metodo: aMap.get(g.sesiones[0].assignment_id)?.payment_method ?? null });
}
console.log(`\n${plan.length} semanas a pagar · $${plan.reduce((a, p) => a + p.pago, 0).toFixed(2)} en total`);
let n = 0;
for (const p of plan) {
  const { rows: [lote] } = await c.query(`insert into timetracker.payrolls (employee_uid, employee_name, week_of, total, adjustments, method, paid, paid_at, paid_by, session_count, draft)
    values ($1, $2, $3, $4, '[]'::jsonb, $5, true, now(), $1, $6, false) returning id`, [quien.id, quien.full_name, p.w, p.pago, p.metodo, p.g.sesiones.length]);
  const r = await c.query(`update timetracker.sessions set payroll_id = $1 where id = any($2::uuid[])`, [lote.id, p.g.sesiones.map((s) => s.id)]);
  n += r.rowCount;
}
if (escribe) { await c.query("commit"); console.log(`ESCRITO: ${plan.length} lotes, ${n} sesiones enlazadas.`); }
else { await c.query("rollback"); console.log(`ENSAYO: ${plan.length} lotes y ${n} sesiones se escribirían. Nada cambió. Para escribir, el mismo comando con --escribe.`); }
await c.end();
