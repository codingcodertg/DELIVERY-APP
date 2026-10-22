// Barrido de una vez: pone en formato estándar (D-635) los clientes YA guardados en erp.customers — nombres en
// MAYÚSCULAS con un solo espacio (cuenta, cuenta unificada, contacto, cargo), teléfono «(956) 340-5910» y correo en
// minúsculas. El dueño, 2026-10-21: «en customer haz lo mismo de estandarizar: nombre todos caps, los teléfonos en el
// formato que te dije». Lo nuevo ya sale así: el cajón guarda en formato (`parcheDe`) y el importador también.
//
// Usa la MISMA función de la app (`estandarizaCliente`), no una copia. Todas las filas, archivadas incluidas (siguen
// siendo filas que se pueden abrir). Sin `--escribe` solo cuenta y enseña ejemplos.
//
// El índice único de la 180 es (tienda, lower(btrim(cuenta))): juntar los espacios dobles podría hacer que dos filas de la
// misma tienda choquen («DURGA  PROPERTIES» y «DURGA PROPERTIES»). Esas cuentas NO se tocan (el resto de la fila sí) y
// se listan: son duplicados para «Decidir si se juntan».
//
// Con `--escribe`: primero guarda en D:\CLAUDE\respaldos-db un JSON con los valores de ANTES de cada fila que cambia
// (para poder deshacerlo), y luego actualiza solo esos campos, en una transacción, y vuelve a medir.
//
//   node --env-file=.env.local scripts/estandariza-clientes.mts             (ver)
//   node --env-file=.env.local scripts/estandariza-clientes.mts --escribe   (hacer)
import pg from "pg";
import { writeFileSync } from "node:fs";
import { estandarizaCliente } from "../src/lib/customers/formato.ts";

const CAMPOS = ["account", "unified_account", "contact_name", "contact_title", "phone", "email"] as const;
type Fila = { id: number; store: string } & Record<(typeof CAMPOS)[number], string | null>;

const clave = (store: string, account: string | null) => `${store.trim().toUpperCase()}|${(account ?? "").trim().toLowerCase()}`;

/** Los cambios de cada fila, sin las cuentas que chocarían con otra fila de la misma tienda. */
function planDe(filas: Fila[]) {
  const cambios = filas.map((r) => ({ r, cambio: estandarizaCliente(r) as Partial<Fila> }));
  const cuantas = new Map<string, number>();
  for (const { r, cambio } of cambios) {
    const k = clave(r.store, cambio.account ?? r.account);
    cuantas.set(k, (cuantas.get(k) ?? 0) + 1);
  }
  const choques: string[] = [];
  for (const { r, cambio } of cambios) {
    if (cambio.account === undefined) continue;
    if ((cuantas.get(clave(r.store, cambio.account)) ?? 0) > 1) {
      choques.push(`#${r.id} ${r.store} ${JSON.stringify(r.account)}`);
      delete cambio.account;
    }
  }
  return { porCambiar: cambios.filter((x) => Object.keys(x.cambio).length > 0), choques };
}

const escribe = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
if (!escribe) await c.query("set default_transaction_read_only = on");
const lee = async () => (await c.query<Fila>(`select id, store, ${CAMPOS.join(", ")} from erp.customers order by id`)).rows;

const filas = await lee();
const { porCambiar, choques } = planDe(filas);
const por: Record<string, number> = {};
for (const { cambio } of porCambiar) for (const k of Object.keys(cambio)) por[k] = (por[k] ?? 0) + 1;
console.log(`clientes: ${filas.length} · por cambiar: ${porCambiar.length} ·`, por);
console.log(`cuentas que chocarían en su tienda (no se tocan): ${choques.length}`, choques);
for (const { r, cambio } of porCambiar.slice(0, 10)) {
  for (const k of Object.keys(cambio)) console.log(`  #${r.id} ${k}: ${JSON.stringify(r[k as keyof Fila])} → ${JSON.stringify(cambio[k as keyof Fila])}`);
}

if (escribe && porCambiar.length) {
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const respaldo = `D:/CLAUDE/respaldos-db/clientes-antes-del-formato-${sello}.json`;
  writeFileSync(respaldo, JSON.stringify(porCambiar.map(({ r, cambio }) => ({
    id: r.id, antes: Object.fromEntries(Object.keys(cambio).map((k) => [k, r[k as keyof Fila] ?? null])), despues: cambio,
  })), null, 2));
  console.log("respaldo:", respaldo);
  await c.query("begin");
  let n = 0;
  for (const { r, cambio } of porCambiar) {
    const ks = Object.keys(cambio);
    const sets = ks.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const res = await c.query(`update erp.customers set ${sets} where id = $1`, [r.id, ...ks.map((k) => cambio[k as keyof Fila])]);
    n += res.rowCount ?? 0;
  }
  if (n !== porCambiar.length) { await c.query("rollback"); throw new Error(`se esperaban ${porCambiar.length} filas y fueron ${n}: deshecho`); }
  await c.query("commit");
  const despues = planDe(await lee());
  console.log(`actualizados: ${n} · quedan fuera de formato: ${despues.porCambiar.length} (las cuentas que chocan: ${despues.choques.length})`);
}
await c.end();
