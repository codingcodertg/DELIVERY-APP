// Cruza con Clientes los leads que aun no tienen cruce, de CUALQUIER fuente (D-792, 2026-11-01). El dueno: «lo mismo que
// haces de recognize en el STXP pool de los clientes, aplicamelo en el pool del government».
//
//   node --env-file=.env.local scripts/leads/cruza-con-clientes.mjs            → ensayo (ROLLBACK), cuenta y ejemplos
//   node --env-file=.env.local scripts/leads/cruza-con-clientes.mjs --escribe  → escribe customer_match_id/_note/_matched_at
//
// Misma regla que el importador privado (218): telefono de 10 digitos igual al del cliente o al de uno de sus contactos; si
// no, nombre clave igual. Del lead se miran owner_phone y tenant_phone, y owner_name, tenant_name y owner_contact. Solo toca
// filas con customer_match_id nulo. El importador del GOV Pool (importa-leads.mjs) hace esto mismo al terminar de cargar;
// este guion es para pasarlo a mano (p. ej. tras importar clientes nuevos).
import { createRequire } from "node:module";
import { cruzaSinCruce } from "./importa-leads-privado.mjs";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const escribe = process.argv.includes("--escribe");

if (!process.env.SUPABASE_DB_URL) { console.error("falta SUPABASE_DB_URL (node --env-file=.env.local …)"); process.exit(1); }
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
await c.query("begin");
const r = await cruzaSinCruce(c);
console.log(`Leads sin cruce: ${r.sinCruce} · ahora coinciden: ${r.cruzados} · por fuente: ${JSON.stringify(r.porFuente)}`);
for (const e of r.ejemplos) console.log("  ", e);
await c.query(escribe ? "commit" : "rollback");
console.log(escribe ? "COMMIT: hecho." : "ROLLBACK: ensayo; nada cambió. Con --escribe se aplica.");
await c.end();
