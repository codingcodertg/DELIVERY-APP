#!/usr/bin/env node
// ============================================================================
// Carga el Excel maestro de clientes («REAL Master List Customers PRE DEC.xlsx», hoja ALL) en erp.customers
// (migracion 180).
//
//   node scripts/importa-clientes.mjs <fichero.xlsx>             -> solo LEE el Excel y cuenta. No toca la base.
//   node scripts/importa-clientes.mjs <fichero.xlsx> --ensayo    -> carga dentro de una transaccion y hace ROLLBACK
//   node scripts/importa-clientes.mjs <fichero.xlsx> --escribe   -> carga de verdad (COMMIT)
//
// --ensayo y --escribe necesitan SUPABASE_DB_URL (en el entorno o en .env.local del directorio actual) y la 180
// aplicada. Escribir es del orquestador, despues de aplicar la 180: una rama no lo corre (no tiene .env.local).
//
// IDEMPOTENTE. La clave natural es ACCOUNT + STORE (sin mayusculas ni espacios de mas: el indice unico
// customers_store_account_unico de la 180). Volver a correrlo con el mismo Excel no cambia nada; con un Excel mas
// nuevo ACTUALIZA las columnas del Excel de las cuentas que ya estaban y anade las nuevas. Lo que la app anade
// (notes, address, contacto si el Excel no lo trae) no se pisa: cada columna del Excel se escribe solo si trae
// valor (`coalesce(excluded.x, x)`). Nunca borra una fila.
//
// Dos filas del Excel con la misma clave (hay UNA: PASEO RESIDENCIAL / BRO, filas 947 y 948) se FUSIONAN antes de
// escribir: la primera manda y la segunda rellena lo que a la primera le falte. Se cuenta como «fusionadas».
//
// Sin acentos en los mensajes, como el resto de scripts/.
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { estandarizaCliente } from "../src/lib/customers/formato.ts";

/** Las cabeceras del Excel (normalizadas: mayusculas, sin puntos, un solo espacio) -> columna de erp.customers. */
export const MAPA = {
  "HOUSE": "house_no",
  "DATE ADDED": "added_batch",
  "STORE": "store",
  "QB INACTIVE": "qb_status",
  "ACTIVITY STATUS": "activity_status",
  "ACCOUNT": "account",
  "UNIFIED ACCOUNT": "unified_account",
  "MAX GROUP REP HISTORY": "rep_history",
  "MAX GROUP REP QB": "rep_qb",
  "ASSIGNED STORE REP QB": "rep_store",
  "STATUS TYPE: STORE": "status_store",
  "STATUS TYPE: GROUP": "status_group",
  "HISTORY TYPE: STORE": "history_store",
  "HISTORY TYPE: GROUP": "history_group",
  // Migracion 182 (2026-10-18): las tres del CRM que la 180 dejo fuera. El dueno: «the crm stuff in the customer is missing».
  "CRM TYPE: STORE": "crm_type_store",
  "CRM TYPE: GROUP": "crm_type_group",
  "ASSOCIATED WITH": "associated_with",
  "CONTACT": "contact_name",
  "TITLE": "contact_title",
  "ADRESS": "address",
  "MAIN PHONE": "phone",
  "MAIN EMAIL": "email",
  "QB CREDIT LIMIT": "credit_limit",
  "TERMS": "terms",
  "EULER": "euler_limit",
  "ACCOUNT NO": "account_no",
};
// Fuera a proposito: CONCATENATE (medido 2026-10-18: las 1.349 son EXACTAMENTE STORE+ACCOUNT; la pantalla la
// recompone) y la columna 28 sin cabecera (vacia). Las tres de CRM entraron con la 182.

export const COLUMNAS = [...new Set(Object.values(MAPA))];
const NUMERICAS = new Set(["house_no", "credit_limit", "euler_limit"]);

/** Una cabecera del Excel como clave del MAPA: mayusculas, sin puntos, saltos y espacios dobles a uno. */
export function cabeceraNormal(s) {
  return String(s ?? "").toUpperCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

/** El valor de una celda de exceljs: texto recortado, numero, fecha como AAAA-MM-DD, o null (tambien para #N/A). */
export function valorDeCelda(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const s = v.trim(); return s === "" ? null : s; }
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return valorDeCelda(v.richText.map((p) => p.text ?? "").join(""));
    if ("error" in v) return null;
    if ("result" in v) return valorDeCelda(v.result);
    if ("text" in v) return valorDeCelda(v.text);
    if ("hyperlink" in v) return valorDeCelda(v.text ?? v.hyperlink);
  }
  return null;
}

