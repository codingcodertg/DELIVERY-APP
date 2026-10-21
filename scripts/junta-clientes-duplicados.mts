// Clientes · de una vez (migración 189): agrupa en EMPRESAS las filas de la misma compañía en varias tiendas, junta
// los duplicados de una misma tienda y llena la cola «Decidir si se juntan». El dueño, 2026-10-21: «analices toda la
// lista otra vez y ver los que son obviamente duplicados, hacerle un merge […] los que no son, obviamente, pero que
// tienen sospecha de ser la misma compañía, tiene que irse a un site que dice Decide to Merge».
//
// Decide con las MISMAS funciones de la app (`src/lib/customers/duplicados.ts`): qué es obvio (`gruposObvios`), qué
// es sospechoso (`sospechosos`) y qué quedará en cada fila (`juntaEnMemoria`). Escribe llamando a la función de la
// base `erp.junta_clientes` (la misma que usa la pantalla), y antes de confirmar COMPARA lo que hizo la base con lo
// que predijo la app, fila por fila: si no coinciden, ROLLBACK.
//
//   node --env-file=.env.local scripts/junta-clientes-duplicados.mts             en seco: cuenta y enseña ejemplos
//   node --env-file=.env.local scripts/junta-clientes-duplicados.mts --ensayo    todo dentro de una transacción que
//        termina en ROLLBACK (si la 189 no está aplicada, la aplica DENTRO), con los casos de permisos, y comprueba
//        después que no quedó nada
//   node --env-file=.env.local scripts/junta-clientes-duplicados.mts --escribe   de verdad (necesita la 189 aplicada):
//        primero guarda en D:/CLAUDE/respaldos-db un JSON con cada fila que va a tocar, luego escribe en UNA
//        transacción, y vuelve a medir (lo obvio pendiente debe quedar en 0)
import pg from "pg";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAMPOS_DE_UNION, claveDeEmpresa, juntaEnMemoria, motivoDeLaCola, planDeJuntar, sospechosos, type FilaDeCliente, type Sospecha,
} from "../src/lib/customers/duplicados.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRACION = join(RAIZ, "supabase", "migrations", "189_clientes_empresas.sql");
const RESPALDOS = "D:/CLAUDE/respaldos-db";

const escribe = process.argv.includes("--escribe");
const ensayo = process.argv.includes("--ensayo");
if (escribe && ensayo) { console.error("O --ensayo o --escribe, no los dos."); process.exit(1); }
if (!process.env.SUPABASE_DB_URL) { console.error("Falta SUPABASE_DB_URL (node --env-file=.env.local …)."); process.exit(1); }
setTimeout(() => { console.error("TIEMPO AGOTADO: se sale sin commit."); process.exit(2); }, 300000).unref();

type Fila = FilaDeCliente & Record<string, unknown>;
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
await c.connect();
if (!escribe && !ensayo) await c.query("set default_transaction_read_only = on");

const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await c.query(sql, args)).rows as T[];
const existe = async (sql: string) => (await q<{ x: boolean }>(`select (${sql}) as x`))[0].x;
const hayEmpresa = () => existe("exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'customers' and column_name = 'company_id')");
const hayCola = () => existe("to_regclass('erp.customer_merge_suggestions') is not null");

/** Las filas, con el id como número y las fechas como texto (lo que esperan las funciones de la app). */
async function leeFilas(conEmpresa: boolean): Promise<Fila[]> {
  const filas = await q(`select *${conEmpresa ? "" : ", null::uuid as company_id"} from erp.customers order by id`);
  return filas.map((f) => ({
    ...f,
    id: Number(f.id),
    archived_at: f.archived_at ? new Date(f.archived_at as string).toISOString() : null,
  })) as Fila[];
}
const pares = async () => new Set((await q<{ a: string; b: string }>("select a_id a, b_id b from erp.customer_merge_suggestions")).map((r) => `${r.a}|${r.b}`));

const nombre = (porId: Map<number, Fila>, id: number) => { const f = porId.get(id)!; return `#${id} ${f.store}:${f.account}`; };

