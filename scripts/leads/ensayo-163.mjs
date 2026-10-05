#!/usr/bin/env node
// ============================================================================
// Ensayo de la migracion 163 (leads por tienda) contra la base, DENTRO DE UNA TRANSACCION QUE SIEMPRE
// TERMINA EN ROLLBACK. No deja nada: ni la migracion, ni un lead tomado, ni un permiso cambiado.
//
//   node scripts/leads/ensayo-163.mjs                     -> SUPABASE_DB_URL del entorno o de ./.env.local
//   node scripts/leads/ensayo-163.mjs --env <ruta/.env.local>
//
// Que hace: aplica supabase/migrations/163_leads_por_tienda.sql dentro de la transaccion, elige perfiles
// reales por ROL (nunca por nombre; no imprime nombres), y se pone en la piel de cada uno con
// `set local role authenticated` + `request.jwt.claims`, que es como llega una sesion a la RLS. Imprime una
// linea por caso con OK o MAL, hace ROLLBACK, y despues comprueba que no quedo nada.
//
// Sale con codigo 0 solo si todos los casos son OK y el rollback dejo la base como estaba.
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRACION = join(RAIZ, "supabase", "migrations", "163_leads_por_tienda.sql");
const PERMISO = "leads_all_stores";

// Que no se cuelgue nunca: si la base no contesta, se sale (la conexion cae y la transaccion se deshace sola).
setTimeout(() => { console.error("TIEMPO AGOTADO: se sale sin commit."); process.exit(2); }, 120000).unref();

function urlDeLaBase() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const i = process.argv.indexOf("--env");
  const ruta = i > 0 ? process.argv[i + 1] : join(process.cwd(), ".env.local");
  if (!ruta || !existsSync(ruta)) return null;
  const linea = readFileSync(ruta, "utf8").split(/\r?\n/).find((l) => l.trim().startsWith("SUPABASE_DB_URL="));
  return linea ? linea.slice(linea.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
}

const url = urlDeLaBase();
if (!url) { console.error("Falta SUPABASE_DB_URL (en el entorno, en ./.env.local o con --env <ruta>)."); process.exit(1); }

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 30000, connectionTimeoutMillis: 15000 });
let ok = 0, mal = 0;
const caso = (id, texto, bien, detalle = "") => {
  if (bien) ok++; else mal++;
  console.log(`${id.padEnd(4)} ${texto.padEnd(86)} ${bien ? "OK" : "MAL"}${detalle ? "  " + detalle : ""}`);
};
const uno = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const n = async (sql, args = []) => Number((await uno(sql, args)).n);

/** Se pone en la piel de una persona: lo que corre dentro lo ve la RLS como su sesion. */
async function como(uid, hace) {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  try { return await hace(); }
  finally { await c.query("reset role"); await c.query("select set_config('request.jwt.claims', '', true)"); }
}
/** Corre algo que puede fallar sin tumbar la transaccion. Devuelve el sqlstate, o null si paso. */
async function intenta(sql, args = []) {
  await c.query("savepoint intento");
  try { await c.query(sql, args); await c.query("release savepoint intento"); return null; }
  catch (e) { await c.query("rollback to savepoint intento"); return e.code ?? "?"; }
}
/** Lo que ve una sesion: cuantos leads, de que pools, cuantos eventos, y lo que dice leads_my_scope(). */
async function loQueVe() {
  const leads = await n("select count(*) n from public.leads");
  const pools = (await c.query("select pool, count(*)::int n from public.leads group by pool order by pool")).rows;
  const eventos = await n("select count(*) n from public.lead_events");
  const alcance = (await uno("select public.leads_my_scope() as a")).a;
  const tope = await n("select count(*) n from public.lead_settings");
  return { leads, pools, eventos, alcance, tope };
}
const dice = (v) => `ve ${v.leads} leads [${v.pools.map((p) => `${p.pool} ${p.n}`).join(" · ") || "ninguno"}], ${v.eventos} eventos, alcance ${JSON.stringify(v.alcance)}`;

