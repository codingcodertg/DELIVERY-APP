// =====================================================================================================================
// Respaldo de TODO el sistema en esta computadora (gratis, sin nube). Lo corre la Tarea programada de Windows cada día.
//
//   node --env-file=.env.local scripts/respaldo/respaldo.mjs
//
// Qué guarda, dentro de BACKUPS_DIR (por defecto C:\Users\andre\Documents\CLAUDE\RESPALDOS-DB):
//   base/AAAA-MM-DD.dump   la base completa (todos los esquemas: entregas, RR. HH., Time Tracker, ERP, clientes…) con
//                          pg_dump en formato custom. Se restaura con pg_restore (ver LEEME.txt que se escribe al lado).
//   archivos/<bucket>/…    espejo de todos los buckets de Storage (fotos, capturas, CVs, documentos). Solo baja lo nuevo
//                          o lo que cambió de tamaño; lo borrado en Supabase NO se borra aquí (un respaldo no olvida).
//   registro.log           una línea por corrida: OK o el error.
//
// Cuánto se guarda de la base: los últimos 30 días, y además el primero de cada mes durante 12 meses.
// Nada de esto escribe en Supabase: solo lee. Las llaves salen de .env.local y no se imprimen.
// =====================================================================================================================
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAIZ = process.env.BACKUPS_DIR || "C:\\Users\\andre\\Documents\\CLAUDE\\RESPALDOS-DB";
const PG_DUMP = process.env.PG_DUMP || "C:\\CLAUDE\\herramientas\\pg\\pgsql\\bin\\pg_dump.exe";
const DB_URL = process.env.SUPABASE_DB_URL;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DIAS = 30;
const MESES = 12;

const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // AAAA-MM-DD
const dirBase = path.join(RAIZ, "base");
const dirArchivos = path.join(RAIZ, "archivos");
const log = (msg) => fs.appendFileSync(path.join(RAIZ, "registro.log"), `${new Date().toISOString()} ${msg}\n`);

function corre(cmd, args, env) {
  return new Promise((ok, mal) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", mal);
    p.on("close", (c) => (c === 0 ? ok() : mal(new Error(`${path.basename(cmd)} salió con ${c}: ${err.slice(-500)}`))));
  });
}

async function respaldaBase() {
  if (!DB_URL) throw new Error("Falta SUPABASE_DB_URL en .env.local");
  if (!fs.existsSync(PG_DUMP)) throw new Error(`No encuentro pg_dump en ${PG_DUMP}`);
  fs.mkdirSync(dirBase, { recursive: true });
  const destino = path.join(dirBase, `${hoy}.dump`);
  const tmp = destino + ".parcial";
  // La contraseña va por el entorno del proceso, no en la línea de comandos (que se ve en el Administrador de tareas).
  const u = new globalThis.URL(DB_URL);
  const pass = decodeURIComponent(u.password);
  u.password = "";
  await corre(PG_DUMP, ["--format=custom", "--no-owner", "--no-privileges", "--file", tmp, "--dbname", u.toString()], { PGPASSWORD: pass });
  fs.renameSync(tmp, destino);
  return fs.statSync(destino).size;
}

function podaBase() {
  const archivos = fs.readdirSync(dirBase).filter((f) => /^\d{4}-\d{2}-\d{2}\.dump$/.test(f)).sort();
  const limite = new Date(Date.now() - DIAS * 864e5).toISOString().slice(0, 10);
  const mensuales = new Set();
  // El primero que haya de cada mes, de los últimos MESES meses.
  for (const f of archivos) {
    const mes = f.slice(0, 7);
    if (![...mensuales].some((m) => m.startsWith(mes))) mensuales.add(f);
  }
  const mesesVivos = [...mensuales].sort().slice(-MESES);
  let borrados = 0;
  for (const f of archivos) {
    if (f.slice(0, 10) >= limite || mesesVivos.includes(f)) continue;
    fs.unlinkSync(path.join(dirBase, f));
    borrados++;
  }
  return borrados;
}

