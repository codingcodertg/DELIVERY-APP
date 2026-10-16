#!/usr/bin/env node
// Mueve las fotos de entrega que siguen en base64 dentro de `deliveries.photos` al cubo `delivery-photos` (178, D-NEXT).
//
// Uso (desde el checkout principal, que es donde vive .env.local):
//   node --env-file=.env.local scripts/migra-fotos-a-storage.mjs             -> EN SECO: cuenta y lista, no escribe nada
//   node --env-file=.env.local scripts/migra-fotos-a-storage.mjs --escribe   -> sube y reescribe las filas
//
// Que hace, por orden:
//   1. Lee con service-role las ordenes cuyo `photos` contenga alguna foto `data:image…` (las que son ruta ya estan).
//   2. Por cada foto embebida: la sube a `<delivery_id>/<marca>-<n>.jpg` (misma forma que el cliente, lib/fotos-en-storage.ts).
//   3. Reescribe `photos` con las rutas, EN EL MISMO ORDEN, y `photo_meta` con la MISMA entrada (quien y cuando) bajo la
//      ruta en vez del base64. Una entrada de `photo_meta` que no case con ninguna foto se deja como esta.
//   4. Idempotente: una fila ya convertida no tiene `data:` y no sale en (1); si el proceso se corta a medias, la fila
//      no se toca (se escribe solo cuando TODAS sus fotos subieron) y la siguiente pasada la retoma. Un objeto que haya
//      quedado subido sin fila que le apunte es huerfano y no estorba (`upsert: true` por si la marca se repite).
//
// En seco por defecto, a proposito: escribir en produccion se pide, no se cae por teclear un argumento de menos.
// Service-role salta la RLS de `deliveries` y del cubo; el guard de etapa deja pasar sin `auth.uid()` (173), y
// `deliveries_touch` sube `updated_at` (la ficha abierta vuelve a pedir las fotos: es lo que se quiere).
//
// Sin acentos, como el resto de scripts.

import { pathToFileURL } from "node:url";

export const CUBO = "delivery-photos";
const esEmbebida = (f) => typeof f === "string" && f.startsWith("data:");

/** Los bytes de un `data:…;base64,…`. */
export function bytesDeDataUrl(dataUrl) {
  const coma = dataUrl.indexOf(",");
  const cabecera = coma >= 0 ? dataUrl.slice(0, coma) : "";
  const m = /^data:([^;,]+)(;base64)?$/.exec(cabecera);
  if (!m || !m[2]) throw new Error("no es un data: URL en base64");
  return { tipo: m[1], bytes: Buffer.from(dataUrl.slice(coma + 1), "base64") };
}

/**
 * El plan de UNA fila: que subir (ruta <- data:), como quedan `photos` y `photo_meta`. Puro.
 * `marca` fija la carpeta de tiempo de las rutas, para que la prueba sea determinista.
 */
export function planDeFila(fila, marca) {
  const fotos = Array.isArray(fila.photos) ? fila.photos : [];
  const subidas = [];
  const photos = [];
  let n = 0;
  for (const f of fotos) {
    if (!esEmbebida(f)) { photos.push(f); continue; }
    const ruta = `${fila.id}/${marca}-${n++}.jpg`;
    subidas.push({ ruta, dataUrl: f });
    photos.push(ruta);
  }
  const rutaDe = new Map(subidas.map((s) => [s.dataUrl, s.ruta]));
  const metaVieja = fila.photo_meta && typeof fila.photo_meta === "object" ? fila.photo_meta : null;
  let photo_meta = metaVieja;
  if (metaVieja) {
    photo_meta = {};
    for (const [clave, info] of Object.entries(metaVieja)) photo_meta[rutaDe.get(clave) ?? clave] = info;
  }
  const kb = subidas.reduce((s, x) => s + Math.round((x.dataUrl.length * 3) / 4 / 1024), 0);
  return { id: fila.id, order_no: fila.order_no ?? null, subidas, photos, photo_meta, kb };
}

/**
 * Recorre las ordenes con fotos embebidas. `base` es un cliente de Supabase con service-role (o un doble en las pruebas).
 * Sin `escribe`, NO llama ni a `upload` ni a `update`: solo cuenta. Devuelve lo contado.
 */
export async function migra({ base, escribe = false, log = console.log, ahora = () => Date.now() }) {
  const { data, error } = await base
    .from("deliveries")
    .select("id, order_no, photos, photo_meta")
    .not("photos", "is", null);   // el filtro fino (`data:`) va abajo: PostgREST no filtra dentro de un jsonb array
  if (error) throw new Error(`no se pudieron leer las ordenes: ${error.message}`);
  const filas = (data ?? []).filter((f) => Array.isArray(f.photos) && f.photos.some(esEmbebida));

  const total = { ordenes: 0, fotos: 0, kb: 0, escritas: 0, fallidas: 0 };
  for (const fila of filas) {
    const plan = planDeFila(fila, ahora());
    total.ordenes++;
    total.fotos += plan.subidas.length;
    total.kb += plan.kb;
    log(`${escribe ? "->" : "  "} orden ${plan.order_no ?? plan.id}: ${plan.subidas.length} foto(s), ~${plan.kb} KB`);
    if (!escribe) continue;

    let ok = true;
    for (const s of plan.subidas) {
      const { tipo, bytes } = bytesDeDataUrl(s.dataUrl);
      const r = await base.storage.from(CUBO).upload(s.ruta, bytes, { contentType: tipo || "image/jpeg", upsert: true });
      if (r.error) { log(`   x no subio ${s.ruta}: ${r.error.message}`); ok = false; break; }
    }
    if (!ok) { total.fallidas++; continue; }   // la fila se queda como esta; la siguiente pasada la retoma
    const u = await base.from("deliveries").update({ photos: plan.photos, photo_meta: plan.photo_meta }).eq("id", plan.id).select("id");
    if (u.error || !u.data?.length) { log(`   x no se reescribio la fila ${plan.id}: ${u.error?.message ?? "0 filas"}`); total.fallidas++; continue; }
    total.escritas++;
  }

  log("");
  log(`${total.ordenes} orden(es) con fotos embebidas, ${total.fotos} foto(s), ~${total.kb} KB`);
  if (escribe) log(`reescritas ${total.escritas}, fallidas ${total.fallidas}`);
  else log("EN SECO: no se subio ni se escribio nada. Con --escribe se hace de verdad.");
  return total;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const escribe = process.argv.includes("--escribe");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Normalmente: node --env-file=.env.local …");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const base = createClient(url, llave, { auth: { autoRefreshToken: false, persistSession: false } });
  const total = await migra({ base, escribe });
  process.exit(total.fallidas ? 1 : 0);
}
