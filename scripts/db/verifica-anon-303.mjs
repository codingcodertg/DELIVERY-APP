#!/usr/bin/env node
// Verifica la migracion 303 (seguridad: funciones que `anon` podia ejecutar, search_path, bucket `app`, dos politicas).
//
//   node scripts/db/verifica-anon-303.mjs
//
// SOLO LECTURA: abre una transaccion de solo lectura, mira permisos en el catalogo, actua un momento como `anon` y
// como `authenticated` (set local role) y termina en ROLLBACK. Se puede correr ANTES y DESPUES de aplicar la 303:
//   - antes: informa de lo que la 303 va a cambiar (no falla por eso) y comprueba que lo que debe seguir, sigue.
//   - despues: exige que anon ya no ejecute las quitadas, que authenticated y service_role conserven todo, y que las
//     que se quedan sigan ejecutables por anon. Sale con codigo 1 si algo no cuadra.
//
// Las listas salen del propio .sql (lineas `revoke execute on routine …` y `-- KEEP: …`): una sola fuente.
// Sin acentos, como el resto de scripts/db.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIG_DIR, cargaEntorno } from "./ledger.mjs";

const NOMBRE = "303_seguridad_anon_search_path_bucket.sql";
const sql = readFileSync(join(MIG_DIR, NOMBRE), "utf8").replace(/\r\n/g, "\n");
const quitadas = [...sql.matchAll(/^revoke execute on routine (.+) from public, anon;$/gm)].map((m) => m[1]);
const seQuedan = [...sql.matchAll(/^-- KEEP: (.+)$/gm)].map((m) => m[1]);
const conSearchPath = [...sql.matchAll(/^alter function (.+) set search_path = /gm)].map((m) => m[1]);

cargaEntorno();
const { default: pg } = await import("pg");
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error("Falta SUPABASE_DB_URL en .env.local."); process.exit(2); }
const c = new pg.Client({ connectionString: url });
await c.connect();

const fallos = [];
const avisos = [];
async function intenta(texto) {
  await c.query("savepoint v");
  try { await c.query(texto); await c.query("release savepoint v"); return "ok"; }
  catch (e) { await c.query("rollback to savepoint v"); return e.code ?? "error"; }
}

