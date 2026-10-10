#!/usr/bin/env node
// Aplicar UNA migracion a produccion, con todo lo que CLAUDE.md pide alrededor (D-512).
//
// Uso:
//   node scripts/db/aplica-migracion.mjs 164_tipo_proveedor.sql             → ENSAYO (ROLLBACK)
//   node scripts/db/aplica-migracion.mjs 164_tipo_proveedor.sql --escribe   → aplica de verdad
//   node scripts/db/aplica-migracion.mjs 164_... --escribe --otra-vez       → aunque ya este registrada
//
// Por que existe: hasta ahora "aplicar" era pegar el .sql a mano en el editor de Supabase y
// acordarse de correr el estado antes y despues. Acordarse no es un mecanismo. Aqui el orden va
// escrito, y los dos errores que de verdad pasaron en este repo los PARA el programa:
//
//   1. Numerar un D-NEXT dentro del .sql cambia su cuerpo, y con el su checksum, dejando la linea
//      de registro declarando el viejo. Paso dos veces el 2026-10-10. El guarda lo compara.
//   2. Una migracion con su propio `commit` cierra la transaccion de fuera, asi que un ensayo con
//      ROLLBACK se aplica de verdad. Paso con la 124. El guarda lo detecta antes de abrir nada,
//      y sabe distinguirlo del `begin` que vive dentro de un `do $$ ... $$`.
//
// El ENSAYO es lo que corre por defecto, a proposito: escribir en produccion se pide, no se cae
// por descuido de teclear un argumento de menos.
//
// Lee SUPABASE_DB_URL (Postgres directo) de .env.local, y NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY para leer el registro. Un worktree no lleva .env.local a proposito:
// esto se corre desde el checkout principal.
//
// Sin acentos, como el resto de scripts/db.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIG_DIR, cargaEntorno, checksum, lineaDeRegistro,
  migracionesDelRepo, problemasParaAplicar, registradas,
} from "./ledger.mjs";

function estado(repo, aplicadas) {
  const pendientes = [];
  const cambiadas = [];
  let ok = 0;
  for (const m of repo) {
    if (!aplicadas.has(m.name)) pendientes.push(m.name);
    else if (aplicadas.get(m.name) !== m.checksum) cambiadas.push(m.name);
    else ok += 1;
  }
  return { pendientes, cambiadas, ok, total: repo.length, registradas: aplicadas.size };
}

function pintaEstado(titulo, e) {
  console.log(`\n${titulo}: ${e.total} en repo, ${e.registradas} registradas. OK: ${e.ok}.`);
  if (e.pendientes.length) console.log(`  PENDIENTES: ${e.pendientes.join(", ")}`);
  if (e.cambiadas.length) console.log(`  CAMBIADAS: ${e.cambiadas.join(", ")}`);
  if (!e.pendientes.length && !e.cambiadas.length) console.log("  -> todo al dia.");
}

async function main() {
  cargaEntorno();
  const args = process.argv.slice(2);
  const nombre = args.find((a) => !a.startsWith("--"));
  const escribe = args.includes("--escribe");
  const otraVez = args.includes("--otra-vez");

  if (!nombre) {
    console.error("Uso: node scripts/db/aplica-migracion.mjs <NNN_x.sql> [--escribe] [--otra-vez]");
    process.exitCode = 2;
    return;
  }

  const texto = readFileSync(join(MIG_DIR, nombre), "utf8");
  const sum = checksum(texto);
  const aplicadas = await registradas();

  console.log(`${nombre}`);
  console.log(`  checksum del cuerpo: ${sum}`);

  const malos = problemasParaAplicar({ nombre, texto, registradas: aplicadas, otraVez });
  if (malos.length) {
    console.error(`\nNO se aplica. ${malos.length} problema(s):`);
    for (const m of malos) console.error(`  - ${m}`);
    process.exitCode = 2;
    return;
  }

  const repo = migracionesDelRepo();
  pintaEstado("ANTES", estado(repo, aplicadas));

  // `pg` es devDependency: esto es una herramienta de operacion, no entra en el bundle del cliente.
  const { default: pg } = await import("pg");
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("Falta SUPABASE_DB_URL (Postgres directo) en .env.local o el entorno.");
  const cliente = new pg.Client({
    connectionString: url,
    // Supabase exige TLS. Si la cadena no trae sslmode, se pide aqui.
    ssl: /sslmode=/i.test(url) ? undefined : { rejectUnauthorized: false },
  });

  await cliente.connect();
  let aplicada = false;
  try {
    await cliente.query("begin");
    // El fichero ENTERO, con su linea de registro incluida: la migracion se inscribe a si misma.
    await cliente.query(texto);
    if (escribe) {
      await cliente.query("commit");
      aplicada = true;
      console.log("\nCOMMIT: aplicada.");
    } else {
      await cliente.query("rollback");
      console.log("\nROLLBACK: el ensayo corrio entero y se deshizo. Nada cambio en produccion.");
      console.log("Para aplicarla de verdad, el mismo comando con --escribe.");
    }
  } catch (e) {
    try { await cliente.query("rollback"); } catch { /* la transaccion ya puede estar muerta */ }
    console.error(`\nFALLO al ejecutar, y se deshizo: ${e.message || e}`);
    if (e.position) console.error(`  posicion en el SQL: ${e.position}`);
    process.exitCode = 1;
    return;
  } finally {
    await cliente.end();
  }

  if (!aplicada) return;

  // Despues de aplicar se vuelve a LEER el registro, no se supone. Un `on conflict do nothing` que
  // no inserto nada no es un error, y sin esta lectura se contaria como registrada igual.
  const despues = await registradas();
  pintaEstado("DESPUES", estado(repo, despues));
  if (despues.get(nombre) !== sum) {
    console.error(`\nAVISO: la fila de ${nombre} no quedo con el checksum esperado.`);
    console.error(`  en la tabla: ${despues.get(nombre) ?? "(ausente)"}`);
    console.error(`  esperado:    ${sum}`);
    console.error(`  la linea que deberia llevar la migracion:\n    ${lineaDeRegistro(nombre, sum)}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exitCode = 2;
});
