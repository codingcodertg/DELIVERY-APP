// Arreglo de una vez (2026-10-25). El dueño, con la lista de empleados de RR. HH. (0.67.0): «Need to remove Owner label from
// everywhere no exceptions». Medido: no es un rótulo de la app; es el NOMBRE guardado de una ficha de empleado,
// «Jose Perez (Owner)» (recruiting.employee_files), la única fila con «owner» en algún nombre de la base. Se deja «Jose Perez».
//   node --env-file=.env.local scripts/quita-owner-del-nombre.mjs             (ver)
//   node --env-file=.env.local scripts/quita-owner-del-nombre.mjs --escribe   (hacer; guarda antes el nombre viejo en D:\CLAUDE\respaldos-db)
import pg from "pg";
import { writeFileSync } from "node:fs";
const escribe = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
if (!escribe) await c.query("set default_transaction_read_only = on");
const filas = (await c.query(`select id, full_name from recruiting.employee_files where full_name ~* '\(\s*owner\s*\)'`)).rows
  .map((r) => ({ ...r, nuevo: r.full_name.replace(/\s*\(\s*owner\s*\)\s*/i, " ").replace(/\s+/g, " ").trim() }));
for (const r of filas) console.log(`  ${r.id}: «${r.full_name}» → «${r.nuevo}»`);
console.log(`fichas por corregir: ${filas.length}`);
if (escribe && filas.length) {
  const respaldo = `D:/CLAUDE/respaldos-db/nombres-antes-de-quitar-owner-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(respaldo, JSON.stringify(filas, null, 2));
  console.log("respaldo:", respaldo);
  let n = 0;
  for (const r of filas) n += (await c.query(`update recruiting.employee_files set full_name = $2 where id = $1 and full_name = $3`, [r.id, r.nuevo, r.full_name])).rowCount ?? 0;
  console.log(`corregidas: ${n}`);
}
await c.end();
