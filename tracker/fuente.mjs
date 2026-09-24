// De dónde salen las tareas: de la base si está configurada, y si no, de la copia congelada.
//
// **La base manda.** Desde la 144, `public.tracker_tareas` es la única fuente de verdad: el dueño
// pulsa «Completado» en la página y ese hecho vive ahí. `tracker/tareas/*.json` se queda en git como
// **foto del 2026-09-24** y ya no se escribe nunca — ver `tracker/tareas/LEEME.md`.
//
// Por qué no se borró la copia: son **las palabras del dueño**, y en git se revisan en un diff y
// sobreviven a que alguien borre una fila por error. Lo que evita las dos fuentes no es borrarla,
// es que **nadie pueda escribirla**: aquí no hay ninguna función que lo haga.
//
// Leer sin base **funciona y avisa**; escribir sin base **falla diciéndolo**. Un worktree no tiene
// las variables a propósito (CLAUDE.md), así que esto no es un fallo raro: es el caso normal de la
// mitad de las sesiones.

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = dirname(fileURLToPath(import.meta.url));
export const DIR_CONGELADO = join(RAIZ, "tareas");
export const TABLA = "tracker_tareas";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const llave = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "";

/**
 * Una base **de mentira**, solo para las pruebas: `TRACKER_BASE_FALSA=<ruta de un .json>`.
 *
 * No es una segunda fuente de verdad. Vive donde diga esa variable —una carpeta temporal, nunca el
 * repo— y no existe fuera de una corrida de `vitest`. Hace falta porque desde la 144 el CLI escribe
 * en la base, y sin esto las pruebas del CLI tendrían que hablar con producción, que es justo lo que
 * no se hace.
 *
 * **Es un fichero y no memoria** porque el CLI corre un proceso por orden: una memoria de proceso se
 * vacía entre el `add` y el `update` que lo comprueba, y la prueba no mediría nada.
 *
 * Lo que esta base falsa **no** imita es el trigger: «Completado» lo vigila Postgres. Eso se mide
 * leyendo la migración (`nube.test.mjs`) y ensayándola con ROLLBACK contra la base de verdad.
 */
const FALSA = process.env.TRACKER_BASE_FALSA ?? "";

const leeFalsa = () => {
  try { return new Map(Object.entries(JSON.parse(readFileSync(FALSA, "utf8")))); }
  catch { return new Map(); }
};
const guardaFalsa = (m) => writeFileSync(FALSA, JSON.stringify(Object.fromEntries(m), null, 1));

/** ¿Hay con qué hablar con la base? */
export const hayBase = () => Boolean(FALSA) || Boolean(url() && llave());

let cliente = null;
async function db() {
  if (cliente) return cliente;
  const { createClient } = await import("@supabase/supabase-js");
  cliente = createClient(url(), llave(), { auth: { persistSession: false } });
  return cliente;
}

/** El motivo exacto por el que no hay base, para poder decirlo en vez de «algo falló». */
export function porQueNoHayBase() {
  const falta = [];
  if (!url()) falta.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!llave()) falta.push("SUPABASE_SERVICE_ROLE_KEY");
  return "faltan " + falta.join(" y ")
    + ".\n  El tracker vive en la base desde la 144. Un worktree no lleva `.env.local` a propósito,"
    + "\n  así que esto se hace desde el checkout principal.";
}

// ---------------------------------------------------------------- leer

function deLaCopia() {
  if (!existsSync(DIR_CONGELADO)) return [];
  return readdirSync(DIR_CONGELADO)
    .filter((f) => /^T-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(DIR_CONGELADO, f), "utf8")));
}

/**
 * Todas las tareas, ordenadas por fecha y luego por id.
 *
 * Devuelve también DE DÓNDE salieron, porque quien las pinta tiene que poder decirlo: una lista de
 * la copia congelada puede tener días de retraso, y enseñarla como si fuera la de hoy es la clase de
 * cosa que hace que alguien discuta con un número que ya no existe.
 */
export async function leeTodas() {
  if (FALSA) return { tareas: ordena([...leeFalsa().values()]), origen: "la base", aviso: "" };
  if (!hayBase()) {
    return { tareas: ordena(deLaCopia()), origen: "copia congelada", aviso: porQueNoHayBase() };
  }
  const { data, error } = await (await db()).from(TABLA).select("*");
  if (error) throw new Error("no se pudo leer la base: " + error.message);
  return { tareas: ordena(data ?? []), origen: "la base", aviso: "" };
}

const ordena = (l) => [...l].sort((a, b) => (a.fecha === b.fecha ? a.id.localeCompare(b.id) : a.fecha.localeCompare(b.fecha)));

export async function lee(id) {
  if (FALSA) return leeFalsa().get(id) ?? null;
  if (!hayBase()) return deLaCopia().find((t) => t.id === id) ?? null;
  const { data, error } = await (await db()).from(TABLA).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("no se pudo leer " + id + ": " + error.message);
  return data ?? null;
}

// ---------------------------------------------------------------- escribir

/** Escribir SIEMPRE necesita base. Sin ella se para y dice por qué. */
export function exigeBase() {
  if (!hayBase()) {
    throw new Error("para escribir hace falta la base: " + porQueNoHayBase());
  }
}

export async function guarda(t) {
  exigeBase();
  if (FALSA) {
    // La base de verdad pone `modificado` con su trigger; aqui se imita lo justo para que el
    // CLI no tenga que saber en cual esta.
    const copia = { ...t, modificado: new Date().toISOString() };
    const m = leeFalsa();
    m.set(t.id, copia);
    guardaFalsa(m);
    return copia;
  }
  // `completado_por`, `completado_en` y `modificado` los pone la base (trigger de la 144). Mandarlos
  // desde aquí sería darle al cliente la firma de la auditoría.
  const { completado_por, completado_en, modificado, ...resto } = t;
  void completado_por; void completado_en; void modificado;
  const { data, error } = await (await db()).from(TABLA).upsert(resto, { onConflict: "id" }).select().single();
  if (error) throw new Error("no se pudo guardar " + t.id + ": " + error.message);
  return data;
}

/** El siguiente id libre, preguntándoselo a la base y no a la copia. */
export async function siguienteId() {
  exigeBase();
  if (FALSA) {
    const ids = [...leeFalsa().keys()].map((i) => Number(i.slice(2)));
    return "T-" + String((ids.length ? Math.max(...ids) : 0) + 1).padStart(4, "0");
  }
  const { data, error } = await (await db()).from(TABLA).select("id").order("id", { ascending: false }).limit(1);
  if (error) throw new Error("no se pudo mirar el último id: " + error.message);
  const ultimo = data?.[0]?.id ?? "T-0000";
  return "T-" + String(Number(ultimo.slice(2)) + 1).padStart(4, "0");
}
