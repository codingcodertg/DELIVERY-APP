// Carga en el expediente de RR. HH. lo que dice el archivo «RTG EMAILS» del dueño (D-NEXT, migración 207).
//
//   node --env-file=.env.local scripts/carga-herramientas-de-empleados.mjs "C:/ruta/RTG EMAILS(output).csv"            → ensayo: dice qué haría
//   node --env-file=.env.local scripts/carga-herramientas-de-empleados.mjs "C:/ruta/RTG EMAILS(output).csv" --escribe  → escribe
//
// REGLAS.
//  - Cada fila del archivo es una LICENCIA (un correo / un puesto). Las filas sin persona («Pending», «EXTRA», «MAIN»)
//    no son nadie: se cuentan aparte como «licencias sin persona» y no crean expediente.
//  - Una persona se busca por su correo de trabajo (si el expediente con ese correo no está de baja), y si no, por su
//    nombre sin acentos. Dos filas de la misma persona (la gerente con correo de tienda y de grupo) se juntan: el segundo
//    correo va en `second_email` y el costo se suma.
//  - SOLO SE LLENA LO VACÍO. Un dato que ya está en el expediente no se pisa; si el archivo dice otra cosa, se avisa como
//    «conflicto» y se deja como estaba. Lo nuevo de la 207 está vacío en todos, así que se llena entero.
//  - No crea expedientes: a quien no está en RR. HH. lo lista para que el dueño lo agregue (o lo corrija el nombre).
//  - Escribe con `pg` directo, en una transacción; sin --escribe, ROLLBACK.
import fs from "node:fs";
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");
const { Client } = pg;
// Las fechas, como texto «AAAA-MM-DD» y no como Date: así se comparan con el archivo sin que la zona horaria mueva un día.
pg.types.setTypeParser(1082, (v) => v);

const ruta = process.argv.find((a) => a.endsWith(".csv"));
const escribe = process.argv.includes("--escribe");
if (!ruta) { console.error("Uso: node --env-file=.env.local scripts/carga-herramientas-de-empleados.mjs <archivo.csv> [--escribe]"); process.exit(1); }

// ---------- el archivo ----------
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

