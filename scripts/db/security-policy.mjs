// El interruptor de la regla de acceso por dispositivo (D-811, migración 229), desde la terminal.
//
//   node --env-file=.env.local scripts/db/security-policy.mjs            → dice cómo está
//   node --env-file=.env.local scripts/db/security-policy.mjs --on       → la enciende
//   node --env-file=.env.local scripts/db/security-policy.mjs --off      → la apaga
//   node --env-file=.env.local scripts/db/security-policy.mjs --web-on   → D-816: la web bloqueada para manager/sales/logistics
//   node --env-file=.env.local scripts/db/security-policy.mjs --web-off  → la web abierta otra vez
//
// Escribe en producción: lo corre el dueño con `!`. Lo mismo que hace el botón de la app Security.
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("pg");

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error("Falta SUPABASE_DB_URL (usa --env-file=.env.local)."); process.exit(2); }
const quiere = process.argv.includes("--on") ? true : process.argv.includes("--off") ? false : null;
const quiereWeb = process.argv.includes("--web-on") ? true : process.argv.includes("--web-off") ? false : null;

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const antes = await c.query("select enforced, web_blocked, changed_at from public.security_policy where id = 1");
  if (!antes.rows.length) { console.error("No hay fila en security_policy: ¿está aplicada la 229?"); process.exit(1); }
  console.log(`Ahora: regla por dispositivo ${antes.rows[0].enforced ? "ENCENDIDA" : "APAGADA"} · web ${antes.rows[0].web_blocked ? "BLOQUEADA" : "abierta"} (desde ${antes.rows[0].changed_at.toISOString()})`);
  if (quiereWeb !== null) {
    await c.query("update public.security_policy set web_blocked = $1, changed_at = now(), changed_by = null where id = 1", [quiereWeb]);
    const d = await c.query("select web_blocked from public.security_policy where id = 1");
    console.log(`Queda: web ${d.rows[0].web_blocked ? "BLOQUEADA para manager, sales, logistics y accounting" : "abierta"}`);
    process.exit(0);
  }
  if (quiere === null) {
    const n = await c.query("select status, count(*)::int as n from public.security_devices group by status order by status");
    for (const r of n.rows) console.log(`  dispositivos ${r.status}: ${r.n}`);
    process.exit(0);
  }
  await c.query("update public.security_policy set enforced = $1, changed_at = now(), changed_by = null where id = 1", [quiere]);
  const despues = await c.query("select enforced from public.security_policy where id = 1");
  console.log(`Queda: ${despues.rows[0].enforced ? "ENCENDIDA" : "APAGADA"}`);
} finally {
  await c.end();
}
