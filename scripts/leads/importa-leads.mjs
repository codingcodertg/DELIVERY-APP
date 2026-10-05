#!/usr/bin/env node
// ============================================================================
// Carga el Excel de leads de permisos (TDLR) en public.leads (migracion 162).
//
//   node scripts/leads/importa-leads.mjs <fichero.xlsx>             -> solo LEE el Excel y cuenta. No toca la base.
//   node scripts/leads/importa-leads.mjs <fichero.xlsx> --ensayo    -> carga dentro de una transaccion y hace ROLLBACK
//   node scripts/leads/importa-leads.mjs <fichero.xlsx> --aplicar   -> carga de verdad (COMMIT)
//
// --ensayo y --aplicar necesitan SUPABASE_DB_URL (en el entorno o en .env.local del directorio actual) y
// la 162 aplicada. Aplicar es del orquestador, despues de aplicar la 162: una rama no lo corre.
//
// El guion NO traduce columnas: manda cada fila con las cabeceras del Excel como claves, y el mapa de
// columnas, la limpieza de numeros y fechas y el dedupe por «TABS Project #» viven en la funcion
// public.leads_import_rows de la 162. Volver a correrlo con un Excel mas nuevo ACTUALIZA los datos de
// los leads que ya estaban y anade los nuevos; no toca quien tiene cada lead, su etiqueta ni su historial.
//
// Se lee con el lector por flujo de exceljs: el lector normal (workbook.xlsx.readFile) revienta con
// este fichero («Cannot read properties of undefined (reading 'comments')», medido el 2026-10-04).
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** La cabecera que identifica la hoja de leads y la fila de cabeceras. */
export const CABECERA_CLAVE = "TABS Project #";

/** El valor de una celda de exceljs, como texto, numero o null. Una fecha, como AAAA-MM-DD. */
export function valorDeCelda(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text ?? "").join("");
    if ("result" in v) return valorDeCelda(v.result);
    if ("text" in v) return valorDeCelda(v.text);
    if ("hyperlink" in v) return String(v.hyperlink);
  }
  return null;
}

/** Las filas de una hoja (cada una, el array de valores de exceljs, con el indice 0 vacio) como objetos por cabecera. */
export function filasComoObjetos(filasCrudas) {
  const iCab = filasCrudas.findIndex((f) => Array.isArray(f) && f.some((c) => valorDeCelda(c) === CABECERA_CLAVE));
  if (iCab < 0) return null;
  const cabeceras = filasCrudas[iCab].map((c) => { const t = valorDeCelda(c); return typeof t === "string" ? t.trim() : null; });
  const filas = [];
  for (const cruda of filasCrudas.slice(iCab + 1)) {
    if (!Array.isArray(cruda)) continue;
    const o = {};
    let algo = false;
    cabeceras.forEach((cab, i) => {
      if (!cab) return;
      const v = valorDeCelda(cruda[i]);
      if (v !== null && v !== "") { o[cab] = v; algo = true; }
    });
    if (algo) filas.push(o);
  }
  return filas;
}

/** Lee el Excel y devuelve las filas de la PRIMERA hoja que tenga la cabecera «TABS Project #». */
export async function leeFilas(fichero) {
  const { default: ExcelJS } = await import("exceljs");
  const lector = new ExcelJS.stream.xlsx.WorkbookReader(fichero, { sharedStrings: "cache", worksheets: "emit", hyperlinks: "ignore", styles: "ignore" });
  for await (const hoja of lector) {
    const crudas = [];
    for await (const fila of hoja) crudas.push(fila.values);
    const filas = filasComoObjetos(crudas);
    if (filas) return filas;
  }
  throw new Error(`Ninguna hoja de ${fichero} tiene la cabecera «${CABECERA_CLAVE}».`);
}

/** Cuenta por una columna, para el resumen que se imprime. */
export function cuentaPor(filas, columna) {
  const m = {};
  for (const f of filas) { const k = f[columna] ?? "(vacío)"; m[k] = (m[k] ?? 0) + 1; }
  return m;
}

async function main() {
  const args = process.argv.slice(2);
  const fichero = args.find((a) => !a.startsWith("--"));
  const aplicar = args.includes("--aplicar");
  const ensayo = args.includes("--ensayo");
  if (!fichero || (aplicar && ensayo)) {
    console.error("Uso: node scripts/leads/importa-leads.mjs <fichero.xlsx> [--ensayo | --aplicar]");
    process.exit(2);
  }
  const filas = await leeFilas(fichero);
  const sinTabs = filas.filter((f) => !String(f[CABECERA_CLAVE] ?? "").trim()).length;
  const distintos = new Set(filas.map((f) => String(f[CABECERA_CLAVE] ?? "").trim().toUpperCase()).filter(Boolean)).size;
  console.log(`Filas leídas: ${filas.length} · con TABS distinto: ${distintos} · sin TABS (se saltan): ${sinTabs}`);
  console.log("Por tienda más cercana:", cuentaPor(filas, "Tienda RTG más cercana"));
  console.log("Por categoría:", cuentaPor(filas, "Categoría"));
  if (!aplicar && !ensayo) {
    console.log("\nSolo lectura: no se tocó la base. Con --ensayo carga y hace ROLLBACK; con --aplicar, carga de verdad.");
    return;
  }

  let url = process.env.SUPABASE_DB_URL;
  if (!url && existsSync(".env.local")) {
    const m = /^SUPABASE_DB_URL=(.*)$/m.exec(readFileSync(".env.local", "utf8"));
    if (m) url = m[1].trim().replace(/^["']|["']$/g, "");
  }
  if (!url) { console.error("Falta SUPABASE_DB_URL (en el entorno o en .env.local)."); process.exit(1); }
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("set lock_timeout = '5s'; set statement_timeout = '120s'");
    await c.query("begin");
    const r = await c.query("select public.leads_import_rows($1::jsonb, null) as r", [JSON.stringify(filas)]);
    console.log("\nResultado de la base:", JSON.stringify(r.rows[0].r, null, 2));
    if (aplicar) { await c.query("commit"); console.log("COMMIT: cargado."); }
    else { await c.query("rollback"); console.log("ROLLBACK: no quedó nada (era un ensayo)."); }
  } catch (e) {
    try { await c.query("rollback"); } catch { /* ya estaba cerrada */ }
    console.error("ERROR (rollback hecho):", e.code ?? "", e.message);
    if (e.code === "42883" || e.code === "42P01") console.error("¿Está aplicada la migración 162?");
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
