// Reparto de una vez (D-683, 2026-10-25): el VENDEDOR de cada cliente (`erp.customers.rep_id`, 198) a partir de las
// iniciales de QuickBooks de la fila (`rep_store`; si está vacío, `rep_qb`). El dueño, con la hoja de vendedores: «aquí
// están, así que asígnalos y me dices si quedaron algunos». Las iniciales de la hoja → el nombre del perfil del hub.
// También da la casilla del módulo «Clientes» a esos perfiles (sin ella no entran).
//   node --env-file=.env.local scripts/asigna-vendedores.mjs             (ver: cuántos por vendedor y qué iniciales quedan sin dueño)
//   node --env-file=.env.local scripts/asigna-vendedores.mjs --escribe   (hacer; guarda antes rep_id y module_access en D:\CLAUDE\respaldos-db)
// Solo toca filas SIN vendedor (rep_id null): repetirlo no pisa un reparto hecho a mano.
import pg from "pg";
import { writeFileSync } from "node:fs";

/** La hoja del dueño (2026-10-25): iniciales de QB → nombre del perfil. */
const INICIALES = {
  ZR: "Zulema Resendez", RMC: "Roberto Contreras", MR: "Melecio Rodriguez", EP: "Everto Prado", FR: "Francisca Reyes",
  PCC: "Pablo Castilla", SCG: "Santa Garza", AF: "Magaly Falcon", KG: "Kevin Gonzalez", MGM: "Melissa Garza",
};

const escribe = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
if (!escribe) await c.query("set default_transaction_read_only = on");

const perfiles = (await c.query(`select id, full_name, module_access from public.profiles where role = 'sales'`)).rows;
const porNombre = new Map(perfiles.map((p) => [p.full_name.trim().toLowerCase(), p]));
const vendedorDe = {};
for (const [ini, nombre] of Object.entries(INICIALES)) {
  const p = porNombre.get(nombre.toLowerCase());
  if (!p) { console.log(`SIN PERFIL de vendedor: ${ini} → ${nombre}`); continue; }
  vendedorDe[ini] = p;
}

const filas = (await c.query(`
  select id, store, account, coalesce(nullif(upper(btrim(rep_store)), ''), nullif(upper(btrim(rep_qb)), '')) as ini
  from erp.customers where archived_at is null and rep_id is null order by id`)).rows;
const asignar = filas.filter((f) => f.ini && vendedorDe[f.ini]);
const porVendedor = {};
for (const f of asignar) porVendedor[vendedorDe[f.ini].full_name] = (porVendedor[vendedorDe[f.ini].full_name] ?? 0) + 1;
const sinDueno = {};
for (const f of filas) if (f.ini && !vendedorDe[f.ini]) sinDueno[f.ini] = (sinDueno[f.ini] ?? 0) + 1;
console.log("por vendedor:", JSON.stringify(porVendedor));
console.log(`a asignar: ${asignar.length} de ${filas.length} filas sin vendedor; sin iniciales: ${filas.filter((f) => !f.ini).length}`);
console.log("iniciales SIN vendedor en la hoja:", JSON.stringify(Object.fromEntries(Object.entries(sinDueno).sort((a, b) => b[1] - a[1]))));
const sinCasilla = Object.values(vendedorDe).filter((p) => !(p.module_access ?? []).includes("customers"));
console.log(`perfiles a los que dar la casilla «customers»: ${sinCasilla.map((p) => p.full_name).join(", ") || "ninguno"}`);

if (escribe) {
  const respaldo = `D:/CLAUDE/respaldos-db/vendedores-antes-de-asignar-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(respaldo, JSON.stringify({ filas: asignar.map((f) => ({ id: f.id, rep_id: null, ini: f.ini })), perfiles: sinCasilla.map((p) => ({ id: p.id, module_access: p.module_access })) }, null, 2));
  console.log("respaldo:", respaldo);
  await c.query("begin");
  let n = 0;
  for (const [ini, p] of Object.entries(vendedorDe)) {
    const ids = asignar.filter((f) => f.ini === ini).map((f) => f.id);
    if (!ids.length) continue;
    n += (await c.query(`update erp.customers set rep_id = $1 where id = any($2::bigint[]) and rep_id is null`, [p.id, ids])).rowCount ?? 0;
  }
  let m = 0;
  for (const p of sinCasilla) {
    m += (await c.query(`update public.profiles set module_access = array_append(coalesce(module_access, '{}'), 'customers') where id = $1 and not ('customers' = any(coalesce(module_access, '{}')))`, [p.id])).rowCount ?? 0;
  }
  await c.query("commit");
  console.log(`asignadas: ${n}; casillas dadas: ${m}`);
}
await c.end();
