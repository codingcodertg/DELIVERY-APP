#!/usr/bin/env node
// Hook de `Stop`: recuerda actualizar el tracker, y apunta los commits y PR nuevos desde la última
// vez que se miró.
//
// **Lo que este hook NO puede hacer, y por qué importa:** `Stop` se dispara CADA VEZ que Claude
// termina de responder, no al acabar una tarea. Así que no sabe si se cerró algo, y **no registra
// nada por su cuenta**: si inventara estados, el tracker pasaría a estar lleno de filas que nadie
// escribió, y dejaría de servir como control. Solo recuerda y enumera hechos.
//
// Las tres reglas del otro hook valen igual: no falla en voz alta, no bloquea, y es rápido.
//
// El «desde la última vez» se guarda FUERA del repo, en la carpeta temporal del sistema: un fichero
// de estado dentro de `tracker/` aparecería en cada `git status` y acabaría commiteado por error.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(RAIZ);

const salSinDecirNada = () => process.exit(0);

try {
  if (!existsSync(join(RAIZ, "tareas"))) salSinDecirNada();

  const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", timeout: 4000 }).trim();

  // Un fichero por repositorio, con el nombre derivado de su ruta: dos copias del repo no se pisan.
  const carpeta = join(tmpdir(), "tracker-recordatorio");
  mkdirSync(carpeta, { recursive: true });
  const marca = join(carpeta, createHash("sha256").update(REPO).digest("hex").slice(0, 16) + ".txt");

  const actual = git(["rev-parse", "HEAD"]);
  const anterior = existsSync(marca) ? readFileSync(marca, "utf8").trim() : "";
  writeFileSync(marca, actual);

  if (!anterior || anterior === actual) salSinDecirNada();

  let nuevos = [];
  try {
    nuevos = git(["log", "--format=%h %s", anterior + ".." + actual]).split("\n").filter(Boolean);
  } catch {
    salSinDecirNada();                       // el commit de antes ya no existe (rebase): se calla
  }
  if (!nuevos.length) salSinDecirNada();

  const l = ["Recordatorio del tracker: han entrado " + nuevos.length + " commit(s) desde la última vez."];
  for (const c of nuevos.slice(0, 8)) l.push("- " + c);
  if (nuevos.length > 8) l.push("- … y " + (nuevos.length - 8) + " más");
  l.push("");
  l.push("Si alguno corresponde a algo que pidió el dueño, actualiza su tarea con"
    + " `node tracker/cli.mjs update T-XXXX --commit <sha> --pr <n>`."
    + " **No pongas «Completado» ni «verificado» por tu cuenta**: el primero lo confirma él, y el"
    + " segundo necesita decir quién lo midió, cuándo y cómo.");
  process.stdout.write(l.join("\n") + "\n");
} catch {
  // A propósito.
}
process.exit(0);