try {
  await c.query("begin transaction read only");
  const { rows: [{ aplicada }] } = await c.query("select exists (select 1 from public.schema_migrations where name = $1) as aplicada", [NOMBRE]);
  console.log(`${NOMBRE}: ${aplicada ? "APLICADA" : "todavia NO aplicada"} · ${quitadas.length} quitadas · ${seQuedan.length} se quedan\n`);

  // 1. Permisos en el catalogo.
  const { rows: priv } = await c.query(
    `select f, has_function_privilege('anon', f::regprocedure, 'execute') as anon,
            has_function_privilege('authenticated', f::regprocedure, 'execute') as auth,
            has_function_privilege('service_role', f::regprocedure, 'execute') as srv
       from unnest($1::text[]) f`, [[...quitadas, ...seQuedan]]);
  const porFirma = new Map(priv.map((r) => [r.f, r]));
  let anonAun = 0;
  for (const f of quitadas) {
    const r = porFirma.get(f);
    if (r.anon) { anonAun += 1; if (aplicada) fallos.push(`anon todavia ejecuta ${f}`); }
    if (!r.auth) fallos.push(`authenticated NO puede ejecutar ${f}`);
    if (!r.srv) fallos.push(`service_role NO puede ejecutar ${f}`);
  }
  for (const f of seQuedan) if (!porFirma.get(f).anon) fallos.push(`${f} debe seguir ejecutable por anon (politicas RLS con rol public)`);
  console.log(`1. Catalogo: anon ejecuta ${anonAun} de las ${quitadas.length} quitadas${aplicada ? "" : " (normal: aun no se aplica)"}; authenticated y service_role conservan todas.`);

  // 2. De verdad, como anon y como authenticated.
  await c.query("set local role anon");
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
  for (const f of ["public.current_user_role()", "public.current_recruiting_role()"]) {
    const r = await intenta(`select ${f}`);
    if (r !== "ok") fallos.push(`anon no pudo llamar ${f} (${r})`);
  }
  for (const f of ["public.is_admin()", "public.has_erp_access()", "public.has_recruiting_access()"]) {
    const r = await intenta(`select ${f}`);
    if (aplicada && r !== "42501") fallos.push(`anon llamo ${f} y no dio 42501 (${r})`);
    if (!aplicada && r !== "ok") avisos.push(`antes de aplicar, anon ya no podia llamar ${f} (${r})`);
  }
  await c.query("reset role");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', true)");
  for (const f of ["public.is_admin()", "public.has_erp_access()", "public.has_recruiting_access()", "public.has_timetracker_access()",
    "public.has_warehouse_ops_access()", "public.has_customers_access()", "public.current_user_role()", "erp.can_see_cost()", "erp.current_app_role()"]) {
    const r = await intenta(`select ${f}`);
    if (r !== "ok") fallos.push(`authenticated no pudo llamar ${f} (${r})`);
  }
  await c.query("reset role");
  console.log("2. En vivo: anon llama las que se quedan" + (aplicada ? " y recibe 42501 en las quitadas" : "") + "; authenticated llama sus helpers.");

  // 3. search_path, bucket y politicas.
  const { rows: sp } = await c.query(
    `select f, exists (select 1 from pg_proc p, unnest(coalesce(p.proconfig, '{}')) x where p.oid = f::regprocedure and x like 'search_path=%') as fijo
       from unnest($1::text[]) f`, [conSearchPath]);
  const sinFijar = sp.filter((r) => !r.fijo).map((r) => r.f);
  if (aplicada && sinFijar.length) fallos.push(`sin search_path fijo: ${sinFijar.join(", ")}`);
  const { rows: [b] } = await c.query("select file_size_limit, allowed_mime_types from storage.buckets where id = 'app'");
  const bucketOk = b && Number(b.file_size_limit) === 52428800 && JSON.stringify(b.allowed_mime_types) === JSON.stringify(["application/vnd.android.package-archive"]);
  if (aplicada && !bucketOk) fallos.push("el bucket app no tiene su tope (50 MB) y su tipo (APK)");
  const { rows: [{ n: pols }] } = await c.query(
    `select count(*)::int n from pg_policies
      where ((schemaname = 'public' and tablename = 'delivery_files' and policyname = 'delivery files insert')
          or (schemaname = 'recruiting' and tablename = 'user_creation_requests' and policyname = 'ucr_insert'))
        and with_check ~* 'select\\s+auth\\.uid\\(\\)'`);
  if (aplicada && pols !== 2) fallos.push(`las dos politicas deben usar (select auth.uid()); encontre ${pols}`);
  console.log(`3. search_path fijo: ${conSearchPath.length - sinFijar.length}/${conSearchPath.length} · bucket app ${bucketOk ? "limitado" : "sin limitar"} · politicas con (select auth.uid()): ${pols}/2`);
} finally {
  try { await c.query("rollback"); } catch { /* ya cerrada */ }
  await c.end();
}

for (const a of avisos) console.log(`AVISO: ${a}`);
if (fallos.length) {
  console.error(`\nNO CUADRA (${fallos.length}):`);
  for (const f of fallos) console.error(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log("\nTODO CUADRA.");
}
console.log(`
Para probar a mano despues de aplicar (5 minutos):
  1. Sin sesion: abrir /login y entrar. Probar «Olvide mi contrasena».
  2. Sin sesion: abrir el enlace de seguimiento de una orden (el que recibe el cliente) y una encuesta publica.
  3. Con sesion de vendedor, gerente, almacen y chofer: abrir Entregas, Operaciones (merma), Clientes, RR. HH. y Time Tracker.
  4. En el ERP / Inventario: abrir el catalogo y un producto (usa las RPC de erp).
  5. En una orden, subir un archivo adjunto (politica «delivery files insert»).
  6. En RR. HH., pedir la creacion de un usuario desde un expediente (politica ucr_insert).
  7. En el telefono, que el aviso «Actualizar» siga bajando la APK. Al publicar una APK nueva, subirla con
     Content-Type application/vnd.android.package-archive (el bucket ya solo acepta eso, hasta 50 MB).
  8. App de Clock-in (PWA) y cliente de Time Tracker: iniciar sesion y fichar.`);