function informe(filas: Fila[], plan: ReturnType<typeof planDeJuntar<Fila>>, yaEnCola: Set<string>) {
  const porId = new Map(filas.map((f) => [f.id, f]));
  const vivas = filas.filter((f) => !f.archived_at);
  const multi = plan.grupos.filter((g) => new Set(g.map((i) => String(porId.get(i)!.store).trim().toUpperCase())).size > 1);
  const vivasDespues = plan.filas.filter((f) => !f.archived_at);
  console.log(`filas: ${filas.length} · vivas: ${vivas.length}`);
  console.log(`grupos obvios: ${plan.grupos.length} (${plan.grupos.flat().length} filas) · con más de una tienda: ${multi.length} · llamadas a junta_clientes: ${plan.llamadas.length}`);
  console.log(`filas de la MISMA tienda que se juntan (la otra se archiva): ${plan.pasos.length}`);
  for (const p of plan.pasos) console.log(`  ${nombre(porId, p.sobrevive)}  ←  ${nombre(porId, p.archivada)}\n      ${p.linea}`);
  console.log(`después: vivas ${vivasDespues.length} · empresas ${new Set(vivasDespues.map(claveDeEmpresa)).size}`);
  console.log("ejemplos de empresas en varias tiendas:");
  for (const g of multi.slice(0, 6)) console.log("  " + g.map((i) => nombre(porId, i)).join(" | "));
  const nuevas = plan.sospechas.filter((s) => !yaEnCola.has(`${s.a_id}|${s.b_id}`));
  const por: Record<string, number> = {};
  for (const s of nuevas) for (const m of s.motivos) por[m] = (por[m] ?? 0) + 1;
  console.log(`sospechas: ${plan.sospechas.length} · nuevas para la cola: ${nuevas.length} · ya en la cola (cualquier estado): ${plan.sospechas.length - nuevas.length}`);
  console.log("  por motivo (una sospecha puede tener varios):", por);
  for (const m of Object.keys(por)) {
    console.log(`  — ${m}:`);
    for (const s of nuevas.filter((x) => x.motivos.includes(m as never)).slice(0, 4)) console.log(`      ${s.motivos.join("+")} ${s.score} · ${nombre(porId, s.a_id)} ~ ${nombre(porId, s.b_id)}`);
  }
}

