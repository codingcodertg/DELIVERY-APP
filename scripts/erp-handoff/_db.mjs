// Conexión directa a Postgres (SUPABASE_DB_URL de .env.local), igual que scripts/db/aplica-migracion.mjs.
// `pg` es devDependency: herramienta de operación, no entra en el bundle del cliente.
import pg from "pg";

export async function conecta() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("Falta SUPABASE_DB_URL (node --env-file=.env.local …)");
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}

/** Actúa como un usuario concreto dentro de la transacción: auth.uid() y erp.current_app_role() leen esto. */
export async function actuaComo(c, userId) {
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

/** Id del perfil del admin que firma (por defecto ANDRES UGARTE; --actor=<uuid> lo cambia). */
export async function adminActor(c, flagUuid) {
  const r = flagUuid
    ? await c.query("select id, full_name, erp_role from public.profiles where id = $1", [flagUuid])
    : await c.query("select id, full_name, erp_role from public.profiles where full_name ilike '%ugarte%' and erp_role = 'admin' order by full_name limit 2");
  if (r.rows.length !== 1) throw new Error(`Actor no único/no hallado: ${JSON.stringify(r.rows)}`);
  if (r.rows[0].erp_role !== "admin") throw new Error(`El actor ${r.rows[0].full_name} no es admin del ERP`);
  return r.rows[0];
}

export const flags = (argv = process.argv.slice(2)) => ({
  escribe: argv.includes("--escribe"),
  actor: (argv.find((a) => a.startsWith("--actor=")) || "").slice(8) || null,
});
