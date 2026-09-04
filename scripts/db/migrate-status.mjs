#!/usr/bin/env node
// Estado de migraciones: compara supabase/migrations/*.sql con public.schema_migrations y dice
// que falta aplicar. Que "¿que falta?" sea un comando, no arqueologia (D-184).
//
// Uso:
//   node scripts/db/migrate-status.mjs            → lista pendientes / cambiadas / huerfanas
//   node scripts/db/migrate-status.mjs --sum FILE → imprime el checksum y la linea de registro
//                                                    para pegar al final de una migracion nueva
//
// Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local (service-role salta la
// RLS de la tabla, que es admin-only para SELECT). Sale con codigo 1 si hay pendientes o
// cambiadas, para poder engancharlo a CI o al "antes de aplicar, correr el status".

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIG_DIR = join(ROOT, "supabase", "migrations");
const MARK = "-- @ledger-below";

// Checksum: sha256 del fichero con saltos normalizados a LF, tomando SOLO lo anterior al
// marcador '-- @ledger-below' (identico a gen del backfill en 102). Asi el propio bloque de
// registro de una migracion no altera su checksum.
function checksum(text) {
  const lf = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = lf.split(MARK)[0];
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function loadEnv() {
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* sin .env.local: se usan las env ya presentes */
  }
}

function repoMigrations() {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, checksum: checksum(readFileSync(join(MIG_DIR, f), "utf8")) }));
}

async function appliedMap() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (en .env.local o el entorno).");
  }
  const res = await fetch(`${url}/rest/v1/schema_migrations?select=name,checksum`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`No se pudo leer public.schema_migrations: ${res.status} ${await res.text()}`);
  }
  return new Map((await res.json()).map((r) => [r.name, r.checksum]));
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);

  if (args[0] === "--sum") {
    const file = args[1];
    if (!file) {
      console.error("Uso: --sum <fichero.sql>");
      process.exit(2);
    }
    const c = checksum(readFileSync(join(MIG_DIR, file), "utf8"));
    console.log(c);
    console.log(
      `\nPega al final de la migracion:\n${MARK}\ninsert into public.schema_migrations (name, checksum) values ('${file}', '${c}') on conflict (name) do nothing;`,
    );
    return;
  }

  const repo = repoMigrations();
  const applied = await appliedMap();
  const pending = [];
  const changed = [];
  let ok = 0;
  for (const m of repo) {
    if (!applied.has(m.name)) pending.push(m.name);
    else if (applied.get(m.name) !== m.checksum) changed.push(m.name);
    else ok += 1;
  }
  const orphan = [...applied.keys()].filter((n) => !repo.some((m) => m.name === n));

  console.log(`Migraciones: ${repo.length} en repo, ${applied.size} registradas en produccion.`);
  console.log(`  OK (aplicadas, checksum coincide): ${ok}`);
  if (pending.length) console.log(`  PENDIENTES (en repo, sin aplicar):\n    ${pending.join("\n    ")}`);
  if (changed.length) console.log(`  CAMBIADAS (aplicadas, pero el fichero cambio despues):\n    ${changed.join("\n    ")}`);
  if (orphan.length) console.log(`  HUERFANAS (registradas, sin fichero en el repo):\n    ${orphan.join("\n    ")}`);
  if (!pending.length && !changed.length && !orphan.length) console.log("  -> todo al dia.");

  // exitCode (no process.exit): deja que fetch/undici cierre sus sockets sin la asercion de
  // libuv en Windows. Sale con 1 si hay pendientes o cambiadas (util para CI / pre-apply).
  process.exitCode = pending.length || changed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exitCode = 2;
});
