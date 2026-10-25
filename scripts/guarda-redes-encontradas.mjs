// Carga de una vez (2026-10-25): las redes sociales y el sitio web que se encontraron buscando en la web los clientes
// activos (el dueño: «quiero que tú busques todas las social medias de los customers»; y luego «guarda las redes»).
// Lee un JSON [{id, account, website, socials}] y rellena SOLO lo vacío: el sitio si la fila no tiene, y cada red que
// la fila no tenga ya (no pisa nada escrito a mano).
//   node --env-file=.env.local scripts/guarda-redes-encontradas.mjs <fichero.json>             (ver)
//   node --env-file=.env.local scripts/guarda-redes-encontradas.mjs <fichero.json> --escribe   (hacer; respaldo en D:\CLAUDE\respaldos-db)
import pg from "pg";
import { readFileSync, writeFileSync } from "node:fs";
const fichero = process.argv[2];
const escribe = process.argv.includes("--escribe");
const REDES = ["facebook", "instagram", "youtube", "tiktok", "twitter", "alignable", "linkedin"];
const hallazgos = JSON.parse(readFileSync(fichero, "utf8"));
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
if (!escribe) await c.query("set default_transaction_read_only = on");
const filas = (await c.query(`select id, account, website, socials from erp.customers where id = any($1::bigint[])`, [hallazgos.map((h) => h.id)])).rows;
const porId = new Map(filas.map((f) => [String(f.id), f]));
const cambios = [];
for (const h of hallazgos) {
  const f = porId.get(String(h.id));
  if (!f) { console.log(`  ${h.id} ${h.account}: NO EXISTE`); continue; }
  const socials = { ...(f.socials ?? {}) };
  for (const k of REDES) if (h.socials?.[k] && !socials[k]) socials[k] = h.socials[k];
  const website = f.website || h.website || null;
  if (website === f.website && JSON.stringify(socials) === JSON.stringify(f.socials ?? {})) continue;
  cambios.push({ id: f.id, account: f.account, antes: { website: f.website, socials: f.socials }, website, socials });
  console.log(`  ${f.id} ${f.account}: web ${website ?? "—"} · ${Object.keys(socials).join(", ") || "sin redes"}`);
}
console.log(`filas por cambiar: ${cambios.length} de ${hallazgos.length}`);
if (escribe && cambios.length) {
  const respaldo = `D:/CLAUDE/respaldos-db/redes-antes-de-guardar-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(respaldo, JSON.stringify(cambios.map(({ id, antes }) => ({ id, ...antes })), null, 2));
  console.log("respaldo:", respaldo);
  await c.query("begin");
  let n = 0;
  for (const x of cambios) n += (await c.query(`update erp.customers set website = $2, socials = $3::jsonb where id = $1`, [x.id, x.website, JSON.stringify(x.socials)])).rowCount ?? 0;
  await c.query("commit");
  console.log(`guardadas: ${n}`);
}
await c.end();
