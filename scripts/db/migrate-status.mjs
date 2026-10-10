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

// El checksum, el entorno y la lectura del registro viven en ./ledger.mjs desde D-512: los
// comparte con `aplica-migracion.mjs`, y una regla que decide lo que se ESCRIBE en
// public.schema_migrations no puede estar copiada en dos ficheros.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MARK, MIG_DIR, cargaEntorno as loadEnv, checksum, lineaDeRegistro,
  migracionesDelRepo as repoMigrations, registradas as appliedMap,
} from "./ledger.mjs";

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
    console.log(`\nPega al final de la migracion:\n${MARK}\n${lineaDeRegistro(file, c)}`);
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
