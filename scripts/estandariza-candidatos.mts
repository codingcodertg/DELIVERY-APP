// Barrido de una vez: pone en formato estándar (D-610) los candidatos YA guardados — teléfono «(956) 340-5910», nombre
// con mayúsculas iniciales, correo en minúsculas, y lo mismo en los teléfonos y correos extra. El dueño, 2026-10-21:
// «acuérdate lo que te pedí de estandarizar currículums, números de teléfono, entonces todos los pasados también
// arréglalos». Los nuevos ya salen así desde D-610 (el proveedor de RR. HH. estandariza en el alta y en la edición).
//
// Usa la MISMA función de la app (`estandarizaCandidato`), no una copia. Sin `--escribe` solo cuenta y enseña ejemplos.
// Con `--escribe`: primero guarda en D:\CLAUDE\respaldos-db un JSON con los valores de ANTES de cada fila que cambia
// (para poder deshacerlo), y luego actualiza solo esos campos, en una transacción, y vuelve a medir: debe quedar 0.
//
//   node --env-file=.env.local scripts/estandariza-candidatos.mts             (ver)
//   node --env-file=.env.local scripts/estandariza-candidatos.mts --escribe   (hacer)
import pg from "pg";
import { writeFileSync } from "node:fs";
import { estandarizaCandidato } from "../src/lib/recruiting/formato.ts";

const CAMPOS = ["name", "phone", "email", "extra_phones", "extra_emails"] as const;
type Fila = { id: string } & Record<(typeof CAMPOS)[number], unknown>;

function cambios(r: Fila): Partial<Fila> {
  const e = estandarizaCandidato({
    name: r.name as string,
    phone: (r.phone as string | null) ?? undefined,
    email: r.email as string | null,
    extra_phones: (r.extra_phones as string[] | null) ?? undefined,
    extra_emails: (r.extra_emails as string[] | null) ?? undefined,
  } as never) as Record<string, unknown>;
  const out: Partial<Fila> = {};
  for (const k of CAMPOS) {
    const antes = r[k] ?? null;
    const despues = e[k] === undefined ? antes : e[k];
    if (k === "phone" && (antes ?? "") === (despues ?? "")) continue;
    if (JSON.stringify(antes) !== JSON.stringify(despues)) (out as Record<string, unknown>)[k] = despues;
  }
  return out;
}

const escribe = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
if (!escribe) await c.query("set default_transaction_read_only = on");
const lee = async () => (await c.query<Fila>(`select id, ${CAMPOS.join(", ")} from recruiting.candidates order by created_at`)).rows;

const filas = await lee();
const porCambiar = filas.map((r) => ({ r, cambio: cambios(r) })).filter((x) => Object.keys(x.cambio).length > 0);
const por: Record<string, number> = {};
for (const { cambio } of porCambiar) for (const k of Object.keys(cambio)) por[k] = (por[k] ?? 0) + 1;
console.log(`candidatos: ${filas.length} · por cambiar: ${porCambiar.length} ·`, por);
for (const { r, cambio } of porCambiar.slice(0, 8)) {
  for (const k of Object.keys(cambio)) console.log(`  ${k}: ${JSON.stringify(r[k as keyof Fila])} → ${JSON.stringify(cambio[k as keyof Fila])}`);
}

if (escribe && porCambiar.length) {
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const respaldo = `D:/CLAUDE/respaldos-db/candidatos-antes-del-formato-${sello}.json`;
  writeFileSync(respaldo, JSON.stringify(porCambiar.map(({ r, cambio }) => ({
    id: r.id, antes: Object.fromEntries(Object.keys(cambio).map((k) => [k, r[k as keyof Fila] ?? null])), despues: cambio,
  })), null, 2));
  console.log("respaldo:", respaldo);
  await c.query("begin");
  let n = 0;
  for (const { r, cambio } of porCambiar) {
    const ks = Object.keys(cambio);
    const sets = ks.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const res = await c.query(`update recruiting.candidates set ${sets} where id = $1`, [r.id, ...ks.map((k) => cambio[k as keyof Fila])]);
    n += res.rowCount ?? 0;
  }
  if (n !== porCambiar.length) { await c.query("rollback"); throw new Error(`se esperaban ${porCambiar.length} filas y fueron ${n}: deshecho`); }
  await c.query("commit");
  const quedan = (await lee()).filter((r) => Object.keys(cambios(r)).length > 0).length;
  console.log(`actualizados: ${n} · quedan fuera de formato: ${quedan}`);
}
await c.end();
