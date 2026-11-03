// Precios por tamaño para UN grupo en UNA ronda de Promos (D-812, migración 230), desde la terminal.
//
//   node --env-file=.env.local scripts/promos-precios-por-tamano.mjs "Promo Noviembre" BRO precios.txt            → ensaya (no escribe)
//   node --env-file=.env.local scripts/promos-precios-por-tamano.mjs "Promo Noviembre" BRO precios.txt --escribe  → escribe
//
// `precios.txt`: un tamaño por línea con su precio, como la hoja del dueño («10X64 $ 2.09»). Es lo mismo que hace el botón
// «Precios por tamaño» de la tabla; existe para cargar con `!` sin abrir la app. Escribe SOLO `promo_decisions.price`:
// el estado de lo ya decidido no se toca; una fila nueva nace «pending».
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("pg");

const [ronda, grupo, fichero] = process.argv.slice(2);
const escribe = process.argv.includes("--escribe");
if (!ronda || !grupo || !fichero) { console.error("uso: <ronda> <grupo> <fichero> [--escribe]"); process.exit(2); }
if (!process.env.SUPABASE_DB_URL) { console.error("Falta SUPABASE_DB_URL (usa --env-file=.env.local)."); process.exit(2); }

const precios = {}; const malas = [];
for (const cruda of readFileSync(fichero, "utf8").split(/\r?\n/)) {
  const l = cruda.trim(); if (!l) continue;
  const m = /^(\d{1,3})\s*[xX]\s*(\d{1,3})[\s,;:\t]*\$?\s*(\d+(?:[.,]\d{1,2})?)\s*$/.exec(l);
  if (!m) { malas.push(l); continue; }
  precios[`${m[1]}X${m[2]}`] = Math.round(Number(m[3].replace(",", ".")) * 100) / 100;
}
if (malas.length) console.log(`No se entendieron: ${malas.join(" · ")}`);
const tamanoDe = (size, desc) => {
  const s = String(size ?? "").toUpperCase().replace(/\s+/g, "");
  if (/^\d{1,3}X\d{1,3}$/.test(s)) return s;
  const m = /\b(\d{1,3})\s*X\s*(\d{1,3})\b/i.exec(desc ?? "");
  return m ? `${m[1]}X${m[2]}`.toUpperCase() : null;
};

const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  if (!escribe) await c.query("set default_transaction_read_only = on");
  const r = await c.query("select id, label, closed_at from public.promo_rounds where label = $1 order by uploaded_at desc limit 1", [ronda]);
  if (!r.rows.length) { console.error(`No hay ronda «${ronda}».`); process.exit(1); }
  const { id, closed_at } = r.rows[0];
  if (closed_at) { console.error(`La ronda «${ronda}» está cerrada.`); process.exit(1); }
  const g = await c.query("select 1 from public.stores where promo_group = $1 limit 1", [grupo]).catch(() => ({ rows: [1] }));
  if (!g.rows.length) console.log(`AVISO: ninguna tienda tiene el grupo ${grupo}.`);
  const p = await c.query("select code, size, description from public.promo_products where round_id = $1 order by row_no", [id]);
  const filas = []; const porTamano = {};
  for (const x of p.rows) { const t = tamanoDe(x.size, x.description); if (t && t in precios) { filas.push({ code: x.code, price: precios[t] }); porTamano[t] = (porTamano[t] ?? 0) + 1; } }
  console.log(`Ronda «${ronda}» (${id}) · grupo ${grupo} · ${p.rows.length} productos`);
  for (const [t, precio] of Object.entries(precios)) console.log(`  ${t.padEnd(6)} $${precio.toFixed(2)} → ${porTamano[t] ?? 0} productos`);
  console.log(`Total: ${filas.length} productos reciben precio.`);
  if (!escribe) { console.log("Ensayo: no se escribió nada. Añade --escribe para escribir."); process.exit(0); }
  await c.query("begin");
  let n = 0;
  for (const f of filas) {
    const u = await c.query(
      `insert into public.promo_decisions (round_id, code, group_code, price) values ($1, $2, $3, $4)
       on conflict (round_id, code, group_code) do update set price = excluded.price`, [id, f.code, grupo, f.price]);
    n += u.rowCount;
  }
  await c.query("commit");
  console.log(`Escrito: ${n} filas en promo_decisions (grupo ${grupo}).`);
} finally { await c.end(); }
