#!/usr/bin/env node
// ============================================================================
// Archiva (NO borra) las filas de erp.customers que no son clientes (migracion 181).
//
//   node scripts/archiva-clientes-basura.mjs                       -> EN SECO: lee, clasifica y cuenta. No escribe.
//   node scripts/archiva-clientes-basura.mjs --escribe             -> archiva de verdad (COMMIT)
//   node scripts/archiva-clientes-basura.mjs --deshacer            -> EN SECO: cuenta lo que desarchivaria
//   node scripts/archiva-clientes-basura.mjs --deshacer --escribe  -> desarchiva las filas con los tres motivos de aqui
//
// Necesita SUPABASE_DB_URL (en el entorno o en .env.local del directorio actual) y la 181 aplicada. Escribir es del
// orquestador, despues de aplicar la 181: una rama no lo corre (no tiene .env.local).
//
// El dueno (2026-10-16): «HAZME EL CLEANUP DE LO DEL CLIENTES VIEW». Medido ese dia en produccion (1.348 filas):
// 149 filas no son clientes, de tres clases que se solapan (20 + 40 + 101 con solape = 149):
//   1. 'sin nombre':                    la cuenta no tiene tres letras seguidas (account !~ '[A-Za-z]{3}'):
//                                       «+», «;», «..», «*», «30.27», «4V», «HB», «SO 10873».
//   2. 'comodin de QuickBooks':         cuentas que QuickBooks usa como cajon: VENTA AL MOSTRADOR, SALES ORDER,
//                                       BAD DEBT, DAMAGED MERCHANDISE, INVENTORY BY/COORD, DE MCALLEN A, DE MISSION A.
//   3. 'interno/proveedor/competencia': activity_status Internal, Supplier o Competencia (empresas del grupo,
//                                       proveedores, competencia).
// Los demas activity_status ('One time?', 'walk in', 'Unknown', 'Inactive', null) SE QUEDAN.
//
// IDEMPOTENTE: solo toca filas con archived_at is null; la segunda pasada cuenta cero. Una fila que case con mas de
// una regla recibe el motivo de la PRIMERA en este orden (sin nombre > comodin > interno), y asi el total es la union.
// --deshacer quita archived_at y archived_reason SOLO a las filas con uno de estos tres motivos: lo que alguien
// archivo a mano desde la ficha (con su propio motivo) no se toca.
//
// Sin acentos en los mensajes, como el resto de scripts/.
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MOTIVOS = {
  sinNombre: "sin nombre",
  comodin: "comodin de QuickBooks",
  interno: "interno/proveedor/competencia",
};

/** `account !~ '[A-Za-z]{3}'` de Postgres: ni tres letras seguidas. */
export function esSinNombre(account) {
  return !/[A-Za-z]{3}/.test(String(account ?? ""));
}

const COMODIN = /(VENTA AL MOSTRADOR|SALES ORDER|BAD DEBT|DAMAGED MERCHANDISE|INVENTORY (BY|COORD)|DE MCALLEN A|DE MISSION A)/i;
/** `account ~* '(...)'`: las cuentas-cajon de QuickBooks, sin distinguir mayusculas. */
export function esComodin(account) {
  return COMODIN.test(String(account ?? ""));
}

const INTERNOS = new Set(["Internal", "Supplier", "Competencia"]);
/** `activity_status in ('Internal','Supplier','Competencia')`, exacto (asi estan escritos en la base). */
export function esInterno(activityStatus) {
  return INTERNOS.has(activityStatus);
}

/** El motivo de archivar una fila, o null si es un cliente. La primera regla que case manda. */
export function motivoDe(fila) {
  if (esSinNombre(fila.account)) return MOTIVOS.sinNombre;
  if (esComodin(fila.account)) return MOTIVOS.comodin;
  if (esInterno(fila.activity_status)) return MOTIVOS.interno;
  return null;
}

/**
 * Clasifica una lista de filas vivas. Devuelve los ids por motivo (lo que se escribe), cuantas casan con CADA regla
 * por separado (con solape, para cotejar con lo medido: 20 / 40 / 101) y el total distinto (la union).
 */