/**
 * Las filas de una hoja (cada una, el array de valores de exceljs, con el indice 0 vacio) como objetos por COLUMNA de
 * la base. La fila de cabeceras es la primera que tenga ACCOUNT y STORE. null si la hoja no es la de clientes.
 */
export function filasDeHoja(filasCrudas) {
  const iCab = filasCrudas.findIndex((f) => {
    if (!Array.isArray(f)) return false;
    const cabs = f.map((c) => cabeceraNormal(valorDeCelda(c)));
    return cabs.includes("ACCOUNT") && cabs.includes("STORE");
  });
  if (iCab < 0) return null;
  const columnas = filasCrudas[iCab].map((c) => MAPA[cabeceraNormal(valorDeCelda(c))] ?? null);
  const filas = [];
  for (const cruda of filasCrudas.slice(iCab + 1)) {
    if (!Array.isArray(cruda)) continue;
    const o = {};
    let algo = false;
    columnas.forEach((col, i) => {
      if (!col) return;
      const v = valorDeCelda(cruda[i]);
      if (v !== null) { o[col] = v; algo = true; }
    });
    if (algo) filas.push(o);
  }
  return filas;
}

/** Un «0» en una columna de texto del Excel es «sin dato» (CONTACT, telefono, correo, vendedores...). */
const esCero = (v) => v === 0 || v === "0";

/** Una fila del Excel (ya por columna) como la fila que se escribe: limpia, tipada, y null donde no hay dato. */
export function filaACliente(o) {
  const c = {};
  for (const col of COLUMNAS) {
    let v = o[col] ?? null;
    if (v !== null && esCero(v) && !NUMERICAS.has(col)) v = null;
    if (NUMERICAS.has(col)) {
      if (typeof v === "string") { const n = Number(v.replace(/[$,\s]/g, "")); v = Number.isFinite(n) ? n : null; }
      if (v !== null && v < 0) v = null;
      if (col === "house_no" && v !== null) v = Math.trunc(v);
    } else if (v !== null) {
      v = String(v).trim();
      // Comillas que envuelven la celda entera son del Excel, no del dato: medido 2026-10-18, en toda la hoja solo las
      // llevan 6 celdas, todas «"LOST"» en CRM TYPE: STORE. Un «"» suelto dentro del texto se queda.
      if (/^".*"$/.test(v)) v = v.slice(1, -1).trim();
      if (v === "") v = null;
    }
    c[col] = v;
  }
  if (c.store !== null) c.store = c.store.toUpperCase();
  // D-635: el mismo formato que la app al guardar (nombres en MAYUSCULAS con un solo espacio, telefono
  // «(956) 340-5910», correo en minusculas). Tambien hace que la clave natural de un Excel nuevo case con la fila ya
  // guardada en formato: «DURGA  PROPERTIES» y «DURGA PROPERTIES» son la misma.
  Object.assign(c, estandarizaCliente(c));
  return c;
}

/** La clave natural, como la ve el indice unico de la 180. null si falta cuenta o tienda (la fila se salta). */
export function claveDe(c) {
  const store = (c.store ?? "").trim().toUpperCase();
  const account = (c.account ?? "").trim().toLowerCase();
  return store && account ? `${store}|${account}` : null;
}

/** Dos filas con la misma clave: la primera manda, la segunda rellena lo que a la primera le falte. */
export function fusiona(a, b) {
  const out = { ...a };
  for (const col of COLUMNAS) if (out[col] === null || out[col] === undefined) out[col] = b[col] ?? null;
  return out;
}

/** Prepara las filas para escribir: limpia, salta las sin clave, fusiona duplicados, y cuenta. */
export function preparar(filas) {
  const porClave = new Map();
  let saltadas = 0, fusionadas = 0;
  for (const f of filas) {
    const c = filaACliente(f);
    const k = claveDe(c);
    if (!k) { saltadas++; continue; }
    if (porClave.has(k)) { porClave.set(k, fusiona(porClave.get(k), c)); fusionadas++; }
    else porClave.set(k, c);
  }
  const clientes = [...porClave.values()];
  return { clientes, leidas: filas.length, saltadas, fusionadas, porTienda: cuentaPor(clientes, "store"), porEstado: cuentaPor(clientes, "status_store"), porQb: cuentaPor(clientes, "qb_status") };
}

/** Cuenta por una columna, para el resumen que se imprime. */
export function cuentaPor(filas, columna) {
  const m = {};
  for (const f of filas) { const k = f[columna] ?? "(vacio)"; m[k] = (m[k] ?? 0) + 1; }
  return m;
}

