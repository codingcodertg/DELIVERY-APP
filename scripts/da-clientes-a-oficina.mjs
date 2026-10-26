// Da la casilla de Clientes a ventas y a toda la oficina (el dueño, 2026-10-26: «damele el acceso a los sales people y a
// todos los de office para que miren el customer app»). Oficina = roles sales, manager y accounting; choferes y almacén no.
// Lo que cada uno ve lo sigue decidiendo la base: la casilla abre el módulo (has_customers_access), el vendedor solo ve
// los suyos y los sin asignar (customers_ve_la_fila, 198) y contabilidad solo lee (customers_can_write es admin, manager
// y sales). Sin --escribe solo enseña a quién se la daría.
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");
const escribe = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const donde = `role in ('sales', 'manager', 'accounting') and not ('customers' = any(coalesce(module_access, '{}')))`;
const faltan = (await c.query(`select id, full_name, role from public.profiles where ${donde} order by role, full_name`)).rows;
console.table(faltan.map(({ full_name, role }) => ({ full_name, role })));
if (escribe) {
  const r = await c.query(`update public.profiles set module_access = array_append(coalesce(module_access, '{}'), 'customers') where ${donde} returning id`);
  console.log(`✓ ${r.rowCount} con acceso a Clientes`);
} else console.log(`${faltan.length} sin acceso. Sin --escribe no se cambia nada.`);
await c.end();