export function clasifica(filas) {
  const porMotivo = { [MOTIVOS.sinNombre]: [], [MOTIVOS.comodin]: [], [MOTIVOS.interno]: [] };
  const porRegla = { [MOTIVOS.sinNombre]: 0, [MOTIVOS.comodin]: 0, [MOTIVOS.interno]: 0 };
  for (const f of filas) {
    if (esSinNombre(f.account)) porRegla[MOTIVOS.sinNombre]++;
    if (esComodin(f.account)) porRegla[MOTIVOS.comodin]++;
    if (esInterno(f.activity_status)) porRegla[MOTIVOS.interno]++;
    const m = motivoDe(f);
    if (m) porMotivo[m].push(f.id);
  }
  const total = Object.values(porMotivo).reduce((n, ids) => n + ids.length, 0);
  return { porMotivo, porRegla, total, vivas: filas.length };
}

/** Lo que se ejecuta contra la base, separado de main() para probar que escribe lo que dice sin una base. */
export async function archiva({ consulta, escribe, log = console.log }) {
  const { rows } = await consulta("select id, account, activity_status from erp.customers where archived_at is null order by id");
  const r = clasifica(rows);
  log(`Filas vivas (archived_at is null): ${r.vivas}`);
  for (const m of Object.values(MOTIVOS)) log(`  ${m}: casan con la regla ${r.porRegla[m]} · se archivan con este motivo ${r.porMotivo[m].length}`);
  log(`Total a archivar (union, sin repetir): ${r.total}`);
  if (!escribe) { log("\nEN SECO: no se toco la base. Con --escribe se archiva de verdad."); return r; }
  let hechas = 0;
  for (const m of Object.values(MOTIVOS)) {
    const ids = r.porMotivo[m];
    if (!ids.length) continue;
    const u = await consulta(
      "update erp.customers set archived_at = now(), archived_reason = $1 where archived_at is null and id = any($2::bigint[]) returning id",
      [m, ids],
    );
    hechas += u.rows.length;
  }
  log(`Archivadas: ${hechas}`);
  return { ...r, hechas };
}

export async function deshaz({ consulta, escribe, log = console.log }) {
  const motivos = Object.values(MOTIVOS);
  const { rows } = await consulta("select archived_reason, count(*)::int as n from erp.customers where archived_at is not null and archived_reason = any($1::text[]) group by 1", [motivos]);
  let total = 0;
  for (const m of motivos) { const n = rows.find((x) => x.archived_reason === m)?.n ?? 0; total += n; log(`  ${m}: ${n}`); }
  log(`Total a desarchivar: ${total}`);
  if (!escribe) { log("\nEN SECO: no se toco la base. Con --deshacer --escribe se desarchiva de verdad."); return { total }; }
  const u = await consulta("update erp.customers set archived_at = null, archived_reason = null where archived_at is not null and archived_reason = any($1::text[]) returning id", [motivos]);
  log(`Desarchivadas: ${u.rows.length}`);
  return { total, hechas: u.rows.length };
}

async function main() {
  const args = process.argv.slice(2);
  const escribe = args.includes("--escribe");
  const deshacer = args.includes("--deshacer");
  const desconocidos = args.filter((a) => a !== "--escribe" && a !== "--deshacer");
  if (desconocidos.length) {
    console.error("Uso: node scripts/archiva-clientes-basura.mjs [--deshacer] [--escribe]");
    process.exit(2);
  }
  let url = process.env.SUPABASE_DB_URL;
  if (!url && existsSync(".env.local")) {
    const m = /^SUPABASE_DB_URL=(.*)$/m.exec(readFileSync(".env.local", "utf8"));
    if (m) url = m[1].trim().replace(/^["']|["']$/g, "");
  }
  if (!url) { console.error("Falta SUPABASE_DB_URL (en el entorno o en .env.local)."); process.exit(1); }
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const consulta = (sql, params) => c.query(sql, params);
  try {
    await c.query("set lock_timeout = '5s'; set statement_timeout = '120s'");
    await c.query("begin");
    if (deshacer) await deshaz({ consulta, escribe });
    else await archiva({ consulta, escribe });
    if (escribe) { await c.query("commit"); console.log("COMMIT."); }
    else await c.query("rollback");
  } catch (e) {
    try { await c.query("rollback"); } catch { /* ya estaba cerrada */ }
    console.error("ERROR (rollback hecho):", e.code ?? "", e.message);
    if (e.code === "42703") console.error("¿Esta aplicada la migracion 181 (archived_at)?");
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
