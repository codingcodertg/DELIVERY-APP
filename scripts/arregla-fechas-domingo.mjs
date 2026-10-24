// Barrido de una vez (2026-10-24): las fechas de entrega imposibles que quedaron de antes de D-658 (domingo bloqueado,
// años fuera de [actual−1, actual+2]). El dueño, 2026-10-24, a la lista: «sí a todo».
//
//  - Las órdenes ABIERTAS con fecha del domingo 2026-09-27 (las dejó ahí el cron de D-406, apagado en D-430; su fecha de
//    antes no se guardó: ver la memoria del 2026-09-23) pasan al lunes 2026-09-28. La etapa no se toca.
//  - FU507 (entregada el 2026-10-13, fecha «22026-10-11»): 2026-10-13, el día que se entregó.
//  - FQ112 (creada en agosto de 2026, fecha 2023-08-13): 2026-08-13.
//  - FU573 (para el domingo 2026-12-13): el lunes 2026-12-14.
//
// Sin `--escribe` solo enseña lo que haría. Con `--escribe`: primero guarda en D:\CLAUDE\respaldos-db las fechas de ANTES
// de cada orden, luego cambia la fecha y deja una nota en su historial (order_events), en una transacción, y vuelve a mirar.
//
//   node --env-file=.env.local scripts/arregla-fechas-domingo.mjs             (ver)
//   node --env-file=.env.local scripts/arregla-fechas-domingo.mjs --escribe   (hacer)
import pg from "pg";
import { writeFileSync } from "node:fs";

const escribe = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
if (!escribe) await c.query("set default_transaction_read_only = on");

const FIJAS = { FU507: "2026-10-13", FQ112: "2026-08-13", FU573: "2026-12-14" };
const lee = async () => (await c.query(`
  select id, order_code, stage, delivery_date::text as fecha from deliveries
   where coalesce(is_training, false) = false
     and ((delivery_date = date '2026-09-27' and stage not in ('delivered', 'canceled', 'rejected'))
          or order_code = any($1::text[]))
   order by order_code`, [Object.keys(FIJAS)])).rows;

const filas = await lee();
const plan = filas.map((r) => ({ ...r, nueva: FIJAS[r.order_code] ?? "2026-09-28" })).filter((r) => r.fecha !== r.nueva);
console.log(`órdenes por corregir: ${plan.length}`);
for (const r of plan) console.log(`  ${r.order_code} (${r.stage}): ${r.fecha} → ${r.nueva}`);

if (escribe && plan.length) {
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const respaldo = `D:/CLAUDE/respaldos-db/fechas-antes-del-arreglo-de-domingos-${sello}.json`;
  writeFileSync(respaldo, JSON.stringify(plan.map((r) => ({ id: r.id, order_code: r.order_code, antes: r.fecha, despues: r.nueva })), null, 2));
  console.log("respaldo:", respaldo);
  await c.query("begin");
  let n = 0;
  for (const r of plan) {
    const res = await c.query(`update deliveries set delivery_date = $2::date where id = $1 and delivery_date::text = $3`, [r.id, r.nueva, r.fecha]);
    n += res.rowCount ?? 0;
    await c.query(`insert into order_events (delivery_id, kind, note) values ($1, 'note', $2)`,
      [r.id, `Delivery date corrected ${r.fecha} → ${r.nueva} (impossible date: Sunday or wrong year; cleanup approved by the owner 2026-10-24)`]);
  }
  if (n !== plan.length) { await c.query("rollback"); throw new Error(`se esperaban ${plan.length} filas y fueron ${n}: deshecho`); }
  await c.query("commit");
  const despues = await lee();
  console.log(`corregidas: ${n} · quedan: ${despues.filter((r) => r.fecha !== (FIJAS[r.order_code] ?? "2026-09-28")).length}`);
}
await c.end();