// La lista de archivos sale de UNA consulta a storage.objects (nombre, bucket, tamaño), no de recorrer carpeta por
// carpeta con la API: con miles de archivos eran cientos de llamadas cada día solo para ver que no había nada nuevo.
async function listaDeObjetos() {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: DB_URL, ssl: /sslmode=/i.test(DB_URL) ? undefined : { rejectUnauthorized: false } }); // igual que aplica-migracion.mjs
  await c.connect();
  try {
    const { rows } = await c.query("select bucket_id, name, coalesce((metadata->>'size')::bigint, -1) as tam from storage.objects");
    // Un nombre raro («..», «C:», «\») no puede escribir fuera de la carpeta del respaldo: se salta y se anota.
    const segura = (b, ruta) => /^[\w.-]+$/.test(b) && ruta.split("/").every((x) => x && x !== "." && x !== ".." && !/[\\:]/.test(x));
    return rows.filter((r) => segura(r.bucket_id, r.name) || (log(`AVISO ruta rechazada ${r.bucket_id}/${r.name}`), false))
      .map((r) => ({ bucket: r.bucket_id, ruta: r.name, tam: Number(r.tam) }));
  } finally {
    await c.end();
  }
}

async function respaldaArchivos() {
  const s = createClient(URL, KEY, { auth: { persistSession: false } });
  const objetos = await listaDeObjetos();
  // Solo lo que falta aquí o cambió de tamaño; se baja de 6 en 6 para no tardar horas la primera vez.
  const pendientes = objetos.filter((o) => {
    const local = path.join(dirArchivos, o.bucket, ...o.ruta.split("/"));
    return !(fs.existsSync(local) && (o.tam < 0 || fs.statSync(local).size === o.tam));
  });
  let nuevos = 0, fallas = 0;
  const baja = async (o) => {
    const local = path.join(dirArchivos, o.bucket, ...o.ruta.split("/"));
    const { data, error } = await s.storage.from(o.bucket).download(o.ruta);
    if (error) { fallas++; log(`AVISO no bajó ${o.bucket}/${o.ruta}: ${error.message}`); return; }
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, Buffer.from(await data.arrayBuffer()));
    nuevos++;
  };
  for (let i = 0; i < pendientes.length; i += 6) await Promise.all(pendientes.slice(i, i + 6).map(baja));
  return { nuevos, total: objetos.length, fallas };
}

function escribeLeeme() {
  fs.writeFileSync(path.join(RAIZ, "LEEME.txt"), [
    "RESPALDO DEL HUB",
    "",
    "base\\AAAA-MM-DD.dump  = la base completa de ese día.",
    "archivos\\<bucket>\\    = copia de todos los archivos (fotos, capturas, CVs, documentos).",
    "",
    "Restaurar la base en una base de PRUEBA (nunca directo en la de producción sin hablarlo):",
    `  "${PG_DUMP.replace("pg_dump.exe", "pg_restore.exe")}" --no-owner --no-privileges --dbname "<url de la base de prueba>" base\\AAAA-MM-DD.dump`,
    "",
    "Ver el contenido sin restaurar:",
    `  "${PG_DUMP.replace("pg_dump.exe", "pg_restore.exe")}" --list base\\AAAA-MM-DD.dump`,
    "",
  ].join("\r\n"));
}

fs.mkdirSync(RAIZ, { recursive: true });
const t0 = Date.now();
try {
  const tam = await respaldaBase();
  const podados = podaBase();
  const a = await respaldaArchivos();
  escribeLeeme();
  const msg = `OK base ${(tam / 1048576).toFixed(1)} MB · archivos ${a.nuevos} nuevos de ${a.total}${a.fallas ? ` · ${a.fallas} fallas` : ""} · ${podados} respaldos viejos borrados · ${Math.round((Date.now() - t0) / 1000)} s`;
  log(msg);
  console.log(msg);
  if (a.fallas) process.exitCode = 2;
} catch (e) {
  log(`ERROR ${e.message}`);
  console.error(`ERROR ${e.message}`);
  process.exitCode = 1;
}