/** Lee el Excel y devuelve las filas de la PRIMERA hoja que tenga ACCOUNT y STORE (en el maestro, «ALL»). */
export async function leeFilas(fichero) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fichero);
  for (const hoja of wb.worksheets) {
    const crudas = [];
    hoja.eachRow({ includeEmpty: false }, (row) => { crudas.push(row.values); });
    const filas = filasDeHoja(crudas);
    if (filas) return { hoja: hoja.name, filas };
  }
  throw new Error(`Ninguna hoja de ${fichero} tiene las cabeceras ACCOUNT y STORE.`);
}

/** El INSERT ... ON CONFLICT de una tanda. Las columnas del Excel se escriben si traen valor; lo de la app no se toca. */
export function sqlDeUpsert(n) {
  const cols = [...COLUMNAS, "source", "imported_at"];
  const filas = [];
  for (let i = 0; i < n; i++) {
    const marcas = COLUMNAS.map((_, j) => `$${i * COLUMNAS.length + j + 1}`);
    filas.push(`(${marcas.join(", ")}, $${n * COLUMNAS.length + 1}, now())`);
  }
  const set = COLUMNAS.filter((c) => c !== "store" && c !== "account").map((c) => `${c} = coalesce(excluded.${c}, erp.customers.${c})`);
  return `insert into erp.customers (${cols.join(", ")}) values ${filas.join(", ")}\n` +
    `on conflict (upper(btrim(store)), lower(btrim(account))) do update set ${set.join(", ")}, source = excluded.source, imported_at = now()\n` +
    `returning (xmax = 0) as nueva`;
}

export function parametrosDe(clientes, source) {
  const p = [];
  for (const c of clientes) for (const col of COLUMNAS) p.push(c[col] ?? null);
  p.push(source);
  return p;
}

async function main() {
  const args = process.argv.slice(2);
  const fichero = args.find((a) => !a.startsWith("--"));
  const escribe = args.includes("--escribe");
  const ensayo = args.includes("--ensayo");
  if (!fichero || (escribe && ensayo)) {
    console.error("Uso: node scripts/importa-clientes.mjs <fichero.xlsx> [--ensayo | --escribe]");
    process.exit(2);
  }
  const { hoja, filas } = await leeFilas(fichero);
  const prep = preparar(filas);
  console.log(`Hoja «${hoja}»: filas leidas ${prep.leidas} · clientes (clave tienda+cuenta) ${prep.clientes.length} · fusionadas ${prep.fusionadas} · saltadas sin cuenta o tienda ${prep.saltadas}`);
  console.log("Por tienda:", prep.porTienda);
  console.log("Por estado (tienda):", prep.porEstado);
  console.log("Por QuickBooks:", prep.porQb);
  if (!escribe && !ensayo) {
    console.log("\nEn seco: no se toco la base. Con --ensayo carga y hace ROLLBACK; con --escribe, carga de verdad.");
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
  const source = `xlsx ${fichero.split(/[\\/]/).pop()} ${new Date().toISOString().slice(0, 10)}`;
  try {
    await c.query("set lock_timeout = '5s'; set statement_timeout = '120s'");
    await c.query("begin");
    const antes = Number((await c.query("select count(*) as n from erp.customers")).rows[0].n);
    let nuevas = 0, actualizadas = 0;
    const TANDA = 200;
    for (let i = 0; i < prep.clientes.length; i += TANDA) {
      const tanda = prep.clientes.slice(i, i + TANDA);
      const r = await c.query(sqlDeUpsert(tanda.length), parametrosDe(tanda, source));
      for (const fila of r.rows) { if (fila.nueva) nuevas++; else actualizadas++; }
    }
    const despues = Number((await c.query("select count(*) as n from erp.customers")).rows[0].n);
    console.log(`\nResultado: nuevas ${nuevas} · actualizadas (ya estaban) ${actualizadas} · filas en la tabla: ${antes} -> ${despues}`);
    if (escribe) { await c.query("commit"); console.log("COMMIT: cargado."); }
    else { await c.query("rollback"); console.log("ROLLBACK: no quedo nada (era un ensayo)."); }
  } catch (e) {
    try { await c.query("rollback"); } catch { /* ya estaba cerrada */ }
    console.error("ERROR (rollback hecho):", e.code ?? "", e.message);
    if (e.code === "42P01") console.error("¿Esta aplicada la migracion 180?");
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
