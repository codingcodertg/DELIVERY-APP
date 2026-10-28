// Carga los correos y números del archivo «RTG EMAILS» del dueño en recruiting.company_assets (D-730, migración 211).
//
//   node --env-file=.env.local scripts/carga-activos-de-empresa.mjs "C:/ruta/RTG EMAILS(output).csv"            → ensayo
//   node --env-file=.env.local scripts/carga-activos-de-empresa.mjs "C:/ruta/RTG EMAILS(output).csv" --escribe  → escribe
//
// REGLAS. Cada fila del archivo es un correo y/o un número. Con persona (nombre que no sea Pending/EXTRA/MAIN ni
// TERMINATED) se busca su expediente (por correo de trabajo, y si no por nombre sin acentos) y el activo nace «asignado»;
// sin expediente se avisa y nace «disponible». TERMINATED: el correo «pendiente de respaldo», el número «disponible».
// DELETE-BACKUP: «pendiente de respaldo». Lo que ya está en la tabla (mismo tipo y valor) NO se pisa: se avisa.
import fs from "node:fs";
import { createRequire } from "node:module";
import { activosDeLaFila, estadoInicial } from "../src/lib/recruiting/activos.ts";
const pg = createRequire(import.meta.url)("pg");

const ruta = process.argv.find((a) => a.endsWith(".csv"));
const escribe = process.argv.includes("--escribe");
if (!ruta) { console.error("Uso: node --env-file=.env.local scripts/carga-activos-de-empresa.mjs <archivo.csv> [--escribe]"); process.exit(1); }

const txt = fs.readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
const filas = txt.split("\n").map((line) => {
  const out = []; let cur = "", q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; }
  out.push(cur); return out.map((s) => s.trim());
});
const iCab = filas.findIndex((r) => r[0] === "DATE HIRED");
if (iCab < 0) { console.error("No encuentro la cabecera DATE HIRED"); process.exit(1); }
const cab = filas[iCab].slice(0, 28);
const registros = filas.slice(iCab + 1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(cab.map((h, j) => [h, r[j] ?? ""])));

const sinAcentos = (s) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin");
const { rows: expedientes } = await c.query("select f.id, f.full_name, f.email, f.date_left, p.full_name as nombre_perfil from recruiting.employee_files f left join public.profiles p on p.id = f.profile_id");
const { rows: existentes } = await c.query("select kind, value from recruiting.company_assets");
const yaHay = new Set(existentes.map((x) => x.kind + ":" + x.value));
const porCorreo = new Map(expedientes.filter((e) => e.email && !e.date_left).map((e) => [e.email.toLowerCase(), e]));
const porNombre = new Map(expedientes.map((e) => [sinAcentos(e.nombre_perfil || e.full_name), e]));

let nuevos = 0, saltados = 0, sinExpediente = [];
const planes = [];
// Primero las filas con persona: un número repetido (el de alguien que se fue y el de quien lo heredó) se queda con quien lo tiene.
const ordenadas = registros.map((r) => ({ r, x: activosDeLaFila(r) })).sort((a, b) => Number(!!b.x.nombre) - Number(!!a.x.nombre));
for (const { r, x } of ordenadas) {
  void r;
  let exp = null;
  if (x.nombre) {
    exp = (x.email && porCorreo.get(x.email.value)) || porNombre.get(sinAcentos(x.nombre)) || null;
    if (!exp) sinExpediente.push(x.nombre);
  }
  for (const a of [x.email, x.phone]) {
    if (!a) continue;
    const k = a.kind + ":" + a.value;
    if (yaHay.has(k)) { saltados++; continue; }
    yaHay.add(k);
    const status = estadoInicial(a.kind, x, !!exp);
    planes.push({ ...a, status, employee_id: exp ? exp.id : null, quien: exp ? (exp.nombre_perfil || exp.full_name) : (x.nombre ? x.nombre + " (SIN EXPEDIENTE)" : "") });
  }
}
for (const p of planes) {
  console.log(`${p.kind === "email" ? "✉️ " : "📞 "}${p.value.padEnd(34)} ${(p.ext ? "ext " + p.ext : "").padEnd(8)} ${(p.phone_type ?? "").padEnd(9)} ${p.status.padEnd(15)} ${p.quien}`);
  if (escribe) {
    await c.query(
      "insert into recruiting.company_assets (kind, value, ext, phone_type, status, employee_id, plan, cost_year, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (kind, value) do nothing",
      [p.kind, p.value, p.ext, p.phone_type, p.status, p.employee_id, p.plan, p.cost_year, p.note],
    );
    nuevos++;
  }
}
console.log(`\nfilas del archivo: ${registros.length} · activos por crear: ${planes.length} · ya estaban: ${saltados}`);
if (sinExpediente.length) console.log("sin expediente (nacen disponibles):", [...new Set(sinExpediente)].join(", "));
if (escribe) { await c.query("commit"); console.log(`ESCRITO: ${nuevos} activos.`); } else { await c.query("rollback"); console.log("ENSAYO: nada escrito. Con --escribe se escribe."); }
await c.end();