const SIN_PERSONA = new Set(["Pending", "EXTRA", "MAIN", ""]);
const limpio = (s) => (s ?? "").trim();
const sinAcentos = (s) => limpio(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
const dinero = (s) => { const n = Number(limpio(s).replace(/[$,\s]/g, "")); return limpio(s) && Number.isFinite(n) ? n : null; };
const fecha = (s) => {
  const v = limpio(s); if (!v) return null;
  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  // «RR010121» = iniciales + MMDDYY: así vienen dos del grupo. Se lee, y se avisa.
  m = v.match(/^[A-Z]{2}(\d{2})(\d{2})(\d{2})$/);
  if (m) return { inferida: `20${m[3]}-${m[1]}-${m[2]}`, de: v };
  return { invalida: v };
};
const telefono = (s) => {
  const v = limpio(s); if (!v || /[a-z?]/i.test(v)) return null;
  const d = v.replace(/\D/g, ""); const diez = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return diez.length === 10 ? `${diez.slice(0, 3)}-${diez.slice(3, 6)}-${diez.slice(6)}` : v;
};
const onePw = (s) => ({ yes: "yes", no: "no", maybe: "maybe" })[limpio(s).toLowerCase()] ?? null;
const texto = (s) => { const v = limpio(s); return v && v !== "N/A" && v !== "NA" ? v : null; };
const TIENDA = { BRO: "RDZ Brownsville", WES: "RDZ Weslaco", PHR: "RDZ Pharr", MCA: "RDZ McAllen", MIS: "RDZ Mission", EDG: "RDZ Edinburg", GROUP: null };
const DEPTO = (rol) => /sales/i.test(rol) ? "Ventas" : /driver/i.test(rol) ? "Choferes" : /warehouse|inventory/i.test(rol) ? "Almacén" : rol ? "Oficina" : null;

// ---------- personas del archivo (una fila por persona; dos correos se juntan) ----------
const personas = new Map(); const licenciasSinPersona = []; const avisos = [];
for (const r of registros) {
  const nombre = `${limpio(r["FIRST NAME"])} ${limpio(r["LAST NAME"])}`.trim();
  const email = limpio(r.EMAIL).toLowerCase() || null;
  if (SIN_PERSONA.has(limpio(r["FIRST NAME"]))) { licenciasSinPersona.push({ email, plan: r["EMAIL TYPE"], costo: dinero(r["COST/YR"]), nota: nombre }); continue; }
  const clave = sinAcentos(nombre);
  const f = fecha(r["DATE HIRED"]);
  if (f && typeof f === "object" && f.inferida) avisos.push(`${nombre}: fecha de ingreso «${f.de}» leída como ${f.inferida}`);
  if (f && typeof f === "object" && f.invalida) avisos.push(`${nombre}: fecha de ingreso «${f.invalida}» no se entiende; no se carga`);
  const p = {
    nombre, clave, emails: email ? [email] : [], costo: dinero(r["COST/YR"]),
    datos: {
      date_hired: f && typeof f === "string" ? f : f?.inferida ?? null,
      email_plan: texto(r["EMAIL TYPE"]), email_renewal_date: typeof fecha(r["EMAIL RENEWAL DATE"]) === "string" ? fecha(r["EMAIL RENEWAL DATE"]) : null,
      app_username: texto(r.USERNAMES), job_title: texto(r.ROLE), onepassword: onePw(r["1PW"]),
      store: TIENDA[limpio(r.STORE)] ?? null, department: DEPTO(limpio(r.ROLE)),
      previous_phone: telefono(r.PREVIOUS), phone: telefono(r["WORK PHONE"]), ringcentral_ext: texto(r["EXT #"]),
      device_serial: texto(r["SERIAL #"]), personal_phone: telefono(r["PERSONAL PHONE"]),
      qb_initials: /^[A-Z]{2,4}$/.test(limpio(r["QB Initials"])) ? limpio(r["QB Initials"]) : null,
      risk_score: dinero(r.RISK), performance_score: dinero(r.PERFORMANCE), score_status: texto(r.STATUS), score_action: texto(r.ACTION),
      remote_pc_name: texto(r["RPC PC NAME"]), remote_pc_status: texto(r["RPC PW"]),
      rc_user_created: texto(r["RC USER CREATED"]), rc_device_assigned: texto(r["RCDEVICE ASSIGNED"]),
    },
  };
  const ya = personas.get(clave);
  if (!ya) { personas.set(clave, p); continue; }
  // La misma persona otra vez: segundo correo, costo sumado, y de lo demás lo primero que no esté vacío.
  ya.emails.push(...p.emails); ya.costo = (ya.costo ?? 0) + (p.costo ?? 0) || ya.costo;
  for (const [k, v] of Object.entries(p.datos)) if (ya.datos[k] == null && v != null) ya.datos[k] = v;
  if (ya.datos.ringcentral_ext && p.datos.ringcentral_ext && ya.datos.ringcentral_ext !== p.datos.ringcentral_ext) ya.datos.ringcentral_ext = `${ya.datos.ringcentral_ext} / ${p.datos.ringcentral_ext}`;
}
for (const p of personas.values()) {
  p.datos.email = p.emails[0] ?? null; p.datos.second_email = p.emails[1] ?? null; p.datos.email_cost_year = p.costo;
  if (p.emails.length > 2) avisos.push(`${p.nombre}: tiene ${p.emails.length} correos; solo caben dos`);
}

// ---------- la base ----------
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin");
const leeFicheros = async () => (await c.query(`select e.*, p.full_name as nombre_perfil, p.store as tienda_cuenta from recruiting.employee_files e left join public.profiles p on p.id = e.profile_id`)).rows;
let ficheros = await leeFicheros();
if (!ficheros.length || !("email_plan" in ficheros[0])) {
  if (escribe) { console.error("La tabla no tiene las columnas de la 207: aplica la migración primero."); await c.query("rollback"); await c.end(); process.exit(1); }
  // En el ensayo, la 207 se aplica DENTRO de esta misma transacción (sin su registro) para poder enseñar el plan; el
  // ROLLBACK del final la deshace con todo lo demás.
  const sql = fs.readFileSync(new URL("../supabase/migrations/207_herramientas_del_empleado.sql", import.meta.url), "utf8").split("-- @ledger-below")[0];
  await c.query(sql);
  ficheros = await leeFicheros();
  console.log("(ensayo: la 207 aún no está aplicada; se aplicó solo dentro de esta transacción, que se deshace)\n");
}
const nombreDe = (f) => sinAcentos(f.nombre_perfil || f.full_name);
const deBaja = (f) => !!f.date_left;

const cambios = []; const conflictos = []; const noEncontrados = []; const usados = new Set();
for (const p of personas.values()) {
  let f = ficheros.find((x) => x.email && p.emails.includes(x.email.toLowerCase()) && !deBaja(x) && !usados.has(x.id));
  if (!f) f = ficheros.find((x) => nombreDe(x) === p.clave && !usados.has(x.id) && !deBaja(x))
    ?? ficheros.find((x) => nombreDe(x) === p.clave && !usados.has(x.id))
    ?? ficheros.find((x) => x.email && p.emails.includes(x.email.toLowerCase()) && !usados.has(x.id));
  // Sin apellido en el archivo («Joseph»): vale si hay UN solo expediente activo con ese nombre de pila.
  if (!f && !p.clave.includes(" ")) {
    const cand = ficheros.filter((x) => nombreDe(x).split(" ")[0] === p.clave && !usados.has(x.id) && !deBaja(x));
    if (cand.length === 1) { f = cand[0]; avisos.push(`${p.nombre}: sin apellido en el archivo; se tomó como ${f.nombre_perfil || f.full_name}`); }
  }
  if (!f) { noEncontrados.push(p); continue; }
  usados.add(f.id);
  const parche = {};
  for (const [k, v] of Object.entries(p.datos)) {
    if (v == null) continue;
    // Con cuenta, la tienda es la de la cuenta (D-258): no se toca el expediente.
    if (k === "store" && f.profile_id) continue;
    const actual = f[k];
    if (actual == null || actual === "") { parche[k] = v; continue; }
    const igual = typeof actual === "number" ? Number(actual) === Number(v) : sinAcentos(String(actual).replace(/\D/g, "") || String(actual)) === sinAcentos(String(v).replace(/\D/g, "") || String(v));
    if (!igual && String(actual).split("T")[0] !== String(v)) conflictos.push(`${p.nombre} · ${k}: expediente «${actual}» · archivo «${v}» (se deja el expediente)`);
  }
  if (Object.keys(parche).length) cambios.push({ id: f.id, quien: f.nombre_perfil || f.full_name, parche });
}

// ---------- informe ----------
console.log(`Archivo: ${registros.length} filas → ${personas.size} personas, ${licenciasSinPersona.length} licencias sin persona.`);
console.log(`Expedientes: ${ficheros.length}. Con cambios: ${cambios.length}. Conflictos: ${conflictos.length}. Sin expediente: ${noEncontrados.length}.\n`);
for (const ch of cambios) console.log(`+ ${ch.quien}: ${Object.entries(ch.parche).map(([k, v]) => `${k}=${v}`).join(", ")}`);
if (conflictos.length) { console.log("\nCONFLICTOS (no se tocan):"); for (const x of conflictos) console.log("  ! " + x); }
if (noEncontrados.length) { console.log("\nSIN EXPEDIENTE (el dueño los agrega en RR. HH. → Agregar):"); for (const p of noEncontrados) console.log(`  ? ${p.nombre} (${p.emails.join(", ") || "sin correo"}) ${p.datos.job_title ?? ""} ${p.datos.store ?? ""}`); }
if (avisos.length) { console.log("\nAVISOS:"); for (const a of avisos) console.log("  · " + a); }
const costoSinPersona = licenciasSinPersona.reduce((a, l) => a + (l.costo ?? 0), 0);
console.log(`\nLICENCIAS SIN PERSONA (${licenciasSinPersona.length}, $${costoSinPersona.toFixed(2)}/año):`);
for (const l of licenciasSinPersona) console.log(`  - ${l.email ?? "(sin correo)"} · ${l.plan} · $${(l.costo ?? 0).toFixed(2)} · ${l.nota}`);
const enRrhhNoEnArchivo = ficheros.filter((f) => !usados.has(f.id) && !deBaja(f)).map((f) => f.nombre_perfil || f.full_name);
console.log(`\nEN RR. HH. Y NO EN EL ARCHIVO (${enRrhhNoEnArchivo.length}): ${enRrhhNoEnArchivo.join(", ")}`);

// ---------- escribir ----------
let n = 0;
for (const ch of cambios) {
  const cols = Object.keys(ch.parche);
  const r = await c.query(`update recruiting.employee_files set ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [ch.id, ...cols.map((k) => ch.parche[k])]);
  n += r.rowCount;
}
if (escribe) { await c.query("commit"); console.log(`\nESCRITO: ${n} expedientes actualizados.`); }
else { await c.query("rollback"); console.log(`\nENSAYO: ${n} expedientes se actualizarían. Nada cambió. Para escribir, el mismo comando con --escribe.`); }
await c.end();