let terminado = false;
try {
  await c.connect();
  await c.query("begin");
  await c.query("set local lock_timeout = '3s'");

  // 0. La migracion entera, dentro de la transaccion (su bloque «se comprueba a si misma» corre aqui).
  await c.query(readFileSync(MIGRACION, "utf8"));
  caso("M1", "la 163 se aplica y su bloque de comprobacion pasa", true);

  // 1. El reparto: perfiles reales elegidos por rol. Todo lo que se les cambia se deshace con el ROLLBACK.
  const conModulo = "'leads' = any(coalesce(module_access, '{}'))";
  const elige = async (donde) => (await uno(`select id, store from public.profiles where ${donde} order by id limit 1`)) ?? null;
  const admin = await elige("role = 'admin'");
  const ventas = await elige(`role = 'sales' and ${conModulo} and store = 'RDZ Pharr'`);
  const otraTienda = "RDZ Brownsville";
  const gerenteCon = await elige(`role = 'manager' and ${conModulo} and store is not null`);
  const gerenteSin = await elige(`role = 'manager' and ${conModulo} and store is not null and id <> '${gerenteCon?.id}'`);
  const gerenteSinTienda = await elige(`role = 'manager' and ${conModulo} and store is null`);
  const oficina = await elige(`role = 'accounting' and ${conModulo} and store is not null`);
  const sinTienda = await elige(`role not in ('admin', 'manager') and ${conModulo} and store is null`);
  const ventasConPalabra = await elige(`role = 'sales' and ${conModulo} and store is not null and store <> 'RDZ Pharr'`);
  const sinModulo = await elige(`role = 'driver' and not (${conModulo})`);
  const reparto = { admin, ventas, gerenteCon, gerenteSin, gerenteSinTienda, oficina, sinTienda, ventasConPalabra, sinModulo };
  for (const [k, v] of Object.entries(reparto)) if (!v) console.log(`     (no hay perfil para «${k}»: sus casos se saltan)`);

  // Como postgres: a un manager se le APAGA el interruptor, y a un vendedor se le escribe la palabra a mano.
  if (gerenteSin) await c.query("update public.profiles set permissions = array_remove(permissions, $2) where id = $1", [gerenteSin.id, PERMISO]);
  if (ventasConPalabra) await c.query("update public.profiles set permissions = array_append(coalesce(permissions, '{}'), $2) where id = $1", [ventasConPalabra.id, PERMISO]);

  // Lo que hay de verdad, contado como postgres (sin RLS).
  const total = await n("select count(*) n from public.leads");
  const eventosTotal = await n("select count(*) n from public.lead_events");
  const delPool = async (pool) => n("select count(*) n from public.leads where pool = $1", [pool]);
  const libre = async (pool, salto = 0) => (await uno("select id from public.leads where pool = $1 and status = 'free' order by tabs_project offset $2 limit 1", [pool, salto]))?.id;
  const pharr1 = await libre("RDZ Pharr"), otra1 = await libre(otraTienda), otra2 = await libre(otraTienda, 1), otra3 = await libre(otraTienda, 2);
  console.log(`     en la base: ${total} leads, ${eventosTotal} eventos; RDZ Pharr ${await delPool("RDZ Pharr")}, ${otraTienda} ${await delPool(otraTienda)}`);

  // B. El backfill.
  caso("B1", "todos los managers quedaron con el permiso (menos el que el ensayo apago)",
    (await n(`select count(*) n from public.profiles where role = 'manager' and not ($1 = any(coalesce(permissions, '{}')))`, [PERMISO])) === (gerenteSin ? 1 : 0));

  // A. ADMIN: todo. Y asigna a VENTAS un lead de OTRA tienda (para el caso «los suyos»).
  if (admin) {
    const v = await como(admin.id, loQueVe);
    caso("A1", "admin: ve todos los leads y todos los eventos", v.leads === total && v.eventos === eventosTotal && v.alcance.all === true, dice(v));
    if (ventas && otra2) {
      const e = await como(admin.id, () => intenta("select public.lead_admin_assign($1, $2, 'ensayo 163')", [otra2, ventas.id]));
      caso("A2", "admin: asigna a ventas un lead de otra tienda", e === null, e ?? "");
    }
  }

  // V. VENTAS de Pharr.
  if (ventas) {
    const pharr = await delPool("RDZ Pharr");
    const v = await como(ventas.id, loQueVe);
    const soloPharrYElSuyo = v.pools.length === 2 && v.pools.every((p) => (p.pool === "RDZ Pharr" && p.n === pharr) || (p.pool === otraTienda && p.n === 1));
    caso("V1", "ventas de Pharr: ve Pharr entero + el suyo de otra tienda, y nada mas", v.leads === pharr + 1 && soloPharrYElSuyo, dice(v));
    caso("V2", "ventas: leads_my_scope dice all=false y su tienda", v.alcance.all === false && v.alcance.store === "RDZ Pharr");
    caso("V3", "ventas: sigue leyendo el tope (lead_settings no cambia)", v.tope === 1);
    const esperados = await n(`select count(*) n from public.lead_events e join public.leads l on l.id = e.lead_id where l.pool = 'RDZ Pharr' or l.holder = $1`, [ventas.id]);
    caso("V4", "ventas: del historial ve solo el de los leads que ve", v.eventos === esperados && v.eventos < eventosTotal, `${v.eventos} de ${eventosTotal}`);
    const ajeno = await como(ventas.id, () => n("select count(*) n from public.leads where id = $1", [otra1]));
    caso("V5", "ventas: un lead libre de otra tienda no lo lee ni por id", ajeno === 0);
    const histAjeno = await como(ventas.id, () => n("select count(*) n from public.lead_events where lead_id = $1", [otra1]));
    caso("V6", "ventas: ni su historial", histAjeno === 0);
    const e1 = await como(ventas.id, () => intenta("select public.lead_take($1)", [otra1]));
    caso("V7", "ventas: lead_take de un lead de otra tienda                    esperado LD005", e1 === "LD005", e1 ?? "paso");
    caso("V8", "       y el lead sigue libre y sin dueno", (await uno("select status, holder from public.leads where id = $1", [otra1])).status === "free");
    const e2 = await como(ventas.id, () => intenta("select public.lead_take($1)", [pharr1]));
    caso("V9", "ventas: lead_take de un lead de SU tienda", e2 === null, e2 ?? "");
    const e3 = await como(ventas.id, () => intenta("select public.lead_note($1, 'ensayo 163: avance')", [otra2]));
    caso("V10", "ventas: anota el suyo de otra tienda (lead_note no cambia)", e3 === null, e3 ?? "");
    const e4 = await como(ventas.id, () => intenta("select public.lead_close($1, 'nothing', 'ensayo 163: cierre')", [otra2]));
    caso("V11", "ventas: lo cierra; vuelve al banco de la otra tienda", e4 === null, e4 ?? "");
    const v2 = await como(ventas.id, loQueVe);
    caso("V12", "       y al volver al otro banco deja de verlo: solo Pharr", v2.leads === pharr && v2.pools.length === 1 && v2.pools[0].pool === "RDZ Pharr", dice(v2));
    const e5 = await como(ventas.id, () => intenta("select public.lead_take('00000000-0000-0000-0000-000000000000')"));
    caso("V13", "ventas: lead_take de un id que no existe                       esperado P0002", e5 === "P0002", e5 ?? "paso");
  }

  // G. MANAGER con el permiso: todo, y toma de cualquier tienda.
  if (gerenteCon) {
    const v = await como(gerenteCon.id, loQueVe);
    caso("G1", `manager CON permiso (tienda ${gerenteCon.store}): ve todo`, v.leads === total && v.alcance.all === true, dice(v));
    const otraQueLaSuya = gerenteCon.store === otraTienda ? "RDZ Pharr" : otraTienda;
    const id = await libre(otraQueLaSuya, 3);
    const e = await como(gerenteCon.id, () => intenta("select public.lead_take($1)", [id]));
    caso("G2", "manager CON permiso: toma un lead de otra tienda", e === null, e ?? "");
  }
  if (gerenteSinTienda) {
    const v = await como(gerenteSinTienda.id, loQueVe);
    caso("G3", "manager CON permiso y SIN tienda: ve todo", v.leads === total && v.alcance.all === true, dice(v));
  }

  // H. MANAGER con el interruptor apagado: como ventas.
  if (gerenteSin) {
    const suyos = await n("select count(*) n from public.leads where pool = $1 or holder = $2", [gerenteSin.store, gerenteSin.id]);
    const v = await como(gerenteSin.id, loQueVe);
    caso("H1", `manager SIN permiso (tienda ${gerenteSin.store}): solo su tienda`, v.leads === suyos && v.leads < total && v.alcance.all === false && v.pools.every((p) => p.pool === gerenteSin.store), dice(v));
    const id = await libre(gerenteSin.store === otraTienda ? "RDZ Pharr" : otraTienda, 4);
    const e = await como(gerenteSin.id, () => intenta("select public.lead_take($1)", [id]));
    caso("H2", "manager SIN permiso: lead_take de otra tienda                   esperado LD005", e === "LD005", e ?? "paso");
  }

  // O. OFICINA (accounting) con tienda: como ventas. La palabra no se le ofrece.
  if (oficina) {
    const suyos = await n("select count(*) n from public.leads where pool = $1 or holder = $2", [oficina.store, oficina.id]);
    const v = await como(oficina.id, loQueVe);
    caso("O1", `oficina (tienda ${oficina.store}): solo su tienda`, v.leads === suyos && v.leads < total && v.alcance.all === false, dice(v));
  }

  // P. VENTAS con la palabra escrita a mano: no le sirve.
  if (ventasConPalabra) {
    const suyos = await n("select count(*) n from public.leads where pool = $1 or holder = $2", [ventasConPalabra.store, ventasConPalabra.id]);
    const v = await como(ventasConPalabra.id, loQueVe);
    caso("P1", `ventas con la palabra del permiso (tienda ${ventasConPalabra.store}): sigue viendo solo su tienda`, v.leads === suyos && v.leads < total && v.alcance.all === false, dice(v));
    const e = await como(ventasConPalabra.id, () => intenta("select public.lead_take($1)", [ventasConPalabra.store === otraTienda ? pharr1 : otra3]));
    caso("P2", "       y no toma de otra tienda                                 esperado LD005", e === "LD005", e ?? "paso");
  }

  // T. Con el modulo, SIN tienda y sin permiso: nada (salvo lo que tuviera a su nombre).
  if (sinTienda) {
    const suyos = await n("select count(*) n from public.leads where holder = $1", [sinTienda.id]);
    const v = await como(sinTienda.id, loQueVe);
    caso("T1", "con modulo, sin tienda y sin permiso: solo lo suyo (0 si no tiene nada)", v.leads === suyos && v.alcance.all === false && v.alcance.store === null, dice(v));
    const e = await como(sinTienda.id, () => intenta("select public.lead_take($1)", [otra3]));
    caso("T2", "       y no toma nada                                           esperado LD005", e === "LD005", e ?? "paso");
  }

  // S. Con sesion y SIN el modulo: como en la 162, nada.
  if (sinModulo) {
    const v = await como(sinModulo.id, loQueVe);
    caso("S1", "sin modulo: 0 leads, 0 eventos, 0 ajustes", v.leads === 0 && v.eventos === 0 && v.tope === 0 && v.alcance.all === false, dice(v));
    const e = await como(sinModulo.id, () => intenta("select public.lead_take($1)", [otra3]));
    caso("S2", "sin modulo: lead_take                                           esperado 42501", e === "42501", e ?? "paso");
  }

  // N. anon: nada.
  await c.query("set local role anon");
  const n1 = await intenta("select 1 from public.leads limit 1");
  const n2 = await intenta("select public.leads_my_scope()");
  const n3 = await intenta("select public.leads_scope_all()");
  await c.query("reset role");
  caso("N1", "anon: leer leads                                                esperado 42501", n1 === "42501", n1 ?? "paso");
  caso("N2", "anon: leads_my_scope y leads_scope_all                          esperado 42501", n2 === "42501" && n3 === "42501", `${n2} ${n3}`);
} catch (e) {
  mal++;
  console.error(`REVENTO: ${e.code ?? ""} ${e.message}`);
} finally {
  try { await c.query("rollback"); terminado = true; console.log("ROLLBACK hecho."); } catch (e) { console.error(`El rollback fallo: ${e.message}`); }
}

// Despues del rollback: no quedo nada.
if (terminado) {
  try {
    const queda = await uno(`select
      (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('leads_my_scope', 'leads_scope_all', 'leads_my_store'))::int as funciones,
      (select count(*) from public.profiles where $1 = any(coalesce(permissions, '{}')))::int as con_permiso,
      (select count(*) from public.schema_migrations where name = '163_leads_por_tienda.sql')::int as en_registro,
      (select count(*) from pg_policies where schemaname = 'public' and tablename in ('leads', 'lead_events') and qual ~ 'leads_scope_all')::int as politicas_nuevas,
      (select count(*) from public.leads where holder is not null)::int as leads_con_dueno,
      (select count(*) from public.lead_events where note like 'ensayo 163%')::int as eventos_de_ensayo`, [PERMISO]);
    console.log(`Despues del rollback: ${JSON.stringify(queda)}`);
  } catch (e) { console.error(`No se pudo comprobar el despues: ${e.message}`); mal++; }
}
await c.end().catch(() => {});
console.log(`\n${ok} OK, ${mal} MAL`);
process.exit(mal === 0 && terminado ? 0 : 1);
