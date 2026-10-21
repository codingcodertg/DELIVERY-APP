// Una vez (2026-10-20): FV146 (la reentrega de FV115 creada como orden nueva) pasa a ser «FV115 b», y FV115 a «FV115 a».
// Ensayo por defecto; --escribe para aplicar. El dueño: «no me creó la orden como FV115 A y B».
import pg from "pg";
const ESCRIBE = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
const { rows } = await c.query("select id, order_code, order_no, order_suffix, stage, est_pallets, actual_pallets, redelivery_of, is_training from public.deliveries where order_code in ('FV115','FV146') order by order_code");
for (const r of rows) console.log(JSON.stringify(r));
const madre = rows.find((r) => r.order_code === "FV115"), hija = rows.find((r) => r.order_code === "FV146");
if (!madre || !hija || hija.redelivery_of !== madre.id || madre.order_suffix || hija.order_suffix) { console.log("no es el caso esperado; nada"); await c.end(); process.exit(0); }
console.log(`PLAN: FV146 (#${hija.order_no}) → FV115 b (#${madre.order_no}); FV115 → FV115 a`);
if (ESCRIBE) {
  await c.query("begin");
  await c.query("update public.deliveries set order_code = 'FV115', order_no = $1, order_suffix = 'b' where id = $2", [madre.order_no, hija.id]);
  await c.query("update public.deliveries set order_suffix = 'a' where id = $1", [madre.id]);
  await c.query("insert into public.order_events (delivery_id, kind, note) values ($1, 'note', 'Re-delivery relabeled as #FV115b (was #FV146): same order, load b'), ($2, 'note', 'Relabeled as #FV115a: its re-delivery is load b')", [hija.id, madre.id]);
  await c.query("commit");
  const { rows: d } = await c.query("select order_code, order_no, order_suffix, stage from public.deliveries where id = any($1) order by order_suffix", [[madre.id, hija.id]]);
  console.log("ESCRITO:", JSON.stringify(d));
} else console.log("ENSAYO: nada escrito.");
await c.end();
