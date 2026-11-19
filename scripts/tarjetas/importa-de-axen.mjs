#!/usr/bin/env node
// ============================================================
// Importa las tarjetas del contratista (Axen) a la base de RTG Hub (migración 331). Una sola vez.
//
//   node scripts/tarjetas/importa-de-axen.mjs <ruta/cards-axen.json>            → SIMULACRO: dice qué haría
//   node scripts/tarjetas/importa-de-axen.mjs <ruta/cards-axen.json> --aplicar  → escribe de verdad
//
// Por defecto NO escribe. Con --aplicar: upsert por slug (idempotente) con la llave de servicio, y por cada tarjeta
// con foto o portada: la baja del servidor del contratista (solo https, solo a los hosts que aparecen en el propio
// JSON, máximo 5 MB, solo jpeg/png/webp) y la guarda en el bucket `business-cards` bajo el id de la tarjeta.
//
// Variables de entorno (las pone quien corre el script; este script NO lee .env.local):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Sin ellas, el simulacro igual valida el JSON y muestra el plan; no compara con la base.
//
// El JSON trae el id del contratista: no se usa. Los enlaces de edición (tokens) NO vienen en el JSON: cada tarjeta
// recibe un token nuevo al insertarse, y el admin manda el enlace nuevo a cada persona desde «Tarjetas de presentación».
// ============================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TAMANO_MAX_FOTO = 5 * 1024 * 1024;
const TIENDAS = ["brownsville", "pharr", "mcallen", "edinburg", "mission", "weslaco"];
const FORMATO_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVADOS = ["editar", "api", "tarjeta", "tarjetas", "track", "login", "auth", "unsubscribe", "reset-password",
  "change-password", "no-access", "device-blocked", "web-blocked", "monitoring", "no-encontrada", "_next"];
const TIPOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Valida y normaliza las filas del JSON. Devuelve las buenas y los errores (con la posición). */
export function leeTarjetas(json) {
  if (!Array.isArray(json)) return { tarjetas: [], errores: ["el JSON no es una lista"] };
  const tarjetas = [];
  const errores = [];
  json.forEach((f, i) => {
    const pos = `fila ${i + 1}`;
    const slug = String(f?.slug ?? "").trim().toLowerCase();
    const nombre = String(f?.full_name ?? "").trim();
    if (!slug || slug.length < 2 || slug.length > 60 || !FORMATO_SLUG.test(slug) || RESERVADOS.includes(slug)) {
      errores.push(`${pos}: slug no válido («${slug}»)`); return;
    }
    if (!nombre) { errores.push(`${pos} (${slug}): sin nombre`); return; }
    const tienda = String(f?.store ?? "").trim().toLowerCase();
    tarjetas.push({
      slug,
      full_name: nombre,
      role_es: String(f?.role_es ?? "").trim(),
      role_en: String(f?.role_en ?? "").trim(),
      store: TIENDAS.includes(tienda) ? tienda : null,
      phone: String(f?.phone ?? "").trim(),
      whatsapp: String(f?.whatsapp ?? "").trim(),
      email: String(f?.email ?? "").trim(),
      photo_url: String(f?.photo_url ?? "").trim(),
      cover_url: String(f?.cover_url ?? "").trim(),
    });
  });
  const slugs = tarjetas.map((t) => t.slug);
  for (const s of new Set(slugs)) if (slugs.indexOf(s) !== slugs.lastIndexOf(s)) errores.push(`slug repetido en el JSON: ${s}`);
  return { tarjetas, errores };
}

/** Los hosts (https) de las fotos del propio JSON: solo se descarga de ahí. */
export function hostsDeFotos(tarjetas) {
  const hosts = new Set();
  for (const t of tarjetas) for (const u of [t.photo_url, t.cover_url]) {
    const h = hostDeHttps(u);
    if (h) hosts.add(h);
  }
  return hosts;
}

export function hostDeHttps(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.host : null;
  } catch {
    return null;
  }
}

/** ¿Se puede bajar esta URL? Solo https y solo a un host del JSON. */
export function descargable(url, hosts) {
  const h = hostDeHttps(url);
  return !!h && hosts.has(h);
}

/** Lo que el simulacro (y el real) hará, en texto, por tarjeta. */
export function planDe(t, hosts) {
  const fotos = [];
  if (t.photo_url) fotos.push(descargable(t.photo_url, hosts) ? "foto" : "foto (URL no permitida: se omite)");
  if (t.cover_url) fotos.push(descargable(t.cover_url, hosts) ? "portada" : "portada (URL no permitida: se omite)");
  return `${t.slug} · ${t.full_name} · ${t.store ?? "sin tienda"} · fotos: ${fotos.join(", ") || "ninguna"}`;
}

