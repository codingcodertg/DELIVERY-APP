// Barrido de una vez (D-NEXT, migración 193): rellena la lista de contactos (`contacts`) de cada cliente a partir de sus
// cuatro columnas de antes, donde el Excel lo escribía todo junto («956-605-8867 - Emmanuel», «…, A/P owner», correos con
// «;»), y deja esas cuatro columnas como espejo limpio del primer contacto. El dueño, 2026-10-24: «quiero que me hagas una
// auditoría de todos los datos de los clientes […] si tienen varios correos, no solo esté el correo y coma […] quiero que
// el contacto sea Omar y abajo el número de teléfono».
//
// Usa la MISMA función de la app (`contactosDeLosCampos`, `espejoDeContactos`), no una copia. Solo toca las filas cuya
// lista está vacía (lo que alguien ya editó en la ficha no se pisa), archivadas incluidas. Sin `--escribe`, solo cuenta,
// enseña ejemplos y escribe el informe de la auditoría (un CSV con el antes y el después de cada fila que cambia) en
// D:\CLAUDE\entregas. Funciona antes de la 193 (lee la lista con `to_jsonb`); escribir necesita la 193.
//
// Con `--escribe`: primero guarda en D:\CLAUDE\respaldos-db un JSON con los valores de ANTES de cada fila que cambia (para
// poder deshacerlo), y luego actualiza, en una transacción, y vuelve a medir.
//
//   node --env-file=.env.local scripts/contactos-de-clientes.mts             (ver + informe)
//   node --env-file=.env.local scripts/contactos-de-clientes.mts --escribe   (hacer)
import pg from "pg";
import { writeFileSync } from "node:fs";
import { contactosDeLosCampos, espejoDeContactos, type Contacto } from "../src/lib/customers/formato.ts";

const ESPEJO = ["contact_name", "contact_title", "phone", "email"] as const;
type Fila = { id: number; store: string; account: string; archived_at: string | null; contacts: unknown } & Record<(typeof ESPEJO)[number], string | null>;
type Cambio = { contacts?: Contacto[] } & Partial<Record<(typeof ESPEJO)[number], string | null>>;

/** Lo que cambia en cada fila con la lista vacía: la lista (si sale algo) y el espejo, solo lo que difiere. */
function planDe(filas: Fila[]) {
  const out: { r: Fila; lista: Contacto[]; cambio: Cambio }[] = [];
  for (const r of filas) {
    if (Array.isArray(r.contacts) && r.contacts.length > 0) continue;
    const lista = contactosDeLosCampos(r);
    const espejo = espejoDeContactos(lista);
    const cambio: Cambio = {};
    if (lista.length) cambio.contacts = lista;
    for (const k of ESPEJO) if ((r[k] ?? null) !== espejo[k]) cambio[k] = espejo[k];
    if (Object.keys(cambio).length) out.push({ r, lista, cambio });
  }
  return out;
}

const escribe = process.argv.includes("--escribe");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
if (!escribe) await c.query("set default_transaction_read_only = on");
const lee = async () => (await c.query<Fila>(
  `select id, store, account, archived_at, ${ESPEJO.join(", ")}, coalesce(to_jsonb(x) -> 'contacts', '[]'::jsonb) as contacts from erp.customers x order by id`,
)).rows;

const filas = await lee();
const plan = planDe(filas);
const cuenta = (f: (p: (typeof plan)[number]) => boolean) => plan.filter(f).length;
console.log(`clientes: ${filas.length} · con la lista ya puesta: ${filas.filter((r) => Array.isArray(r.contacts) && r.contacts.length > 0).length} · por cambiar: ${plan.length}`);
console.log({
  conContactos: cuenta((p) => p.lista.length > 0),
  variosContactos: cuenta((p) => p.lista.length > 1),
  variosTelefonos: cuenta((p) => p.lista.some((x) => x.phones.length > 1)),
  variosCorreos: cuenta((p) => p.lista.some((x) => x.emails.length > 1)),
  conNota: cuenta((p) => p.lista.some((x) => x.note)),
  nombreSacadoDelTelefono: cuenta((p) => !p.r.contact_name && p.lista.some((x) => x.name)),
  telefonoSinFormato: cuenta((p) => p.lista.some((x) => x.phones.some((t) => !/^\(\d{3}\) \d{3}-\d{4}$/.test(t)))),
  espejo: Object.fromEntries(ESPEJO.map((k) => [k, cuenta((p) => k in p.cambio)])),
});
for (const { r, lista } of plan.filter((p) => p.lista.length > 1 || p.lista.some((x) => x.note)).slice(0, 8)) {
  console.log(`  #${r.id} ${r.store} ${JSON.stringify(r.phone)} ${JSON.stringify(r.email)} → ${JSON.stringify(lista)}`);
}

// El informe de la auditoría: una línea por fila que cambia, con el antes y el después, para revisarlo en Excel.
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const persona = (x: Contacto) => [x.name, x.title && `(${x.title})`, x.phones.join(" / "), x.emails.join("; "), x.note && `nota: ${x.note}`].filter(Boolean).join(" · ");
const lineas = [
  ["id", "tienda", "cuenta", "archivada", "contacto (antes)", "cargo (antes)", "teléfono (antes)", "correo (antes)", "contactos (después)", "cuántos", "revisar"].map(csv).join(","),
  ...plan.map(({ r, lista }) => [
    r.id, r.store, r.account, r.archived_at ? "sí" : "", r.contact_name, r.contact_title, r.phone, r.email,
    lista.map((x, i) => `${i + 1}) ${persona(x)}`).join("  |  "), lista.length,
    lista.length > 1 || lista.some((x) => x.note || x.phones.some((t) => !/^\(\d{3}\) \d{3}-\d{4}$/.test(t))) ? "sí" : "",
  ].map(csv).join(",")),
];
const sello = new Date().toISOString().replace(/[:.]/g, "-");
const informe = `D:/CLAUDE/entregas/auditoria-contactos-de-clientes-${sello}.csv`;
writeFileSync(informe, "\uFEFF" + lineas.join("\r\n"));
console.log("informe:", informe);

if (escribe && plan.length) {
  const respaldo = `D:/CLAUDE/respaldos-db/clientes-antes-de-los-contactos-${sello}.json`;
  writeFileSync(respaldo, JSON.stringify(plan.map(({ r, cambio }) => ({
    id: r.id, antes: { contacts: r.contacts, ...Object.fromEntries(ESPEJO.filter((k) => k in cambio).map((k) => [k, r[k] ?? null])) }, despues: cambio,
  })), null, 2));
  console.log("respaldo:", respaldo);
  await c.query("begin");
  let n = 0;
  for (const { r, cambio } of plan) {
    const ks = Object.keys(cambio) as (keyof Cambio)[];
    const sets = ks.map((k, i) => (k === "contacts" ? `contacts = $${i + 2}::jsonb` : `${k} = $${i + 2}`)).join(", ");
    const valores = ks.map((k) => (k === "contacts" ? JSON.stringify(cambio.contacts) : cambio[k]));
    // Solo si la lista sigue vacía: lo que alguien guardó desde la ficha mientras tanto no se pisa.
    const res = await c.query(`update erp.customers set ${sets} where id = $1 and contacts = '[]'::jsonb`, [r.id, ...valores]);
    n += res.rowCount ?? 0;
  }
  if (n !== plan.length) { await c.query("rollback"); throw new Error(`se esperaban ${plan.length} filas y fueron ${n}: deshecho`); }
  await c.query("commit");
  const despues = planDe(await lee());
  console.log(`actualizados: ${n} · quedan por rellenar: ${despues.length}`);
}
await c.end();
