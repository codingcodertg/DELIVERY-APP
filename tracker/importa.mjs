#!/usr/bin/env node
// Lleva las tareas de `tracker/tareas/*.json` a `public.tracker_tareas`.
//
//   node tracker/importa.mjs                 # ENSAYO: no escribe nada, dice qué haría
//   node tracker/importa.mjs --escribir      # de verdad
//
// **Nace en ensayo a propósito.** Un script de carga que escribe por defecto es un script que
// alguien corre «para ver qué hace» y descubre después qué hizo.
//
// **Idempotente**: cada fila va por `upsert` sobre la clave primaria, así que correrlo dos veces
// deja lo mismo. Al final vuelve a contar contra la base y compara con lo que había que subir; si no
// cuadra, sale con código 1 y lo dice.
//
// Lo que NO hace, y es la regla que sostiene el resto: **no sube «Completado»**. De las 371 tareas
// hay 0 en ese estado (medido), y si algún día hubiera una, este script la dejaría fuera y lo diría
// en vez de intentarlo — el trigger de la 144 lo rechazaría igualmente, porque un script no cierra
// una tarea del dueño.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DIR = join(RAIZ, "tareas");
const ESCRIBIR = process.argv.includes("--escribir");
const TABLA = "tracker_tareas";
const LOTE = 100;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const llave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

function muere(msg) {
  console.error(msg);
  process.exit(1);
}

if (!existsSync(DIR)) muere("no existe " + DIR);

// ---------------------------------------------------------------- leer
const tareas = [];
for (const f of readdirSync(DIR).filter((x) => /^T-\d+\.json$/.test(x))) {
  tareas.push(JSON.parse(readFileSync(join(DIR, f), "utf8")));
}
tareas.sort((a, b) => a.id.localeCompare(b.id));

const cerradas = tareas.filter((t) => t.estado === "Completado");
const aSubir = tareas.filter((t) => t.estado !== "Completado");

console.log((ESCRIBIR ? "ESCRIBIENDO" : "ENSAYO (no escribe nada)") + "  ·  " + tareas.length + " tareas en disco");
if (cerradas.length) {
  console.log("  " + cerradas.length + " en «Completado» que NO se suben: " + cerradas.map((t) => t.id).join(", "));
  console.log("  Un script no cierra una tarea del dueño; el trigger de la 144 las rechazaría igual.");
}

// Los padres primero: `padre` es una clave foránea a la propia tabla.
const conPadre = aSubir.filter((t) => t.padre);
const orden = [...aSubir.filter((t) => !t.padre), ...conPadre];

const fila = (t) => ({
  id: t.id,
  fecha: t.fecha,
  resumen: t.resumen,
  texto_original: t.texto_original ?? "",
  lo_hizo_claude: t.lo_hizo_claude ?? "No",
  estado: t.estado,
  padre: t.padre ?? null,
  evidencia: t.evidencia ?? {},
  verificacion: t.verificacion ?? { estado: "sin verificar", prueba: "", fecha: null },
  notas: t.notas ?? [],
  fuentes: t.fuentes ?? [],
  // `completado_por`, `completado_en` y `modificado` NO se mandan: los pone la base.
  creado: t.creado ?? null,
});

if (!ESCRIBIR) {
  const porEstado = {};
  for (const t of orden) porEstado[t.estado] = (porEstado[t.estado] ?? 0) + 1;
  console.log("");
  console.log("subiría " + orden.length + " filas, en lotes de " + LOTE + ":");
  for (const [k, v] of Object.entries(porEstado)) console.log("  " + String(v).padStart(4) + "  " + k);
  console.log("");
  console.log("la primera, tal como iría:");
  console.log(JSON.stringify(fila(orden[0]), null, 2).split("\n").slice(0, 14).join("\n") + "\n  …");
  console.log("");
  console.log("Repite con --escribir cuando quieras hacerlo de verdad.");
  process.exit(0);
}

// ---------------------------------------------------------------- escribir
if (!url || !llave) {
  muere("faltan las variables: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.\n"
    + "En un worktree no están a propósito — esto se corre desde el checkout principal.");
}

const { createClient } = await import("@supabase/supabase-js");
const db = createClient(url, llave, { auth: { persistSession: false } });

let subidas = 0;
for (let i = 0; i < orden.length; i += LOTE) {
  const lote = orden.slice(i, i + LOTE).map(fila);
  const { error } = await db.from(TABLA).upsert(lote, { onConflict: "id" });
  if (error) muere("falló el lote que empieza en " + lote[0].id + ": " + error.message);
  subidas += lote.length;
  process.stdout.write("\r  " + subidas + " / " + orden.length);
}
console.log("");

// ---------------------------------------------------------------- recontar
//
// Se cuenta CONTRA LA BASE, no sumando lo que creo haber mandado: un upsert que no escribe nada
// vuelve sin error, y contar mis propias intenciones diría que todo fue bien.
const { count, error } = await db.from(TABLA).select("id", { count: "exact", head: true });
if (error) muere("no se pudo recontar: " + error.message);
console.log("");
console.log("en disco (sin las cerradas): " + orden.length);
console.log("en la base:                  " + count);
if (count !== orden.length) {
  muere("NO CUADRA. Hay " + Math.abs(count - orden.length) + " de diferencia; mira antes de volver a correrlo.");
}
console.log("cuadra.");
