// Junta los expedientes repetidos de RR. HH. (2026-10-26, «hay varios usuario repetidos»).
// Cada persona con cuenta tenía dos: el que el trigger de la 106 creó vacío al nacer la cuenta (id = profile_id, sin
// campos ni papeles) y el de la importación del 16-sep, con los datos pero sin cuenta. Se borra el vacío y el de los
// datos queda enlazado a la cuenta. Solo pares con el MISMO nombre, el vacío de verdad vacío y sin papeles.
// Sin --escribe solo enseña; con --escribe guarda un respaldo en D:\CLAUDE\respaldos-db y lo hace en una transacción.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const pg = createRequire(import.meta.url)("pg");
const escribe = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const pares = (await c.query(`
  with f as (
    select ef.*, coalesce(nullif(trim(ef.full_name), ''), p.full_name) nombre,
      (select count(*) from recruiting.employee_docs d where d.employee_id = ef.id)::int docs,
      (select count(*) from recruiting.user_creation_requests r where r.employee_file_id = ef.id)::int pedidos,
      (select count(*) from jsonb_each(to_jsonb(ef) - 'id' - 'profile_id' - 'updated_at' - 'full_name') e
        where e.value not in ('null', '""', '[]', '{}'))::int campos
    from recruiting.employee_files ef left join public.profiles p on p.id = ef.profile_id)
  select v.id vacio, v.profile_id cuenta, d.id datos, d.nombre, v.pedidos
  from f v join f d on lower(trim(v.nombre)) = lower(trim(d.nombre))
  where v.profile_id is not null and v.id = v.profile_id and v.campos = 0 and v.docs = 0
    and d.profile_id is null
    and (select count(*) from f x where lower(trim(x.nombre)) = lower(trim(v.nombre))) = 2
  order by d.nombre`)).rows;
console.table(pares);
if (!escribe) { console.log(`${pares.length} pares. Sin --escribe no se cambia nada.`); await c.end(); process.exit(0); }
const todo = (await c.query(`select * from recruiting.employee_files where id = any($1)`, [[...pares.flatMap((p) => [p.vacio, p.datos]), "69d1a91a-93ed-430b-8c02-190405c3edaf", "acf43ad5-a937-419b-980c-ef57d45b67c6"]])).rows;
const ruta = `D:/CLAUDE/respaldos-db/expedientes-repetidos-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(ruta, JSON.stringify(todo, null, 1));
console.log("respaldo:", ruta);
await c.query("begin");
try {
  for (const p of pares) {
    const b = await c.query(`delete from recruiting.employee_files where id = $1 and profile_id = $2 returning id`, [p.vacio, p.cuenta]);
    const u = await c.query(`update recruiting.employee_files set profile_id = $1 where id = $2 and profile_id is null returning id`, [p.cuenta, p.datos]);
    if (b.rowCount !== 1 || u.rowCount !== 1) throw new Error(`${p.nombre}: borrados ${b.rowCount}, enlazados ${u.rowCount}`);
    console.log("✓", p.nombre);
  }
  // Andrés Ugarte (el dueño, 2026-10-26): «combina las 2 accounts y solo deja la de carers y la personal la pones en email
  // personal para expediente». La de Gmail (logistics, nunca entró) se borra con su expediente vacío; su correo queda
  // como correo personal en el expediente de la cuenta de careers. Lo que cuelga de ella (43 avisos, 3 mensajes de chat
  // recibidos) se va en cascada; nada más la referencia (medido el 2026-10-26).
  const GMAIL = "69d1a91a-93ed-430b-8c02-190405c3edaf", CAREERS = "acf43ad5-a937-419b-980c-ef57d45b67c6";
  const g = await c.query(`select id from auth.users where id = $1 and email = 'andresugarte000@gmail.com' and last_sign_in_at is null`, [GMAIL]);
  if (g.rowCount === 1) {
    const ex = await c.query(`delete from recruiting.employee_files where id = $1 and profile_id = $1
      and not exists (select 1 from recruiting.employee_docs d where d.employee_id = $1) returning id`, [GMAIL]);
    const pe = await c.query(`update recruiting.employee_files set personal_email = 'andresugarte000@gmail.com'
      where profile_id = $1 and personal_email is null returning id`, [CAREERS]);
    const us = await c.query(`delete from auth.users where id = $1 returning id`, [GMAIL]);
    if (ex.rowCount !== 1 || pe.rowCount !== 1 || us.rowCount !== 1) throw new Error(`Andrés: expediente ${ex.rowCount}, correo ${pe.rowCount}, cuenta ${us.rowCount}`);
    console.log("✓ Andrés Ugarte: queda careers@, la de Gmail como correo personal");
  }
  await c.query("commit");
} catch (e) { await c.query("rollback"); console.error("NADA CAMBIÓ:", e.message); process.exitCode = 1; }
await c.end();
