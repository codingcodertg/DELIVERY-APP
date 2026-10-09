// Aplica UNA migración en producción, en una transacción (BEGIN/COMMIT; ROLLBACK si falla).
// Se corre desde la raíz del repo, con el SÍ del dueño y respaldo hecho antes:
//   node docs/orquestador/apply_one.mjs supabase/migrations/NNN_nombre.sql
// Lee SUPABASE_DB_URL de .env.local. Se niega si el .sql trae su propio BEGIN/COMMIT (ver la memoria
// «migracion-sin-transaccion-propia»): el commit de dentro cerraría la transacción de fuera.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)(process.cwd() + "/node_modules/pg");
const raw = readFileSync(".env.local", "utf8");
for (const line of raw.split("\n")) { const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue; const i = t.indexOf("="); process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, ""); }
const file = process.argv[2];
const sql = readFileSync(file, "utf8");
if (/^\s*(begin|commit|rollback|start\s+transaction)\s*;/im.test(sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n"))) { console.log("EL SQL CONTROLA LA TRANSACCION: no se aplica"); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try { await c.query("begin"); await c.query(sql); await c.query("commit"); console.log("APLICADA", file); }
catch (e) { await c.query("rollback"); console.log("FALLO, revertida:", file, "→", e.message); process.exitCode = 1; }
await c.end();
