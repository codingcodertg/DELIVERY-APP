// Quita la casilla de Clientes a todos menos los admins (el dueño, 2026-10-27: «quitale el customer view a todo solo admin
// lo puede ver»). Deshace scripts/da-clientes-a-oficina.mjs y también a los 10 vendedores que la tenían desde D-683.
// El admin no necesita la casilla (has_customers_access lo deja pasar por rol). Sin --escribe solo enseña.
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");
const escribe = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const donde = `role <> 'admin' and 'customers' = any(coalesce(module_access, '{}'))`;
const tienen = (await c.query(`select full_name, role from public.profiles where ${donde} order by role, full_name`)).rows;
console.table(tienen);
if (escribe) {
  const r = await c.query(`update public.profiles set module_access = array_remove(module_access, 'customers') where ${donde} returning id`);
  console.log(`✓ ${r.rowCount} sin acceso a Clientes`);
} else console.log(`${tienen.length} con acceso que no son admin. Sin --escribe no se cambia nada.`);
await c.end();