/** Lo que hizo la base contra lo que predijo la app. Devuelve las diferencias (vacío = iguales). */
function comparar(predicho: Fila[], real: Fila[]): string[] {
  const dif: string[] = [];
  const empresas = (fs: Fila[]) => {
    const m = new Map<string, number[]>();
    for (const f of fs) { const k = claveDeEmpresa(f); if (!m.has(k)) m.set(k, []); m.get(k)!.push(f.id); }
    return new Set([...m.values()].map((ids) => ids.sort((a, b) => a - b).join(",")));
  };
  const ep = empresas(predicho), er = empresas(real);
  for (const e of ep) if (!er.has(e)) dif.push(`empresa predicha que la base no tiene: ${e}`);
  for (const e of er) if (!ep.has(e)) dif.push(`empresa de la base que no se predijo: ${e}`);
  const porId = new Map(real.map((f) => [f.id, f]));
  for (const p of predicho) {
    const r = porId.get(p.id);
    if (!r) { dif.push(`#${p.id} no está en la base`); continue; }
    if (!!p.archived_at !== !!r.archived_at || (p.archived_at && p.archived_reason !== r.archived_reason)) dif.push(`#${p.id} archivado: ${p.archived_reason} ≠ ${r.archived_reason}`);
    for (const k of [...CAMPOS_DE_UNION.map(([k]) => k), "notes"]) {
      const a = p[k] ?? null, b = r[k] ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b)) dif.push(`#${p.id} ${k}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    }
  }
  return dif;
}

async function aLaCola(sospechas: Sospecha[]) {
  let n = 0;
  for (const s of sospechas) {
    const r = await c.query(
      "insert into erp.customer_merge_suggestions (a_id, b_id, reason, score) values ($1, $2, $3, $4) on conflict (a_id, b_id) do nothing",
      [s.a_id, s.b_id, motivoDeLaCola(s.motivos), s.score],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

/** Escribe dentro de la transacción ya abierta y compara con lo predicho. Lanza si no coinciden. */
async function juntaYLlena(filasAntes: Fila[]) {
  const plan = planDeJuntar(filasAntes, new Date().toISOString(), () => { throw new Error("con la 189 toda fila tiene empresa"); });
  for (const [a, b] of plan.llamadas) await c.query("select erp.junta_clientes($1, $2)", [a, b]);
  const despues = await leeFilas(true);
  // La hora del archivado la pone la base: se compara que esté, no cuál es.
  const dif = comparar(plan.filas, despues);
  if (dif.length) { console.error("LA BASE NO HIZO LO QUE PREDIJO LA APP:\n  " + dif.slice(0, 30).join("\n  ")); throw new Error(`${dif.length} diferencias`); }
  console.log(`junta_clientes: ${plan.llamadas.length} llamadas · ${plan.pasos.length} filas archivadas como duplicado · la base coincide con la app fila por fila (${despues.length} filas)`);
  const sospechas = sospechosos(despues);
  const metidas = await aLaCola(sospechas);
  console.log(`cola: ${sospechas.length} sospechas · ${metidas} nuevas (las que ya estaban, en cualquier estado, no se tocan)`);
  return { plan, despues, sospechas };
}

async function medirDespues(etiqueta: string) {
  const filas = await leeFilas(true);
  const plan = planDeJuntar(filas, new Date().toISOString(), () => "x");
  const pend = (await q<{ n: string }>("select count(*) n from erp.customer_merge_suggestions where status = 'pending'"))[0].n;
  const porMotivo = await q("select reason, count(*)::int n from erp.customer_merge_suggestions where status = 'pending' group by 1 order by 2 desc");
  const vivas = filas.filter((f) => !f.archived_at);
  console.log(`${etiqueta}: vivas ${vivas.length} · empresas ${new Set(vivas.map(claveDeEmpresa)).size} · obvio pendiente: ${plan.llamadas.length} llamadas · cola pendiente: ${pend}`);
  console.log("  pendientes por motivo:", porMotivo.map((r) => `${r.reason} ${r.n}`).join(" · "));
  return plan.llamadas.length;
}

try {
  if (!escribe && !ensayo) {
    const conEmpresa = await hayEmpresa();
    const filas = await leeFilas(conEmpresa);
    const plan = planDeJuntar(filas, new Date().toISOString(), (() => { let n = 0; return () => `nueva-${++n}`; })());
    informe(filas, plan, (await hayCola()) ? await pares() : new Set());
    console.log(`\nEn seco: no se tocó la base${conEmpresa ? "" : " (la 189 aún no está aplicada: la predicción parte de «cada fila, su empresa»)"}. Con --ensayo lo hace y ROLLBACK; con --escribe, de verdad.`);
  } else if (escribe) {
    if (!(await hayEmpresa()) || !(await hayCola())) throw new Error("La 189 no está aplicada: primero la migración, después este guion.");
    const filas = await leeFilas(true);
    const plan = planDeJuntar(filas, new Date().toISOString(), () => { throw new Error("sin empresa"); });
    informe(filas, plan, await pares());
    // El respaldo: TODAS las filas de las empresas que se van a tocar, enteras, como están ahora.
    const tocadas = new Set<string>();
    const porId = new Map(filas.map((f) => [f.id, f]));
    for (const [a, b] of plan.llamadas) { tocadas.add(claveDeEmpresa(porId.get(a)!)); tocadas.add(claveDeEmpresa(porId.get(b)!)); }
    const respaldo = filas.filter((f) => tocadas.has(claveDeEmpresa(f)));
    mkdirSync(RESPALDOS, { recursive: true });
    const ruta = `${RESPALDOS}/clientes-antes-de-juntar-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(ruta, JSON.stringify({ filas: respaldo, cola: await q("select * from erp.customer_merge_suggestions") }, null, 2));
    console.log(`respaldo: ${ruta} (${respaldo.length} filas)`);
    await c.query("begin");
    try {
      await juntaYLlena(filas);
      await c.query("commit");
    } catch (e) { await c.query("rollback"); throw e; }
    console.log("COMMIT.");
    const quedan = await medirDespues("medido después");
    if (quedan) process.exitCode = 1;
  } else {
    // --ensayo
    let ok = 0, mal = 0;
    const caso = (texto: string, bien: boolean, detalle = "") => { if (bien) ok++; else mal++; console.log(`${bien ? "OK " : "MAL"} ${texto}${detalle ? "  · " + detalle : ""}`); };
    const antes = (await q<{ total: string; archivadas: string }>("select count(*) total, count(*) filter (where archived_at is not null) archivadas from erp.customers"))[0];
    const empresaAntes = await hayEmpresa();
    const colaAntes = await hayCola();
    await c.query("begin");
    await c.query("set local lock_timeout = '5s'");
    try {
      if (!empresaAntes) { await c.query(readFileSync(MIGRACION, "utf8")); console.log("189 aplicada DENTRO de la transacción (se deshará)."); }
      const filas = await leeFilas(true);
      const plan = planDeJuntar(filas, new Date().toISOString(), () => "x");
      informe(filas, plan, await pares());
      console.log("");
      await juntaYLlena(filas);
      await medirDespues("dentro del ensayo, después de escribir");

      // Los casos de permisos: como una sesión real (rol authenticated + jwt), elegida por ROL, sin imprimir nombres.
      const uid = async (rol: string) => (await q<{ id: string }>("select id from public.profiles where role = $1 and not ('customers' = any(coalesce(module_access, '{}'))) order by id limit 1", [rol]))[0]?.id;
      const admin = (await q<{ id: string }>("select id from public.profiles where role = 'admin' order by id limit 1"))[0].id;
      const ventas = await uid("sales");
      const como = async <T,>(rol: "authenticated" | "anon", sub: string | null, hace: () => Promise<T>) => {
        await c.query(`set local role ${rol}`);
        await c.query("select set_config('request.jwt.claims', $1, true)", [sub ? JSON.stringify({ sub, role: rol }) : ""]);
        try { return await hace(); } finally { await c.query("reset role"); await c.query("select set_config('request.jwt.claims', '', true)"); }
      };
      const intenta = async (sql: string, args: unknown[] = []) => {
        await c.query("savepoint intento");
        try { const r = await c.query(sql, args); await c.query("release savepoint intento"); return { code: null as string | null, rows: r.rows }; }
        catch (e) { await c.query("rollback to savepoint intento"); return { code: ((e as { code?: string }).code ?? "?") as string | null, rows: [] }; }
      };
      const pend = await q<{ id: string; a_id: string; b_id: string }>("select id, a_id, b_id from erp.customer_merge_suggestions where status = 'pending' order by id limit 2");
      const [p1, p2] = pend;
      if (ventas) {
        const r = await como("authenticated", ventas, () => intenta("select erp.junta_clientes($1, $2)", [p1.a_id, p1.b_id]));
        caso("ventas (sin la casilla) no puede juntar", r.code === "42501", `sqlstate ${r.code}`);
        const r2 = await como("authenticated", ventas, () => intenta("select erp.rechaza_sugerencia_de_clientes($1)", [p1.id]));
        caso("ventas no puede rechazar", r2.code === "42501", `sqlstate ${r2.code}`);
        const r3 = await como("authenticated", ventas, () => intenta("select count(*)::int n from erp.customer_merge_suggestions"));
        caso("ventas no ve la cola (la puerta del módulo)", r3.code === null && r3.rows[0].n === 0, `ve ${r3.rows[0]?.n}`);
      } else caso("hay un perfil de ventas sin la casilla para probar", false);
      const r4 = await como("anon", null, () => intenta("select erp.junta_clientes($1, $2)", [p1.a_id, p1.b_id]));
      caso("anon no puede ejecutar junta_clientes", r4.code === "42501", `sqlstate ${r4.code}`);
      const r5 = await como("authenticated", admin, () => intenta("insert into erp.customer_merge_suggestions (a_id, b_id, reason) values ($1, $2, 'x')", [p1.a_id, p1.b_id]));
      caso("ni el admin escribe la cola directo", r5.code === "42501", `sqlstate ${r5.code}`);
      const r6 = await como("authenticated", admin, () => intenta("select count(*)::int n from erp.customer_merge_suggestions where status = 'pending'"));
      caso("el admin ve la cola", r6.code === null && r6.rows[0].n > 0, `ve ${r6.rows[0]?.n} pendientes`);

      // Juntar UNA sugerencia como admin: lo mismo que el botón «Juntar».
      const filasAntesDeUna = await leeFilas(true);
      const predicha = juntaEnMemoria(filasAntesDeUna, Number(p1.a_id), Number(p1.b_id), new Date().toISOString(), () => "x");
      const r7 = await como("authenticated", admin, () => intenta("select erp.junta_clientes($1, $2) as e", [p1.a_id, p1.b_id]));
      caso(`el admin junta la sugerencia #${p1.id} (#${p1.a_id} + #${p1.b_id})`, r7.code === null, `sqlstate ${r7.code}`);
      const tras = await leeFilas(true);
      const dif = comparar(predicha.filas, tras);
      caso("…y la base deja lo que predice la app (empresas, archivado, campos, notas)", dif.length === 0, dif.slice(0, 3).join(" / "));
      const a1 = tras.find((f) => f.id === Number(p1.a_id))!, b1 = tras.find((f) => f.id === Number(p1.b_id))!;
      caso("…las dos filas quedan en la misma empresa", a1.company_id === b1.company_id);
      const st1 = (await q<{ status: string; decided_by: string }>("select status, decided_by from erp.customer_merge_suggestions where id = $1", [p1.id]))[0];
      caso("…y la sugerencia queda merged, con quién la decidió", st1.status === "merged" && st1.decided_by === admin, st1.status);
      if (predicha.pasos.length) console.log("    (esa unión archivó: " + predicha.pasos.map((p) => `#${p.archivada} → #${p.sobrevive}`).join(", ") + ")");
      const r8 = await como("authenticated", admin, () => intenta("select erp.junta_clientes($1, $2)", [predicha.pasos[0]?.archivada ?? -1, p1.a_id]));
      caso("juntar una fila archivada (o que no existe) se niega", r8.code === "22023" || r8.code === "P0002", `sqlstate ${r8.code}`);

      // Rechazar otra: queda rejected y el guion no la vuelve a proponer.
      if (p2) {
        const r9 = await como("authenticated", admin, () => intenta("select erp.rechaza_sugerencia_de_clientes($1)", [p2.id]));
        caso(`el admin rechaza la sugerencia #${p2.id}`, r9.code === null, `sqlstate ${r9.code}`);
        const metidas = await aLaCola([{ a_id: Number(p2.a_id), b_id: Number(p2.b_id), motivos: ["telefono"], score: 1 }]);
        const st2 = (await q<{ status: string }>("select status from erp.customer_merge_suggestions where id = $1", [p2.id]))[0];
        caso("…y volver a proponerla no la cambia (sigue rejected)", metidas === 0 && st2.status === "rejected", st2.status);
        const r10 = await como("authenticated", admin, () => intenta("select erp.rechaza_sugerencia_de_clientes($1)", [p2.id]));
        caso("…rechazar dos veces se niega", r10.code === "P0002", `sqlstate ${r10.code}`);
      }
    } finally {
      await c.query("rollback");
      console.log("ROLLBACK.");
    }
    const despues = (await q<{ total: string; archivadas: string }>("select count(*) total, count(*) filter (where archived_at is not null) archivadas from erp.customers"))[0];
    caso("después del ROLLBACK: mismas filas y mismas archivadas", despues.total === antes.total && despues.archivadas === antes.archivadas, `${despues.total}/${despues.archivadas}`);
    caso("después del ROLLBACK: company_id y la cola como estaban", (await hayEmpresa()) === empresaAntes && (await hayCola()) === colaAntes);
    caso("después del ROLLBACK: la 189 no está en el registro", (await q("select 1 from public.schema_migrations where name = '189_clientes_empresas.sql'")).length === 0 || empresaAntes);
    console.log(`\n${ok} OK · ${mal} MAL`);
    if (mal) process.exitCode = 1;
  }
} finally {
  await c.end();
}
