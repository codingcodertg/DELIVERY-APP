#!/usr/bin/env node
// Tanda de mutantes: rompe el codigo a proposito, una vez por mutante, y apunta QUE PRUEBA CAE.
// Node a secas, sin dependencias, como la herramienta de revision visual de al lado.
//
// Se lanza DESDE la raiz del arbol que se va a medir:   node <esta_ruta> tanda.json
// Solo escribe los ficheros que la tanda nombra, y los deja como estaban al terminar.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, relative, sep } from "node:path";

const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

// ---------------------------------------------------------------- la tanda

const ruta = process.argv[2];
if (!ruta) {
  console.error("uso: node mutantes.mjs tanda.json   (desde la raiz del arbol que se mide)");
  process.exit(2);
}
const tanda = JSON.parse(readFileSync(ruta, "utf8"));
const MUTANTES = tanda.mutantes ?? tanda;
if (!Array.isArray(MUTANTES) || MUTANTES.length === 0) {
  console.error("la tanda no trae ningun mutante");
  process.exit(2);
}

// Nada fuera del arbol donde se lanza: un fichero de la tanda que apunte afuera aborta todo.
const RAIZ = process.cwd();
for (const m of MUTANTES) {
  const abs = resolve(RAIZ, m.fichero);
  const rel = relative(RAIZ, abs);
  if (rel.startsWith("..") || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel)) {
    console.error("ABORTA: " + m.fichero + " cae fuera del arbol donde se lanza (" + RAIZ + ")");
    process.exit(2);
  }
}

// ---------------------------------------------------------------- correr vitest

function corre(ficheros) {
  const r = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vitest", "run", "--reporter=json", ...ficheros],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" },
  );
  const salida = r.stdout ?? "";
  const i = salida.indexOf("{");
  const j = salida.lastIndexOf("}");
  if (i < 0 || j < i) {
    // Sin JSON no hay medida. No se adivina del codigo de salida: eso es justo lo que miente.
    return { ok: false, motivo: "vitest no devolvio JSON", caen: [], total: 0 };
  }
  let j0;
  try {
    j0 = JSON.parse(salida.slice(i, j + 1));
  } catch (e) {
    return { ok: false, motivo: "el JSON de vitest no se pudo leer: " + e.message, caen: [], total: 0 };
  }
  const caen = [];
  let total = 0;
  for (const f of j0.testResults ?? []) {
    for (const t of f.assertionResults ?? []) {
      total++;
      if (t.status === "failed") caen.push(t.fullName ?? t.title);
    }
  }
  // Un fichero que ni carga sale como suite fallida sin pruebas: eso NO es un mutante que cae.
  const suitesRotas = (j0.testResults ?? []).filter((f) => f.status === "failed" && (f.assertionResults ?? []).length === 0);
  return { ok: true, caen, total, suitesRotas: suitesRotas.map((f) => f.name) };
}

// ---------------------------------------------------------------- restaurar pase lo que pase

const abiertos = new Map(); // fichero -> contenido original
function restauraTodo() {
  for (const [f, original] of abiertos) writeFileSync(f, original);
  abiertos.clear();
}
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { restauraTodo(); process.exit(130); });
process.on("uncaughtException", (e) => { restauraTodo(); console.error(e); process.exit(2); });

// ---------------------------------------------------------------- el control

const TODOS = [...new Set(MUTANTES.flatMap((m) => m.pruebas))];
process.stdout.write("control (sin mutar): " + TODOS.length + " fichero(s) de prueba... ");
const control = corre(TODOS);
if (!control.ok) {
  console.log("NO SE PUDO LEER -- " + control.motivo);
  process.exit(2);
}
if (control.caen.length > 0) {
  console.log("EN ROJO");
  console.log("  Una tanda sobre una suite ya rota no mide nada: toda prueba «cae» con todos los mutantes.");
  for (const c of control.caen) console.log("  ya falla: " + c);
  process.exit(2);
}
console.log("en verde, " + control.total + " pruebas");
console.log("");

// ---------------------------------------------------------------- la tanda

let malos = 0;
for (const m of MUTANTES) {
  const original = readFileSync(m.fichero, "utf8");

  if (m.viejo === m.nuevo) {
    console.log("ABORTA  " + m.nombre + "\n        el mutante no cambia nada: `viejo` y `nuevo` son iguales");
    malos++;
    continue;
  }

  // El ancla, con los finales de linea del fichero. TIENE que aparecer exactamente una vez:
  // un ancla que casa en dos sitios muta el que no es y la suite sale verde por el motivo falso.
  let viejo = m.viejo;
  let nuevo = m.nuevo;
  const cuenta = (s, aguja) => (aguja === "" ? 0 : s.split(aguja).length - 1);
  let n = cuenta(original, viejo);
  if (n !== 1) {
    const vCRLF = m.viejo.split(LF).join(CRLF);
    const nCRLF = cuenta(original, vCRLF);
    if (nCRLF === 1) {
      viejo = vCRLF;
      nuevo = m.nuevo.split(LF).join(CRLF);
      n = 1;
    } else {
      n = Math.max(n, nCRLF);
    }
  }
  if (n !== 1) {
    console.log("ABORTA  " + m.nombre + "\n        el ancla aparece " + n + " veces en " + m.fichero + " (tiene que ser 1)");
    malos++;
    continue;
  }

  let res;
  abiertos.set(m.fichero, original);
  try {
    const mutado = original.split(viejo).join(nuevo);
    if (mutado === original) {
      console.log("ABORTA  " + m.nombre + "\n        aplicado, el fichero no cambio");
      malos++;
      continue;
    }
    writeFileSync(m.fichero, mutado);
    res = corre(m.pruebas);
  } finally {
    writeFileSync(m.fichero, original);
    abiertos.delete(m.fichero);
  }

  if (!res.ok) {
    console.log("ABORTA  " + m.nombre + "\n        " + res.motivo);
    malos++;
  } else if (res.suitesRotas?.length) {
    // Un mutante que deja el fichero sin compilar no mide ninguna prueba, aunque «falle».
    console.log("ABORTA  " + m.nombre + "\n        el mutante rompe el fichero y no corre nada: " + res.suitesRotas.join(", "));
    malos++;
  } else if (res.caen.length === 0) {
    console.log("SOBREVIVE  " + m.nombre);
    console.log("        corrieron " + res.total + " pruebas y no cayo ninguna.");
    console.log("        Mirar primero el mutante: >hace de verdad lo que dice su nombre?");
    malos++;
  } else {
    console.log("CAE  " + m.nombre);
    for (const c of res.caen) console.log("        " + c);
  }
}

console.log("");
console.log(MUTANTES.length - malos + " de " + MUTANTES.length + " mutantes caen con una prueba con nombre.");
if (malos > 0) console.log("Los otros " + malos + " sobreviven o no se pudieron aplicar: ninguno de los dos es un resultado.");
process.exit(malos > 0 ? 1 : 0);