// Las mismas medidas que la subida de la app (lib/tarjetas/reduccion.ts): foto 800 px, portada 1200 px, JPEG 0.85.
const MEDIDAS = { foto: 800, portada: 1200 };
const CALIDAD_JPEG = 85;

/**
 * Reduce la foto como la app. Usa `sharp` SI está instalado (el script no lo declara como dependencia; Next lo trae
 * como opcional). Si no está, la foto se guarda tal cual y se avisa: el script no trae otra librería de imágenes.
 */
export async function reduceSiSePuede(bytes, tipo, clase) {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return { bytes, tipo, ext: TIPOS[tipo], reducida: false };
  }
  const salida = await sharp(bytes, { failOn: "none" })
    .rotate()
    .resize({ width: MEDIDAS[clase], height: MEDIDAS[clase], fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: CALIDAD_JPEG, mozjpeg: true })
    .toBuffer();
  return { bytes: new Uint8Array(salida), tipo: "image/jpeg", ext: "jpg", reducida: true };
}

/** Baja una imagen con los límites: https, host del JSON, tipo de imagen y tope de tamaño. */
export async function bajaFoto(url, hosts) {
  if (!descargable(url, hosts)) throw new Error("URL no permitida");
  const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const tipo = (r.headers.get("content-type") || "").split(";")[0].trim();
  const ext = TIPOS[tipo];
  if (!ext) throw new Error(`tipo no permitido (${tipo || "ninguno"})`);
  const largo = Number(r.headers.get("content-length") || 0);
  if (largo > TAMANO_MAX_FOTO) throw new Error("pesa más de 5 MB");
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length === 0 || bytes.length > TAMANO_MAX_FOTO) throw new Error("tamaño no permitido");
  return { bytes, tipo, ext };
}

async function aplicar(tarjetas, hosts) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) throw new Error("faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, llave, { auth: { autoRefreshToken: false, persistSession: false } });
  let ok = 0;
  for (const t of tarjetas) {
    const fila = {
      slug: t.slug, full_name: t.full_name, role_es: t.role_es, role_en: t.role_en, store: t.store,
      phone: t.phone, whatsapp: t.whatsapp, email: t.email,
    };
    const { data, error } = await sb.from("business_cards").upsert(fila, { onConflict: "slug" }).select("id").single();
    if (error) { console.error(`✗ ${t.slug}: ${error.message}`); continue; }
    const id = data.id;
    const campos = {};
    for (const [clase, origen, campo] of [["foto", t.photo_url, "photo_path"], ["portada", t.cover_url, "cover_path"]]) {
      if (!origen) continue;
      try {
        const original = await bajaFoto(origen, hosts);
        const { bytes, tipo, ext, reducida } = await reduceSiSePuede(original.bytes, original.tipo, clase);
        if (!reducida) console.warn(`! ${t.slug} (${clase}): sin «sharp» no se reduce (${(bytes.length / 1048576).toFixed(1)} MB)`);
        const ruta = `${id}/${clase}-0.${ext}`;
        const sub = await sb.storage.from("business-cards").upload(ruta, bytes, { contentType: tipo, upsert: true, cacheControl: "3600" });
        if (sub.error) throw sub.error;
        campos[campo] = ruta;
      } catch (e) {
        console.error(`✗ ${t.slug} (${clase}): ${e.message}`);
      }
    }
    if (Object.keys(campos).length) {
      const { error: eu } = await sb.from("business_cards").update(campos).eq("id", id);
      if (eu) { console.error(`✗ ${t.slug}: ${eu.message}`); continue; }
    }
    ok += 1;
    console.log(`✓ ${t.slug}`);
  }
  console.log(`Listo: ${ok} de ${tarjetas.length} tarjetas.`);
}

async function main() {
  const args = process.argv.slice(2);
  const ruta = args.find((a) => !a.startsWith("--"));
  const aplicarDe = args.includes("--aplicar");
  if (!ruta) {
    console.error("Uso: node scripts/tarjetas/importa-de-axen.mjs <cards-axen.json> [--aplicar]");
    process.exit(2);
  }
  const { tarjetas, errores } = leeTarjetas(JSON.parse(readFileSync(ruta, "utf8")));
  for (const e of errores) console.error(`! ${e}`);
  const hosts = hostsDeFotos(tarjetas);
  console.log(aplicarDe ? "APLICAR: se escribe en la base y en el bucket." : "SIMULACRO: no se escribe nada (añade --aplicar para escribir).");
  console.log(`Hosts de fotos permitidos: ${[...hosts].join(", ") || "ninguno"}`);
  for (const t of tarjetas) console.log(`  · ${planDe(t, hosts)}`);
  console.log(`${tarjetas.length} tarjetas válidas, ${errores.length} errores.`);
  if (!aplicarDe) return;
  if (errores.length) { console.error("No se aplica con errores en el JSON."); process.exit(1); }
  await aplicar(tarjetas, hosts);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
