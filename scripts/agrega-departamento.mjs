// Añade un departamento a la lista de RR. HH. (recruiting.settings.departments, text[]), si no está ya.
// Es lo mismo que «＋» en Ajustes de RR. HH.; existe para hacerlo desde aquí sin abrir la pantalla.
//
//   node --env-file=.env.local scripts/agrega-departamento.mjs "AI Developer"            → ensayo (ROLLBACK)
//   node --env-file=.env.local scripts/agrega-departamento.mjs "AI Developer" --escribe  → escribe
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");
const nombre = (process.argv[2] ?? "").trim();
const escribe = process.argv.includes("--escribe");
if (!nombre) { console.error('Uso: node --env-file=.env.local scripts/agrega-departamento.mjs "<nombre>" [--escribe]'); process.exit(1); }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin");
const { rows: [antes] } = await c.query(`select departments from recruiting.settings where id = 1`);
if (!antes) { console.error("No hay fila de ajustes (id = 1)."); await c.query("rollback"); await c.end(); process.exit(1); }
console.log("Antes:", antes.departments.join(" · "));
if (antes.departments.includes(nombre)) { console.log(`«${nombre}» ya está. Nada que hacer.`); await c.query("rollback"); await c.end(); process.exit(0); }
const { rows: [despues] } = await c.query(`update recruiting.settings set departments = array_append(departments, $1) where id = 1 returning departments`, [nombre]);
console.log("Después:", despues.departments.join(" · "));
if (escribe) { await c.query("commit"); console.log("ESCRITO."); }
else { await c.query("rollback"); console.log("ENSAYO: nada cambió. Para escribir, el mismo comando con --escribe."); }
await c.end();
